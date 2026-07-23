export type CoursewareAuditProfile = 'fast' | 'balanced' | 'strict';
export type CoursewareContentPolicy = 'standard' | 'strict';

export interface CoursewareAuditPolicy {
  profile: CoursewareAuditProfile;
  contentPolicy: CoursewareContentPolicy;
  enableVisionAudit: boolean;
  strictVisualSemantics: boolean;
  validateResources: boolean;
  blockExternalMedia: boolean;
  enableInteractiveAudit: boolean;
  exerciseInteractives: boolean;
  interactiveAuditConcurrency: number;
  maxAutomaticRepairPasses: number;
  maxRepairsPerScene: number;
  maxVisionOutputTokens: number;
  enableVisionCache: boolean;
}

const PROFILE_POLICIES: Record<CoursewareAuditProfile, CoursewareAuditPolicy> = {
  fast: {
    profile: 'fast',
    contentPolicy: 'standard',
    enableVisionAudit: false,
    strictVisualSemantics: false,
    validateResources: true,
    blockExternalMedia: false,
    enableInteractiveAudit: true,
    exerciseInteractives: false,
    interactiveAuditConcurrency: 4,
    maxAutomaticRepairPasses: 0,
    maxRepairsPerScene: 0,
    maxVisionOutputTokens: 0,
    enableVisionCache: true,
  },
  balanced: {
    profile: 'balanced',
    contentPolicy: 'strict',
    enableVisionAudit: true,
    strictVisualSemantics: true,
    validateResources: true,
    blockExternalMedia: false,
    enableInteractiveAudit: true,
    exerciseInteractives: true,
    interactiveAuditConcurrency: 3,
    maxAutomaticRepairPasses: 2,
    maxRepairsPerScene: 1,
    maxVisionOutputTokens: 1200,
    enableVisionCache: true,
  },
  strict: {
    profile: 'strict',
    contentPolicy: 'strict',
    enableVisionAudit: true,
    strictVisualSemantics: true,
    validateResources: true,
    blockExternalMedia: true,
    enableInteractiveAudit: true,
    exerciseInteractives: true,
    interactiveAuditConcurrency: 2,
    maxAutomaticRepairPasses: 3,
    maxRepairsPerScene: 2,
    maxVisionOutputTokens: 1600,
    enableVisionCache: true,
  },
};

function parseProfile(value: unknown): CoursewareAuditProfile | undefined {
  return value === 'fast' || value === 'balanced' || value === 'strict' ? value : undefined;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function booleanOverride(value: unknown, fallback: boolean): boolean {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

export function resolveCoursewareAuditPolicy(input?: {
  profile?: CoursewareAuditProfile | string;
  enableVisionAudit?: boolean;
  strictVisualSemantics?: boolean;
}): CoursewareAuditPolicy {
  const profile =
    parseProfile(input?.profile) ??
    parseProfile(process.env.OPENMAIC_COURSEWARE_AUDIT_PROFILE?.trim().toLowerCase()) ??
    'balanced';
  const base = PROFILE_POLICIES[profile];
  const policy: CoursewareAuditPolicy = {
    ...base,
    enableVisionAudit: input?.enableVisionAudit ?? base.enableVisionAudit,
    strictVisualSemantics: input?.strictVisualSemantics ?? base.strictVisualSemantics,
    enableInteractiveAudit: booleanOverride(
      process.env.OPENMAIC_COURSEWARE_INTERACTIVE_AUDIT,
      base.enableInteractiveAudit,
    ),
    exerciseInteractives: booleanOverride(
      process.env.OPENMAIC_COURSEWARE_INTERACTIVE_EXERCISE,
      base.exerciseInteractives,
    ),
    interactiveAuditConcurrency: boundedInteger(
      process.env.OPENMAIC_COURSEWARE_INTERACTIVE_CONCURRENCY,
      base.interactiveAuditConcurrency,
      1,
      8,
    ),
    maxAutomaticRepairPasses: boundedInteger(
      process.env.OPENMAIC_COURSEWARE_MAX_REPAIR_PASSES,
      base.maxAutomaticRepairPasses,
      0,
      5,
    ),
    maxRepairsPerScene: boundedInteger(
      process.env.OPENMAIC_COURSEWARE_MAX_REPAIRS_PER_SCENE,
      base.maxRepairsPerScene,
      0,
      3,
    ),
    maxVisionOutputTokens: boundedInteger(
      process.env.OPENMAIC_COURSEWARE_VISION_MAX_OUTPUT_TOKENS,
      base.maxVisionOutputTokens,
      256,
      4096,
    ),
    enableVisionCache:
      process.env.OPENMAIC_COURSEWARE_VISION_CACHE?.trim().toLowerCase() === 'false'
        ? false
        : base.enableVisionCache,
  };
  if (!policy.enableVisionAudit) {
    policy.strictVisualSemantics = false;
    policy.maxVisionOutputTokens = 0;
  } else if (policy.maxVisionOutputTokens < 256) {
    policy.maxVisionOutputTokens = PROFILE_POLICIES.balanced.maxVisionOutputTokens;
  }
  if (policy.maxAutomaticRepairPasses === 0) {
    policy.maxRepairsPerScene = 0;
  }
  if (!policy.enableInteractiveAudit) {
    policy.exerciseInteractives = false;
  }
  return policy;
}
