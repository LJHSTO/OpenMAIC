'use client';

import { guardCourseware, type CoursewareGuardReport } from '@/lib/courseware-guard';
import type { CoursewareAuditProfile } from '@/lib/courseware-guard/audit-policy';
import type { CoursewareResourceAuditReport } from '@/lib/courseware-guard/resource-audit';
import type { CoursewareInteractiveAuditReport } from '@/lib/courseware-guard/interactive-audit';
import type { CoursewareKnowledgeAuditReport } from '@/lib/courseware-guard/knowledge-audit';
import { uploadClientCoursewareResources } from '@/lib/courseware-guard/upload-client-resources';
import type { CoursewareVisualAuditReport } from '@/lib/courseware-guard/visual-audit';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useSettingsStore } from '@/lib/store/settings';
import { useStageStore } from '@/lib/store/stage';
import type { Scene, Stage } from '@/lib/types/stage';
import { getCurrentModelConfig } from '@/lib/utils/model-config';

export interface ClientCoursewareFinalizationResult {
  stage: Stage;
  scenes: Scene[];
  guardReport: CoursewareGuardReport;
  knowledgeReport: CoursewareKnowledgeAuditReport;
  resourceReport: CoursewareResourceAuditReport;
  visualReport: CoursewareVisualAuditReport;
  interactiveReport: CoursewareInteractiveAuditReport;
  archive?: { path?: string; filename?: string; outputDir?: string; size?: number };
}

export class CoursewareFinalizationClientError extends Error {
  constructor(
    message: string,
    readonly guardReport?: CoursewareGuardReport,
    readonly knowledgeReport?: CoursewareKnowledgeAuditReport,
    readonly resourceReport?: CoursewareResourceAuditReport,
    readonly visualReport?: CoursewareVisualAuditReport,
    readonly interactiveReport?: CoursewareInteractiveAuditReport,
    readonly evidenceDir?: string,
  ) {
    super(message);
    this.name = 'CoursewareFinalizationClientError';
  }
}

interface SuccessfulFinalizationReceipt {
  stageId: string;
  fingerprint: string;
  auditProfile: CoursewareAuditProfile;
  enableVisionAudit: boolean;
  result: ClientCoursewareFinalizationResult;
}

const AUDIT_PROFILE_RANK: Record<CoursewareAuditProfile, number> = {
  fast: 0,
  balanced: 1,
  strict: 2,
};

let successfulFinalizationReceipt: SuccessfulFinalizationReceipt | null = null;

function currentCoursewareFingerprint(stage: Stage, scenes: Scene[]): string {
  return guardCourseware({ stage, scenes }, { mode: 'inspect', contentPolicy: 'strict' }).report
    .beforeFingerprint;
}

export function getCurrentCoursewareFinalization(options?: {
  auditProfile?: CoursewareAuditProfile;
  enableVisionAudit?: boolean;
}): ClientCoursewareFinalizationResult | null {
  const state = useStageStore.getState();
  const receipt = successfulFinalizationReceipt;
  if (!state.stage || !receipt || receipt.stageId !== state.stage.id) return null;
  if (currentCoursewareFingerprint(state.stage, state.scenes) !== receipt.fingerprint) return null;
  const requestedProfile = options?.auditProfile ?? 'balanced';
  if (AUDIT_PROFILE_RANK[receipt.auditProfile] < AUDIT_PROFILE_RANK[requestedProfile]) return null;
  if (options?.enableVisionAudit === true && !receipt.enableVisionAudit) return null;
  return receipt.result;
}

function preserveClientMediaReferences(originalScenes: Scene[], finalizedScenes: Scene[]): Scene[] {
  const originalBySceneId = new Map(originalScenes.map((scene) => [scene.id, scene]));
  return finalizedScenes.map((scene) => {
    const original = originalBySceneId.get(scene.id);
    if (scene.content.type !== 'slide' || original?.content.type !== 'slide') return scene;
    const originalElements = new Map(
      original.content.canvas.elements.map((element) => [element.id, element]),
    );
    const elements = scene.content.canvas.elements.map((element) => {
      const prior = originalElements.get(element.id);
      if (
        (element.type !== 'image' && element.type !== 'video') ||
        (prior?.type !== 'image' && prior?.type !== 'video') ||
        typeof element.src !== 'string' ||
        !element.src.includes('/api/classroom-media/')
      ) {
        return element;
      }
      return {
        ...element,
        src: prior.src,
        ...(element.type === 'video' && prior.type === 'video' ? { poster: prior.poster } : {}),
      };
    });
    return {
      ...scene,
      content: { ...scene.content, canvas: { ...scene.content.canvas, elements } },
    } as Scene;
  });
}

