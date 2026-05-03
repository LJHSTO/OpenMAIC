'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot, Check, ChevronDown, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useModificationStore, useSnapshotStore, useStageStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/store/canvas';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { cn } from '@/lib/utils';
import type {
  DiffSummary,
  EditPlan,
  ModificationConversationTurn,
  ModificationMode,
  ModificationSession,
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

function sceneContentFingerprint(scene: Scene): string {
  return JSON.stringify(scene.content);
}

function summarizeSessionForConversation(session: ModificationSession): string {
  const changedItems = session.diffSummary?.changedItems.length
    ? session.diffSummary.changedItems.map((item) => `- ${item}`).join('\n')
    : '- Preview was not generated yet';
  return `Plan: ${session.editPlan?.summary ?? 'No plan summary'}\nPreview diff:\n${changedItems}`;
}

function buildConversationHistory(session: ModificationSession): ModificationConversationTurn[] {
  if (session.conversationHistory?.length) return session.conversationHistory;
  const turns: ModificationConversationTurn[] = [
    {
      role: 'user',
      content: session.userInstruction,
      createdAt: session.createdAt,
    },
  ];
  if (session.editPlan || session.diffSummary) {
    turns.push({
      role: 'assistant',
      content: summarizeSessionForConversation(session),
      createdAt: session.updatedAt,
    });
  }
  return turns;
}

export function SceneModifyPanel({ currentScene, rightOffset = 16 }: SceneModifyPanelProps) {
  const sessionsBySceneId = useModificationStore.use.sessionsBySceneId();
  const isPanelOpen = useModificationStore.use.isPanelOpen();
  const setActiveScene = useModificationStore.use.setActiveScene();
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
  const activeElementIdList = useCanvasStore.use.activeElementIdList();
  const setHighlight = useCanvasStore.use.setHighlight();
  const clearHighlight = useCanvasStore.use.clearHighlight();

  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [clarification, setClarification] = useState<string[]>([]);
  const [followUpInstruction, setFollowUpInstruction] = useState('');
  const [mode, setMode] = useState<ModificationMode>('scene');
  const activeSession = currentScene ? sessionsBySceneId[currentScene.id] : undefined;

  const supported =
    currentScene?.type === 'slide' ||
    currentScene?.type === 'quiz' ||
    currentScene?.type === 'interactive';
  const selectedSlideElementIds = useMemo(() => {
    if (currentScene?.type !== 'slide' || currentScene.content.type !== 'slide') return [];
    const elementIds = new Set(currentScene.content.canvas.elements.map((element) => element.id));
    return activeElementIdList.filter((id) => elementIds.has(id));
  }, [activeElementIdList, currentScene]);
  const canUseSpot = currentScene?.type === 'slide' && selectedSlideElementIds.length > 0;
  const selectedElementIds = mode === 'spot' && canUseSpot ? selectedSlideElementIds : [];
  const canStart =
    !!currentScene &&
    supported &&
    instruction.trim().length > 0 &&
    !busy &&
    (mode !== 'spot' || selectedElementIds.length > 0);

  useEffect(() => {
    setActiveScene(currentScene?.id ?? null);
    clearHighlight();
  }, [clearHighlight, currentScene?.id, setActiveScene]);

  useEffect(() => {
    if (!canUseSpot && mode === 'spot') setMode('scene');
  }, [canUseSpot, mode]);

  useEffect(() => () => clearHighlight(), [clearHighlight]);

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
      startSession({
        stageId: stage.id,
        scene: currentScene,
        instruction: instruction.trim(),
        mode,
        commitBaseScene: currentScene,
      });
      const body: ModifyScenePlanRequest = {
        stageId: stage.id,
        sceneId: currentScene.id,
        scene: currentScene,
        instruction: instruction.trim(),
        mode,
        selectedElementIds: selectedElementIds.length > 0 ? selectedElementIds : undefined,
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
      setFollowUpInstruction('');
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
    const previewBaseScene =
      activeSession.mode === 'conversation'
        ? activeSession.originalScene
        : currentScene?.id === activeSession.sceneId
          ? currentScene
          : activeSession.originalScene;
    setBusy(true);
    setLocalError(null);
    setStatus('executing_preview');
    try {
      const body: ModifyScenePreviewRequest = {
        scene: previewBaseScene,
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
      setPreview(data.previewScene, data.diffSummary, previewBaseScene);
      if (data.previewScene.type === 'slide' && data.diffSummary.changedItemIds.length > 0) {
        setHighlight(data.diffSummary.changedItemIds, {
          color: '#10b981',
          opacity: 0.24,
          borderWidth: 3,
          animated: true,
        });
      } else {
        clearHighlight();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const requestConversationRefine = async () => {
    const followUp = followUpInstruction.trim();
    const previewScene = activeSession?.previewScene;
    if (!activeSession || !previewScene || !currentScene || !stage || !followUp) return;

    const previousSession = activeSession;
    const conversationHistory = buildConversationHistory(previousSession);
    const nextConversationHistory: ModificationConversationTurn[] = [
      ...conversationHistory,
      { role: 'user', content: followUp, createdAt: Date.now() },
    ];

    setBusy(true);
    setLocalError(null);
    setClarification([]);
    setStatus('planning');

    try {
      const body: ModifyScenePlanRequest = {
        stageId: stage.id,
        sceneId: previousSession.sceneId,
        scene: previewScene,
        instruction: followUp,
        mode: 'conversation',
        conversationHistory: nextConversationHistory,
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
        setStatus('previewing');
        return;
      }
      if (!data.plan) throw new Error('No edit plan returned');
      if (data.validation && !data.validation.valid) {
        throw new Error(data.validation.errors.join('\n') || 'Generated edit plan is invalid');
      }

      startSession({
        stageId: stage.id,
        scene: previewScene,
        instruction: followUp,
        mode: 'conversation',
        commitBaseScene:
          previousSession.commitBaseScene ?? previousSession.previewBaseScene ?? currentScene,
        conversationHistory: nextConversationHistory,
      });
      setPlan(data.plan);
      setFollowUpInstruction('');
      clearHighlight();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const acceptPreview = async () => {
    if (!activeSession?.previewScene || !currentScene) return;
    setBusy(true);
    setLocalError(null);
    try {
      const commitBaseScene = activeSession.commitBaseScene ?? activeSession.previewBaseScene;
      if (
        commitBaseScene &&
        sceneContentFingerprint(currentScene) !== sceneContentFingerprint(commitBaseScene)
      ) {
        throw new Error(
          'The scene changed after preview was generated. Reject and regenerate preview.',
        );
      }
      await addSnapshot();
      // Commit only generated content so concurrent metadata edits are preserved.
      updateScene(activeSession.sceneId, {
        content: activeSession.previewScene.content,
        updatedAt: activeSession.previewScene.updatedAt,
      });
      clearHighlight();
      markAccepted();
      setFollowUpInstruction('');
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
    clearHighlight();
    setClarification([]);
    setLocalError(null);
    setFollowUpInstruction('');
  };

  const quickInstructions = [
    '把选中的文字改得更简洁，保留核心含义',
    '把选中元素改得更适合小学生理解',
    '把选中元素居中并优化版面位置',
    '把选中元素放大一点，保持不遮挡其他内容',
    '把选中元素颜色改得更醒目但保持整体风格',
  ];

  if (!currentScene || !supported) return null;

  if (!isPanelOpen) {
    return (
      <Button
        type="button"
        size="sm"
        className="absolute top-4 z-40 shadow-lg shadow-purple-500/15"
        style={{ right: rightOffset }}
        onClick={() => openPanel(currentScene.id)}
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

        {currentScene.type === 'slide' && (
          <div className="rounded-xl border bg-slate-50 p-2.5 text-xs dark:bg-slate-900/70">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-medium text-slate-700 dark:text-slate-200">Edit scope</span>
              <span className="text-muted-foreground">
                {selectedSlideElementIds.length} selected element(s)
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={mode === 'scene' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMode('scene')}
                disabled={busy || !!activeSession}
              >
                Whole scene
              </Button>
              <Button
                type="button"
                variant={mode === 'spot' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMode('spot')}
                disabled={busy || !!activeSession || !canUseSpot}
              >
                Selected only
              </Button>
            </div>
            {mode === 'spot' && (
              <div className="mt-2 text-muted-foreground">
                Spot edit locks the AI plan to the selected element IDs.
              </div>
            )}
          </div>
        )}

        {mode === 'spot' && canUseSpot && !activeSession?.editPlan && (
          <div className="flex flex-wrap gap-1.5">
            {quickInstructions.map((quickInstruction) => (
              <Button
                key={quickInstruction}
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 rounded-full px-2 text-[11px]"
                onClick={() => setInstruction(quickInstruction)}
                disabled={busy}
              >
                {quickInstruction.replace('把选中元素', '').replace('把选中的文字', '文字')}
              </Button>
            ))}
          </div>
        )}

        {currentScene.type === 'interactive' && (
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
            Interactive edits update widget config and teacher action guidance. Full HTML
            regeneration is not enabled in this phase.
          </div>
        )}

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

        {activeSession?.previewScene && (
          <div className="rounded-xl border bg-slate-50 p-3 text-xs dark:bg-slate-900/70">
            <div className="mb-2 font-medium text-slate-700 dark:text-slate-200">
              Refine this preview
            </div>
            <Textarea
              value={followUpInstruction}
              onChange={(event) => setFollowUpInstruction(event.target.value)}
              disabled={busy}
              placeholder="例如：在这个预览基础上再短一点，保留刚才新增的内容"
              className="min-h-16 resize-none bg-white text-xs dark:bg-slate-950"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2 w-full"
              onClick={requestConversationRefine}
              disabled={busy || followUpInstruction.trim().length === 0}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Refine Preview
            </Button>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={rejectPreview}
            disabled={busy || !activeSession}
          >
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
