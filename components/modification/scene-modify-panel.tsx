'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot, Check, ChevronDown, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useModificationStore, useSnapshotStore, useStageStore } from '@/lib/store';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { cn } from '@/lib/utils';
import type {
  DiffSummary,
  EditPlan,
  ModifyScenePlanRequest,
  ModifyScenePreviewRequest,
} from '@/lib/types/modification';
import type { Scene } from '@/lib/types/stage';

interface SceneModifyPanelProps {
  currentScene: Scene | null;
  rightOffset?: number;
}

interface PlanResponse {
  success: boolean;
  needsClarification?: boolean;
  questions?: Array<{ question: string; options?: string[] }>;
  plan?: EditPlan;
  validation?: { valid: boolean; errors: string[]; warnings: string[] };
  error?: string;
}

interface PreviewResponse {
  success: boolean;
  previewScene?: Scene;
  diffSummary?: DiffSummary;
  appliedOperationIds?: string[];
  warnings?: string[];
  error?: string;
}

function getApiHeaders(): HeadersInit {
  const config = getCurrentModelConfig();
  return {
    'Content-Type': 'application/json',
    'x-model': config.modelString || '',
    'x-api-key': config.apiKey || '',
    'x-base-url': config.baseUrl || '',
    'x-provider-type': config.providerType || '',
  };
}

function withThinkingConfig<T extends Record<string, unknown>>(body: T): T {
  const { thinkingConfig } = getCurrentModelConfig();
  return thinkingConfig ? ({ ...body, thinkingConfig } as T) : body;
}

