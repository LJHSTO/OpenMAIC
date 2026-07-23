import { describe, expect, it } from 'vitest';
import {
  CLASSROOM_SCENE_RETRY_OPTIONS,
  LONG_SCENE_MODEL_TIMEOUT_MS,
  resolveClassroomContentRetryOptions,
  resolveSceneActionsOutputTokens,
  resolveSceneContentTimeoutMs,
  resolveSceneContentOutputTokens,
  SCENE_MODEL_TIMEOUT_MS,
} from '@/lib/generation/scene-generation-policy';

describe('scene generation policy', () => {
  it('keeps resumed classroom generation to one automatic retry', () => {
    expect(CLASSROOM_SCENE_RETRY_OPTIONS.maxRetries).toBe(1);
  });

  it('caps oversized model output windows by scene type', () => {
    expect(resolveSceneContentOutputTokens('slide', 128_000)).toBe(16_384);
    expect(resolveSceneContentOutputTokens('quiz', 128_000)).toBe(16_384);
    expect(resolveSceneContentOutputTokens('interactive', 128_000)).toBe(16_384);
    expect(resolveSceneContentOutputTokens('pbl', 128_000)).toBe(32_768);
  });

  it('preserves smaller provider limits', () => {
    expect(resolveSceneContentOutputTokens('slide', 4096)).toBe(4096);
    expect(resolveSceneActionsOutputTokens(8192)).toBe(8192);
  });

  it('caps action generation and bounds one provider attempt', () => {
    expect(resolveSceneActionsOutputTokens(128_000)).toBe(16_384);
    expect(SCENE_MODEL_TIMEOUT_MS).toBe(180_000);
  });

  it('allows one longer attempt for HTML-heavy scenes without automatic retries', () => {
    expect(resolveSceneContentTimeoutMs('interactive')).toBe(LONG_SCENE_MODEL_TIMEOUT_MS);
    expect(resolveSceneContentTimeoutMs('pbl')).toBe(LONG_SCENE_MODEL_TIMEOUT_MS);
    expect(resolveSceneContentTimeoutMs('slide')).toBe(SCENE_MODEL_TIMEOUT_MS);
    expect(resolveClassroomContentRetryOptions('interactive').maxRetries).toBe(0);
    expect(resolveClassroomContentRetryOptions('pbl').maxRetries).toBe(0);
    expect(resolveClassroomContentRetryOptions('slide').maxRetries).toBe(1);
  });
});
