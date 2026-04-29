import { NextRequest } from 'next/server';
import { executeEditPlan } from '@/lib/modification/operation-executor';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import type { ModifyScenePreviewRequest } from '@/lib/types/modification';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ModifyScenePreviewRequest;

    if (!body.scene) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'scene is required');
    }
    if (!body.plan) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'plan is required');
    }

    const result = executeEditPlan(body.scene, body.plan);
    if (!result.success) {
      return apiError('INVALID_REQUEST', 400, result.errors.join('; ') || 'Failed to execute plan');
    }

    return apiSuccess({
      previewScene: result.previewScene,
      diffSummary: result.diffSummary,
      appliedOperationIds: result.appliedOperationIds,
      warnings: result.warnings,
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
