import { type NextRequest, NextResponse } from 'next/server';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { CoursewareValidationError, finalizeCourseware } from '@/lib/server/finalize-courseware';
import type { Scene, Stage } from '@/lib/types/stage';
import type { SceneOutline } from '@/lib/types/generation';
import { createLogger } from '@/lib/logger';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import type { LlmStage } from '@/lib/server/model-routes';
import { callLLM } from '@/lib/ai/llm';
import { repairCoursewareScene } from '@/lib/server/repair-courseware-scene';
import { generateTTSForClassroom } from '@/lib/server/classroom-media-generation';
import { reviewCoursewareScreenshot } from '@/lib/server/courseware-vision-review';

const log = createLogger('CoursewareFinalize API');

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface FinalizeRequestBody {
  stage?: Stage;
  scenes?: Scene[];
  model?: string;
  outlines?: SceneOutline[];
  enableTTS?: boolean;
  enableVisionAudit?: boolean;
}

function hasMissingSpeechAudio(scene: Scene): boolean {
  return (scene.actions ?? []).some((action) => action.type === 'speech' && !action.audioId);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as FinalizeRequestBody;
    if (!body.stage || !Array.isArray(body.scenes) || body.scenes.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: stage, scenes' },
        { status: 400 },
      );
    }

    const stageCache = new Map<LlmStage, Awaited<ReturnType<typeof resolveModelFromRequest>>>();
    const repairAiCall = async (
      repairStage: LlmStage,
      systemPrompt: string,
      userPrompt: string,
      signal?: AbortSignal,
    ): Promise<string> => {
      let resolved = stageCache.get(repairStage);
      if (!resolved) {
        resolved = await resolveModelFromRequest(
          request,
          body as FinalizeRequestBody & Record<string, unknown>,
          repairStage,
        );
        stageCache.set(repairStage, resolved);
      }
      const response = await callLLM(
        {
          model: resolved.model,
          system: systemPrompt,
          prompt: userPrompt,
          maxOutputTokens: resolved.modelInfo?.outputWindow,
          abortSignal: signal,
        },
        'courseware-guard-repair',
        undefined,
        resolved.thinkingConfig,
      );
      return response.text;
    };

    const reviewScreenshot = body.enableVisionAudit
      ? async (input: { scene: Scene; screenshotPath: string }) => {
          let resolved = stageCache.get('courseware-vision-audit');
          if (!resolved) {
            resolved = await resolveModelFromRequest(
              request,
              body as FinalizeRequestBody & Record<string, unknown>,
              'courseware-vision-audit',
            );
            stageCache.set('courseware-vision-audit', resolved);
          }
          if (resolved.modelInfo?.capabilities?.vision !== true) {
            throw new Error(
              `Model ${resolved.modelString} is not configured as vision-capable. Configure MODEL_ROUTES.courseware-vision-audit with a vision model or disable multimodal audit.`,
            );
          }
          return reviewCoursewareScreenshot({
            ...input,
            callVisionModel: async (systemPrompt, userContent) => {
              const response = await callLLM(
                {
                  model: resolved!.model,
                  system: systemPrompt,
                  messages: [{ role: 'user', content: userContent }],
                  maxOutputTokens: Math.min(resolved!.modelInfo?.outputWindow ?? 4096, 4096),
                },
                'courseware-vision-audit',
                undefined,
                resolved!.thinkingConfig,
              );
              return response.text;
            },
          });
        }
      : undefined;

    const finalized = await finalizeCourseware({
      stage: body.stage,
      scenes: body.scenes,
      model: body.model?.trim() || 'unknown-model',
      baseUrl: buildRequestOrigin(request),
      reviewScreenshot,
      repairScene: async (scene, instruction, repairContext) => {
        const repaired = await repairCoursewareScene({
          stage: body.stage!,
          scene,
          scenes: body.scenes!,
          outlines: body.outlines,
          instruction,
          ...repairContext,
          aiCall: repairAiCall,
        });
        if (repaired && body.enableTTS) {
          await generateTTSForClassroom([repaired], body.stage!.id, buildRequestOrigin(request));
          if (hasMissingSpeechAudio(repaired)) {
            throw new Error('Automatic slide repair could not regenerate all narration audio');
          }
        }
        return repaired;
      },
    });
    return NextResponse.json({
      success: true,
      stage: finalized.stage,
      scenes: finalized.scenes,
      guardReport: finalized.guardReport,
      visualReport: finalized.visualReport,
      archive: finalized.archive,
      url: finalized.url,
    });
  } catch (error) {
    if (error instanceof CoursewareValidationError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          guardReport: error.guardReport,
          visualReport: error.visualReport,
          evidenceDir: error.evidenceDir,
          stage: error.stage,
          scenes: error.scenes,
        },
        { status: 422 },
      );
    }
    log.error('Courseware finalization failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
