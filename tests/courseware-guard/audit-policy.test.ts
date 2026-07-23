import { afterEach, describe, expect, it } from 'vitest';
import { resolveCoursewareAuditPolicy } from '@/lib/courseware-guard/audit-policy';

const originalProfile = process.env.OPENMAIC_COURSEWARE_AUDIT_PROFILE;
const originalPasses = process.env.OPENMAIC_COURSEWARE_MAX_REPAIR_PASSES;
const originalRepairsPerScene = process.env.OPENMAIC_COURSEWARE_MAX_REPAIRS_PER_SCENE;
const originalVisionTokens = process.env.OPENMAIC_COURSEWARE_VISION_MAX_OUTPUT_TOKENS;
const originalVisionCache = process.env.OPENMAIC_COURSEWARE_VISION_CACHE;
const originalInteractiveAudit = process.env.OPENMAIC_COURSEWARE_INTERACTIVE_AUDIT;
const originalInteractiveExercise = process.env.OPENMAIC_COURSEWARE_INTERACTIVE_EXERCISE;
const originalInteractiveConcurrency = process.env.OPENMAIC_COURSEWARE_INTERACTIVE_CONCURRENCY;

afterEach(() => {
  if (originalProfile === undefined) delete process.env.OPENMAIC_COURSEWARE_AUDIT_PROFILE;
  else process.env.OPENMAIC_COURSEWARE_AUDIT_PROFILE = originalProfile;
  if (originalPasses === undefined) delete process.env.OPENMAIC_COURSEWARE_MAX_REPAIR_PASSES;
  else process.env.OPENMAIC_COURSEWARE_MAX_REPAIR_PASSES = originalPasses;
  if (originalRepairsPerScene === undefined)
    delete process.env.OPENMAIC_COURSEWARE_MAX_REPAIRS_PER_SCENE;
  else process.env.OPENMAIC_COURSEWARE_MAX_REPAIRS_PER_SCENE = originalRepairsPerScene;
  if (originalVisionTokens === undefined)
    delete process.env.OPENMAIC_COURSEWARE_VISION_MAX_OUTPUT_TOKENS;
  else process.env.OPENMAIC_COURSEWARE_VISION_MAX_OUTPUT_TOKENS = originalVisionTokens;
  if (originalVisionCache === undefined) delete process.env.OPENMAIC_COURSEWARE_VISION_CACHE;
  else process.env.OPENMAIC_COURSEWARE_VISION_CACHE = originalVisionCache;
  if (originalInteractiveAudit === undefined)
    delete process.env.OPENMAIC_COURSEWARE_INTERACTIVE_AUDIT;
  else process.env.OPENMAIC_COURSEWARE_INTERACTIVE_AUDIT = originalInteractiveAudit;
  if (originalInteractiveExercise === undefined)
    delete process.env.OPENMAIC_COURSEWARE_INTERACTIVE_EXERCISE;
  else process.env.OPENMAIC_COURSEWARE_INTERACTIVE_EXERCISE = originalInteractiveExercise;
  if (originalInteractiveConcurrency === undefined)
    delete process.env.OPENMAIC_COURSEWARE_INTERACTIVE_CONCURRENCY;
  else process.env.OPENMAIC_COURSEWARE_INTERACTIVE_CONCURRENCY = originalInteractiveConcurrency;
});

describe('courseware audit policy', () => {
  it('defaults to the balanced low-cost release gate', () => {
    delete process.env.OPENMAIC_COURSEWARE_AUDIT_PROFILE;

    expect(resolveCoursewareAuditPolicy()).toEqual(
      expect.objectContaining({
        profile: 'balanced',
        enableVisionAudit: true,
        strictVisualSemantics: true,
        enableInteractiveAudit: true,
        exerciseInteractives: true,
        interactiveAuditConcurrency: 3,
        maxAutomaticRepairPasses: 2,
        maxRepairsPerScene: 1,
        maxVisionOutputTokens: 1200,
      }),
    );
  });

  it('lets an explicit fast profile disable all model-based review and repair', () => {
    const policy = resolveCoursewareAuditPolicy({ profile: 'fast' });

    expect(policy.enableVisionAudit).toBe(false);
    expect(policy.strictVisualSemantics).toBe(false);
    expect(policy.maxAutomaticRepairPasses).toBe(0);
    expect(policy.maxRepairsPerScene).toBe(0);
  });

  it('uses a bounded output budget when vision review is explicitly enabled in fast mode', () => {
    const policy = resolveCoursewareAuditPolicy({
      profile: 'fast',
      enableVisionAudit: true,
    });

    expect(policy.enableVisionAudit).toBe(true);
    expect(policy.maxVisionOutputTokens).toBe(1200);
  });

  it('accepts bounded environment overrides without allowing unbounded repair loops', () => {
    process.env.OPENMAIC_COURSEWARE_AUDIT_PROFILE = 'strict';
    process.env.OPENMAIC_COURSEWARE_MAX_REPAIR_PASSES = '99';

    const policy = resolveCoursewareAuditPolicy();

    expect(policy.profile).toBe('strict');
    expect(policy.maxAutomaticRepairPasses).toBe(3);
  });

  it('can disable interactive browser checks and clamps their concurrency', () => {
    process.env.OPENMAIC_COURSEWARE_INTERACTIVE_AUDIT = 'false';
    process.env.OPENMAIC_COURSEWARE_INTERACTIVE_EXERCISE = 'true';
    process.env.OPENMAIC_COURSEWARE_INTERACTIVE_CONCURRENCY = '99';

    const policy = resolveCoursewareAuditPolicy();

    expect(policy.enableInteractiveAudit).toBe(false);
    expect(policy.exerciseInteractives).toBe(false);
    expect(policy.interactiveAuditConcurrency).toBe(3);
  });
});
