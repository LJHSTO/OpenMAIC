import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { generateEditPlan } from '@/lib/modification/plan-generator';
import { validateEditPlanForScene } from '@/lib/modification/validators';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import type { ModifyScenePlanRequest } from '@/lib/types/modification';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ModifyScenePlanRequest;

    if (!body.scene) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'scene is required');
    }
    if (!body.instruction || typeof body.instruction !== 'string') {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'instruction is required');
    }
    if (
      body.scene.type !== 'slide' &&
      body.scene.type !== 'quiz' &&
      body.scene.type !== 'interactive'
    ) {
      return apiError(
        'INVALID_REQUEST',
        400,
        `Scene type ${body.scene.type} is not supported by scene modification`,
      );
    }
    if (
      body.mode === 'spot' &&
      (body.scene.type !== 'slide' ||
        !body.selectedElementIds ||
        body.selectedElementIds.length === 0)
    ) {
      return apiError('INVALID_REQUEST', 400, 'spot mode requires selected slide element IDs');
    }

    const { model, modelInfo, modelString, thinkingConfig } = await resolveModelFromRequest(
      req,
      body,
    );

    const aiCall = async (systemPrompt: string, userPrompt: string) => {
      const result = await callLLM(
        {
          model,
          system: systemPrompt,
          prompt: userPrompt,
          maxOutputTokens: modelInfo?.outputWindow,
        },
        'modify-scene-plan',
        undefined,
        thinkingConfig,
      );
      return result.text;
    };

    const result = await generateEditPlan(body, aiCall);
    if (!result.success) {
      return apiError('GENERATION_FAILED', 500, result.error ?? 'Failed to generate edit plan');
    }

    if (result.needsClarification) {
      return apiSuccess({
        needsClarification: true,
        questions: result.questions ?? [],
        model: modelString,
      });
    }

    if (!result.plan) {
      return apiError('GENERATION_FAILED', 500, 'Edit plan generation returned no plan');
    }

    const validation = validateEditPlanForScene(body.scene, result.plan);
    return apiSuccess({
      plan: result.plan,
      validation,
      model: modelString,
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
