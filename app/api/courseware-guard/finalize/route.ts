import { type NextRequest, NextResponse } from 'next/server';
import {
  resolveCoursewareAuditPolicy,
  type CoursewareAuditProfile,
} from '@/lib/courseware-guard/audit-policy';
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
  strictVisualSemantics?: boolean;
  auditProfile?: CoursewareAuditProfile;
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
    const auditPolicy = resolveCoursewareAuditPolicy({
      profile: body.auditProfile,
      enableVisionAudit: body.enableVisionAudit,
      strictVisualSemantics: body.strictVisualSemantics,
    });

    const stageCache = new Map<LlmStage, Awaited<ReturnType<typeof resolveModelFromRequest>>>();
    const repairAiCall = async (
      _repairStage: LlmStage,
      systemPrompt: string,
      userPrompt: string,
      signal?: AbortSignal,
    ): Promise<string> => {
      const repairStage: LlmStage = 'courseware-guard-repair';
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

    const reviewScreenshot = auditPolicy.enableVisionAudit
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
            cacheNamespace: resolved.modelString,
            enableCache: auditPolicy.enableVisionCache,
            callVisionModel: async (systemPrompt, userContent) => {
              const response = await callLLM(
                {
                  model: resolved!.model,
                  system: systemPrompt,
                  messages: [{ role: 'user', content: userContent }],
                  maxOutputTokens: Math.min(
                    resolved!.modelInfo?.outputWindow ?? auditPolicy.maxVisionOutputTokens,
                    auditPolicy.maxVisionOutputTokens,
                  ),
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
      outlines: body.outlines,
      model: body.model?.trim() || 'unknown-model',
      baseUrl: buildRequestOrigin(request),
      reviewScreenshot,
      regenerateNarrationAudio: body.enableTTS
        ? async (scenes) => {
            await generateTTSForClassroom(scenes, body.stage!.id, buildRequestOrigin(request));
            if (scenes.some(hasMissingSpeechAudio)) {
              throw new Error('Portable narration repair could not regenerate all audio');
            }
          }
        : undefined,
      repairScene: async (scene, instruction, repairContext) => {
        return repairCoursewareScene({
          stage: body.stage!,
          scene,
          scenes: body.scenes!,
          outlines: body.outlines,
          instruction,
          ...repairContext,
          aiCall: repairAiCall,
        });
      },
      strictVisualSemantics: auditPolicy.strictVisualSemantics,
      auditPolicy,
    });
    return NextResponse.json({
      success: true,
      stage: finalized.stage,
      scenes: finalized.scenes,
      guardReport: finalized.guardReport,
      knowledgeReport: finalized.knowledgeReport,
      resourceReport: finalized.resourceReport,
      visualReport: finalized.visualReport,
      interactiveReport: finalized.interactiveReport,
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
          knowledgeReport: error.knowledgeReport,
          resourceReport: error.resourceReport,
          visualReport: error.visualReport,
          interactiveReport: error.interactiveReport,
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