function requestHeaders(): HeadersInit {
  const config = getCurrentModelConfig();
  return {
    'Content-Type': 'application/json',
    'x-model': config.modelString || '',
    'x-api-key': config.apiKey || '',
    'x-base-url': config.baseUrl || '',
    'x-provider-type': config.providerType || '',
  };
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Courseware finalization returned invalid JSON (${response.status})`);
  }
}

export async function finalizeCurrentCourseware(options?: {
  enableVisionAudit?: boolean;
  auditProfile?: CoursewareAuditProfile;
}): Promise<ClientCoursewareFinalizationResult> {
  const state = useStageStore.getState();
  if (!state.stage || state.scenes.length === 0) {
    throw new Error('Cannot finalize an empty classroom');
  }
  const originalStage = state.stage;
  const originalScenes = state.scenes;
  const failedMedia = Object.values(useMediaGenerationStore.getState().tasks).filter(
    (task) => task.stageId === originalStage.id && task.status === 'failed',
  );
  if (failedMedia.length > 0) {
    throw new Error(`Cannot finalize: ${failedMedia.length} generated media resource(s) failed`);
  }

  const scenesWithResources = await uploadClientCoursewareResources(
    originalStage.id,
    originalScenes,
  );
  const modelConfig = getCurrentModelConfig();
  const settings = useSettingsStore.getState();
  const requestBody = {
    stage: originalStage,
    scenes: scenesWithResources,
    outlines: state.outlines,
    model: modelConfig.modelString || 'unknown-model',
    enableTTS: settings.ttsEnabled && settings.ttsProviderId !== 'browser-native-tts',
    ...(options?.enableVisionAudit != null ? { enableVisionAudit: options.enableVisionAudit } : {}),
    auditProfile: options?.auditProfile,
    ...(modelConfig.thinkingConfig ? { thinkingConfig: modelConfig.thinkingConfig } : {}),
  };
  const response = await fetch('/api/courseware-guard/finalize', {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify(requestBody),
  });
  const result = (await readJsonResponse(response)) as Record<string, unknown> & {
    success?: boolean;
    error?: string;
    evidenceDir?: string;
    stage?: Stage;
    scenes?: Scene[];
    guardReport?: CoursewareGuardReport;
    knowledgeReport?: CoursewareKnowledgeAuditReport;
    resourceReport?: CoursewareResourceAuditReport;
    visualReport?: CoursewareVisualAuditReport;
    interactiveReport?: CoursewareInteractiveAuditReport;
    archive?: ClientCoursewareFinalizationResult['archive'];
  };
  let finalizedScenes: Scene[] | undefined;
  if (result.stage && result.scenes) {
    finalizedScenes = preserveClientMediaReferences(originalScenes, result.scenes);
    useStageStore.setState({ stage: result.stage, scenes: finalizedScenes });
    await useStageStore.getState().saveToStorage();
  }
  if (!response.ok || !result.success || !result.stage || !finalizedScenes) {
    successfulFinalizationReceipt = null;
    const evidence = result.evidenceDir ? ` Evidence: ${result.evidenceDir}` : '';
    throw new CoursewareFinalizationClientError(
      `${result.error || 'Courseware finalization failed'}.${evidence}`,
      result.guardReport,
      result.knowledgeReport,
      result.resourceReport,
      result.visualReport,
      result.interactiveReport,
      result.evidenceDir,
    );
  }

  const finalizedResult = {
    stage: result.stage,
    scenes: finalizedScenes,
    guardReport: result.guardReport!,
    knowledgeReport: result.knowledgeReport!,
    resourceReport: result.resourceReport!,
    visualReport: result.visualReport!,
    interactiveReport: result.interactiveReport!,
    archive: result.archive,
  };
  successfulFinalizationReceipt = {
    stageId: result.stage.id,
    fingerprint: currentCoursewareFingerprint(result.stage, finalizedScenes),
    auditProfile: options?.auditProfile ?? 'balanced',
    enableVisionAudit: options?.enableVisionAudit ?? true,
    result: finalizedResult,
  };
  return finalizedResult;
}

export async function ensureCurrentCoursewareFinalized(options?: {
  enableVisionAudit?: boolean;
  auditProfile?: CoursewareAuditProfile;
}): Promise<ClientCoursewareFinalizationResult> {
  return getCurrentCoursewareFinalization(options) ?? finalizeCurrentCourseware(options);
}
