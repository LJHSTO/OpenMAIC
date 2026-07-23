import type { SceneOutline } from '@/lib/types/generation';

export const CLASSROOM_SCENE_RETRY_OPTIONS = {
  maxRetries: 1,
} as const;

export const SCENE_MODEL_TIMEOUT_MS = 180_000;
export const LONG_SCENE_MODEL_TIMEOUT_MS = 285_000;

const CONTENT_OUTPUT_CAPS: Record<SceneOutline['type'], number> = {
  slide: 16_384,
  quiz: 16_384,
  interactive: 16_384,
  pbl: 32_768,
};

const ACTION_OUTPUT_CAP = 16_384;

function clampOutputTokens(modelOutputWindow: number | undefined, cap: number): number {
  if (!modelOutputWindow || !Number.isFinite(modelOutputWindow) || modelOutputWindow <= 0) {
    return cap;
  }
  return Math.min(Math.floor(modelOutputWindow), cap);
}

export function resolveSceneContentOutputTokens(
  sceneType: SceneOutline['type'],
  modelOutputWindow?: number,
): number {
  return clampOutputTokens(modelOutputWindow, CONTENT_OUTPUT_CAPS[sceneType]);
}

export function resolveSceneActionsOutputTokens(modelOutputWindow?: number): number {
  return clampOutputTokens(modelOutputWindow, ACTION_OUTPUT_CAP);
}

export function resolveSceneContentTimeoutMs(sceneType: SceneOutline['type']): number {
  return sceneType === 'interactive' || sceneType === 'pbl'
    ? LONG_SCENE_MODEL_TIMEOUT_MS
    : SCENE_MODEL_TIMEOUT_MS;
}

export function resolveClassroomContentRetryOptions(sceneType: SceneOutline['type']) {
  return sceneType === 'interactive' || sceneType === 'pbl'
    ? ({ maxRetries: 0 } as const)
    : CLASSROOM_SCENE_RETRY_OPTIONS;
}

export function createSceneModelAbortSignal(
  parentSignal?: AbortSignal,
  timeoutMs = SCENE_MODEL_TIMEOUT_MS,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal;
}