function getStatusLabel(status?: string) {
  switch (status) {
    case 'planning':
      return 'Planning';
    case 'waiting_plan_approval':
      return 'Plan ready';
    case 'executing_preview':
      return 'Previewing';
    case 'previewing':
      return 'Preview ready';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

export function SceneModifyPanel({ currentScene, rightOffset = 16 }: SceneModifyPanelProps) {
  const activeSession = useModificationStore.use.activeSession();
  const isPanelOpen = useModificationStore.use.isPanelOpen();
  const openPanel = useModificationStore.use.openPanel();
  const closePanel = useModificationStore.use.closePanel();
  const startSession = useModificationStore.use.startSession();
  const setPlan = useModificationStore.use.setPlan();
  const setStatus = useModificationStore.use.setStatus();
  const setPreview = useModificationStore.use.setPreview();
  const setError = useModificationStore.use.setError();
  const markAccepted = useModificationStore.use.markAccepted();
  const rejectActiveSession = useModificationStore.use.rejectActiveSession();
  const clearActiveSession = useModificationStore.use.clearActiveSession();
  const stage = useStageStore.use.stage();
  const updateScene = useStageStore.use.updateScene();
  const addSnapshot = useSnapshotStore((state) => state.addSnapshot);

  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [clarification, setClarification] = useState<string[]>([]);

  const supported = currentScene?.type === 'slide' || currentScene?.type === 'quiz';
  const canStart = !!currentScene && supported && instruction.trim().length > 0 && !busy;

  useEffect(() => {
    if (activeSession && activeSession.sceneId !== currentScene?.id) {
      clearActiveSession();
    }
  }, [activeSession, clearActiveSession, currentScene?.id]);

  const operationCount = activeSession?.editPlan?.operations.length ?? 0;
  const riskClass = useMemo(() => {
    switch (activeSession?.editPlan?.riskLevel) {
      case 'high':
        return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40';
      case 'medium':
        return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40';
      default:
        return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40';
    }
  }, [activeSession?.editPlan?.riskLevel]);

  const requestPlan = async () => {
    if (!currentScene || !stage || !canStart) return;
    setBusy(true);
    setLocalError(null);
    setClarification([]);

    try {
      startSession({ stageId: stage.id, scene: currentScene, instruction: instruction.trim() });
      const body: ModifyScenePlanRequest = {
        stageId: stage.id,
        sceneId: currentScene.id,
        scene: currentScene,
        instruction: instruction.trim(),
        mode: 'scene',
        languageDirective: stage.languageDirective,
      };

      const response = await fetch('/api/modify-scene/plan', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify(withThinkingConfig(body as unknown as Record<string, unknown>)),
      });
      const data = (await response.json()) as PlanResponse;
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      if (data.needsClarification) {
        setClarification((data.questions ?? []).map((q) => q.question));
        setStatus('waiting_plan_approval');
        return;
      }
      if (!data.plan) throw new Error('No edit plan returned');
      if (data.validation && !data.validation.valid) {
        throw new Error(data.validation.errors.join('\n') || 'Generated edit plan is invalid');
      }
      setPlan(data.plan);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const requestPreview = async () => {
    if (!activeSession?.editPlan) return;
    setBusy(true);
    setLocalError(null);
    setStatus('executing_preview');
    try {
      const body: ModifyScenePreviewRequest = {
        scene: activeSession.originalScene,
        plan: activeSession.editPlan,
      };
      const response = await fetch('/api/modify-scene/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as PreviewResponse;
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      if (!data.previewScene || !data.diffSummary) throw new Error('No preview returned');
      setPreview(data.previewScene, data.diffSummary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const acceptPreview = async () => {
    if (!activeSession?.previewScene) return;
    setBusy(true);
    setLocalError(null);
    try {
      await addSnapshot();
      updateScene(activeSession.sceneId, activeSession.previewScene);
      markAccepted();
      closePanel();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const rejectPreview = () => {
    rejectActiveSession();
    setClarification([]);
    setLocalError(null);
  };

  if (!currentScene || !supported) return null;

  if (!isPanelOpen) {
    return (
      <Button
        type="button"
        size="sm"
        className="absolute top-4 z-40 shadow-lg shadow-purple-500/15"
        style={{ right: rightOffset }}
        onClick={openPanel}
      >
        <Sparkles className="size-4" />
        Customize
      </Button>
    );
  }

  return (
    <div
      className="absolute top-4 z-40 w-[380px] rounded-2xl border border-purple-100 bg-white/95 p-4 shadow-2xl shadow-purple-900/10 backdrop-blur-xl dark:border-purple-900/50 dark:bg-slate-950/95"
      style={{ right: rightOffset }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-purple-700 dark:text-purple-300">
            <Bot className="size-4" />
            Scene Modify
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {currentScene.title} · {currentScene.type} · {getStatusLabel(activeSession?.status)}
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={closePanel}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="space-y-3">
        <Textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          disabled={busy}
          placeholder="例如：把这页改得更适合小学生，并保留核心知识点"
          className="min-h-24 resize-none bg-white dark:bg-slate-900"
        />

        {clarification.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="font-semibold">AI needs clarification:</div>
            <ul className="mt-1 list-disc pl-4">
              {clarification.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </div>
        )}

        {(localError || activeSession?.error) && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {localError || activeSession?.error}
          </div>
        )}

        {activeSession?.editPlan && (
          <div className="rounded-xl border bg-slate-50 p-3 text-sm dark:bg-slate-900/70">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-semibold">Edit Plan</div>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', riskClass)}>
                {activeSession.editPlan.riskLevel} ·{' '}
                {Math.round(activeSession.editPlan.confidence * 100)}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{activeSession.editPlan.summary}</p>
            <div className="mt-2 text-xs text-muted-foreground">{operationCount} operation(s)</div>
          </div>
        )}

        {activeSession?.diffSummary && (
          <div className="rounded-xl border bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
            <div className="mb-2 font-semibold text-emerald-700 dark:text-emerald-300">
              Preview Diff
            </div>
            <ul className="max-h-32 space-y-1 overflow-auto text-xs text-emerald-900 dark:text-emerald-100">
              {activeSession.diffSummary.changedItems.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
            {activeSession.diffSummary.unchangedHint && (
              <div className="mt-2 text-xs text-emerald-700/80 dark:text-emerald-200/80">
                {activeSession.diffSummary.unchangedHint}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={rejectPreview} disabled={busy}>
            Reject
          </Button>
          {!activeSession?.editPlan && (
            <Button type="button" size="sm" onClick={requestPlan} disabled={!canStart}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Generate Plan
            </Button>
          )}
          {activeSession?.editPlan && !activeSession.previewScene && (
            <Button type="button" size="sm" onClick={requestPreview} disabled={busy}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ChevronDown className="size-4" />
              )}
              Preview
            </Button>
          )}
          {activeSession?.previewScene && (
            <Button type="button" size="sm" onClick={acceptPreview} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Apply
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
