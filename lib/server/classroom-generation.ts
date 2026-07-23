import { nanoid } from 'nanoid';
import { callLLM } from '@/lib/ai/llm';
import { createStageAPI } from '@/lib/api/stage-api';
import type { StageStore } from '@/lib/api/stage-api-types';
import {
  applyOutlineFallbacks,
  generateSceneOutlinesFromRequirements,
} from '@/lib/generation/outline-generator';
import { buildVisionUserContent } from '@/lib/generation/prompt-formatters';
import {
  createSceneWithActions,
  generateSceneActions,
  generateSceneContent,
} from '@/lib/generation/scene-generator';
import type { AICallFn } from '@/lib/generation/pipeline-types';
import type { AgentInfo } from '@/lib/generation/pipeline-types';
import { getDefaultAgents } from '@/lib/orchestration/registry/store';
import { createLogger } from '@/lib/logger';
import { isProviderKeyRequired } from '@/lib/ai/providers';
import { resolveClassroomWebSearchConfig } from '@/lib/server/web-search-config';
import { resolveModel } from '@/lib/server/resolve-model';
import { getStageModel } from '@/lib/server/model-routes';
import { resolveVocationalActive } from '@/lib/config/feature-flags';
import { buildSearchQuery } from '@/lib/server/search-query-builder';
import { formatSearchResultsAsContext, searchWeb } from '@/lib/web-search';
import type { BaiduSubSources, WebSearchProviderId } from '@/lib/web-search/types';
import {
  generateMediaForClassroom,
  replaceMediaPlaceholders,
  generateTTSForClassroom,
} from '@/lib/server/classroom-media-generation';
import { withGenerationRetry } from '@/lib/generation/generation-retry';
import { buildVideoManifestFromOutlines } from '@/lib/media/video-manifest';
import { sortDocumentImagesForVision } from '@/lib/document/bundle';
import type { ImageMapping, PdfImage, UserRequirements } from '@/lib/types/generation';
import type { Scene, Stage } from '@/lib/types/stage';
import { AGENT_COLOR_PALETTE, AGENT_DEFAULT_AVATARS } from '@/lib/constants/agent-defaults';
import { guardGeneratedScene, type CoursewareGuardReport } from '@/lib/courseware-guard';
import {
  resolveCoursewareAuditPolicy,
  type CoursewareAuditProfile,
} from '@/lib/courseware-guard/audit-policy';
import type { CoursewareResourceAuditReport } from '@/lib/courseware-guard/resource-audit';
import type { CoursewareInteractiveAuditReport } from '@/lib/courseware-guard/interactive-audit';
import type { CoursewareKnowledgeAuditReport } from '@/lib/courseware-guard/knowledge-audit';
import type { CoursewareVisualAuditReport } from '@/lib/courseware-guard/visual-audit';
import type { CoursewareArchiveResult } from '@/lib/courseware-guard/archive';
import { finalizeCourseware } from '@/lib/server/finalize-courseware';
import { repairCoursewareScene } from '@/lib/server/repair-courseware-scene';
import { reviewCoursewareScreenshot } from '@/lib/server/courseware-vision-review';

const log = createLogger('Classroom');

export interface GenerateClassroomInput {
  requirement: string;
  /** Optional exact course title used for classroom and archive naming. */
  title?: string;
  /** Optional per-job model (`provider:model`). Falls back to DEFAULT_MODEL. */
  model?: string;
  pdfContent?: { text: string; images: string[] };
  enableWebSearch?: boolean;
  webSearchProviderId?: WebSearchProviderId;
  webSearchApiKey?: string;
  baiduSubSources?: BaiduSubSources;
  enableImageGeneration?: boolean;
  enableVideoGeneration?: boolean;
  enableTTS?: boolean;
  /** Send rendered slide screenshots to a vision-capable LLM during final audit. */
  enableVisionAudit?: boolean;
  /** Quality/cost preset for final validation. Defaults to OPENMAIC_COURSEWARE_AUDIT_PROFILE. */
  auditProfile?: CoursewareAuditProfile;
  agentMode?: 'default' | 'generate';
}

export type ClassroomGenerationStep =
  | 'initializing'
  | 'researching'
  | 'generating_outlines'
  | 'generating_scenes'
  | 'generating_media'
  | 'generating_tts'
  | 'validating'
  | 'persisting'
  | 'visual_auditing'
  | 'repairing'
  | 'archiving'
  | 'completed';

export interface ClassroomGenerationProgress {
  step: ClassroomGenerationStep;
  progress: number;
  message: string;
  scenesGenerated: number;
  totalScenes?: number;
}

export interface GenerateClassroomResult {
  id: string;
  url: string;
  stage: Stage;
  scenes: Scene[];
  scenesCount: number;
  createdAt: string;
  guardReport: CoursewareGuardReport;
  knowledgeReport: CoursewareKnowledgeAuditReport;
  resourceReport: CoursewareResourceAuditReport;
  visualReport: CoursewareVisualAuditReport;
  interactiveReport: CoursewareInteractiveAuditReport;
  archive: CoursewareArchiveResult;
}

function createInMemoryStore(stage: Stage): StageStore {
  let state = {
    stage: stage as Stage | null,
    scenes: [] as Scene[],
    currentSceneId: null as string | null,
    mode: 'playback' as const,
  };

  const listeners: Array<(s: typeof state, prev: typeof state) => void> = [];

  return {
    getState: () => state,
    setState: (partial: Partial<typeof state>) => {
      const prev = state;
      state = { ...state, ...partial };
      listeners.forEach((fn) => fn(state, prev));
    },
    subscribe: (listener: (s: typeof state, prev: typeof state) => void) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
}

function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

async function generateAgentProfiles(
  requirement: string,
  languageDirective: string,
  aiCall: AICallFn,
): Promise<AgentInfo[]> {
  const systemPrompt =
    'You are an expert instructional designer. Generate agent profiles for a multi-agent classroom simulation. Return ONLY valid JSON, no markdown or explanation.';

  const userPrompt = `Generate agent profiles for a course with this requirement:
${requirement}

Requirements:
- Decide the appropriate number of agents based on the course content (typically 3-5)
- Exactly 1 agent must have role "teacher", the rest can be "assistant" or "student"
- Each agent needs: name, role, persona (2-3 sentences describing personality and teaching/learning style)
- Language directive for this course: ${languageDirective}
  Agent names and personas must follow this language directive.

Return a JSON object with this exact structure:
{
  "agents": [
    {
      "name": "string",
      "role": "teacher" | "assistant" | "student",
      "persona": "string (2-3 sentences)"
    }
  ]
}`;

  const response = await aiCall(systemPrompt, userPrompt);
  const rawText = stripCodeFences(response);
  const parsed = JSON.parse(rawText) as {
    agents: Array<{ name: string; role: string; persona: string }>;
  };

  if (!parsed.agents || !Array.isArray(parsed.agents) || parsed.agents.length < 2) {
    throw new Error(`Expected at least 2 agents, got ${parsed.agents?.length ?? 0}`);
  }

  const teacherCount = parsed.agents.filter((a) => a.role === 'teacher').length;
  if (teacherCount !== 1) {
    throw new Error(`Expected exactly 1 teacher, got ${teacherCount}`);
  }

  return parsed.agents.map((a, i) => ({
    id: `gen-server-${i}`,
    name: a.name,
    role: a.role,
    persona: a.persona,
  }));
}

export async function generateClassroom(
  input: GenerateClassroomInput,
  options: {
    baseUrl: string;
    onProgress?: (progress: ClassroomGenerationProgress) => Promise<void> | void;
  },
): Promise<GenerateClassroomResult> {
  const { requirement, pdfContent } = input;

  await options.onProgress?.({
    step: 'initializing',
    progress: 5,
    message: 'Initializing classroom generation',
    scenesGenerated: 0,
  });

  const {
    model: languageModel,
    modelInfo,
    modelString,
    providerId,
    apiKey,
    thinkingConfig: classroomThinking,
  } = await resolveModel({ stage: 'generate-classroom', modelString: input.model });
  log.info(`Using server-configured model: ${modelString}`);

  // Fail fast if the resolved provider has no API key configured
  if (isProviderKeyRequired(providerId) && !apiKey) {
    throw new Error(
      `No API key configured for provider "${providerId}". ` +
        `Set the appropriate key in .env.local or server-providers.yml (e.g. ${providerId.toUpperCase()}_API_KEY).`,
    );
  }

  // The web-search query rewrite is a light, separable stage operators may route
  // to a cheaper model. It defaults to the classroom model and is only
  // re-resolved lazily (inside the web-search branch, and only when a route is
  // configured). This keeps a misconfigured optional route from aborting all
  // classroom generation, and skips the extra resolution when web search is off.
  let searchQueryModel = languageModel;
  let searchQueryThinking = classroomThinking;

  const aiCall: AICallFn = async (systemPrompt, userPrompt, _images) => {
    const request = _images?.length
      ? {
          model: languageModel,
          system: systemPrompt,
          messages: [
            {
              role: 'user' as const,
              content: buildVisionUserContent(userPrompt, _images),
            },
          ],
          maxOutputTokens: modelInfo?.outputWindow,
        }
      : {
          model: languageModel,
          messages: [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userPrompt },
          ],
          maxOutputTokens: modelInfo?.outputWindow,
        };
    const result = await callLLM(request, 'generate-classroom', undefined, classroomThinking);
    return result.text;
  };

  const sceneAiCall: AICallFn = async (systemPrompt, userPrompt, _images) => {
    const request = _images?.length
      ? {
          model: languageModel,
          system: systemPrompt,
          messages: [
            {
              role: 'user' as const,
              content: buildVisionUserContent(userPrompt, _images),
            },
          ],
          maxOutputTokens: modelInfo?.outputWindow,
          maxRetries: 0,
        }
      : {
          model: languageModel,
          messages: [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userPrompt },
          ],
          maxOutputTokens: modelInfo?.outputWindow,
          maxRetries: 0,
        };
    const result = await callLLM(request, 'generate-classroom-scene', undefined, classroomThinking);
    return result.text;
  };

  const searchQueryAiCall: AICallFn = async (systemPrompt, userPrompt, _images) => {
    const result = await callLLM(
      {
        model: searchQueryModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxOutputTokens: 256,
      },
      'web-search-query-rewrite',
      undefined,
      searchQueryThinking,
    );
    return result.text;
  };

  const requirements: UserRequirements = {
    requirement,
  };
  const vocationalActive = resolveVocationalActive(requirements);
  const pdfText = pdfContent?.text || undefined;
  const pdfImages: PdfImage[] | undefined = pdfContent?.images
    .filter((src) => typeof src === 'string' && src.trim())
    .map((src, index) => ({
      id: `img_${index + 1}`,
      src,
      pageNumber: 0,
      description: `Source document image ${index + 1}`,
    }));
  const imageMapping: ImageMapping | undefined = pdfImages?.length
    ? Object.fromEntries(pdfImages.map((image) => [image.id, image.src]))
    : undefined;
  const visionEnabled = modelInfo?.capabilities?.vision === true;

  await options.onProgress?.({
    step: 'researching',
    progress: 10,
    message: 'Researching topic',
    scenesGenerated: 0,
  });

  // Web search (optional, graceful degradation)
  let researchContext: string | undefined;
  if (input.enableWebSearch) {
    const webSearchConfig = resolveClassroomWebSearchConfig(input);
    if (webSearchConfig) {
      // Re-resolve the query-rewrite model only when explicitly routed. If
      // resolution itself fails (e.g. unknown provider in the route), fall back
      // to the classroom model here; a route with a missing key resolves fine
      // and surfaces only later in callLLM, which the outer try/catch below
      // degrades gracefully — either way the pipeline still works.
      const rewriteRoute = getStageModel('web-search-query-rewrite');
      if (rewriteRoute) {
        try {
          const rewriteResolved = await resolveModel({ stage: 'web-search-query-rewrite' });
          searchQueryModel = rewriteResolved.model;
          searchQueryThinking = rewriteResolved.thinkingConfig;
        } catch (err) {
          log.warn(
            `web-search-query-rewrite route "${rewriteRoute}" unavailable; using classroom model for query rewrite`,
            err,
          );
        }
      }
      try {
        const searchQuery = await buildSearchQuery(requirement, pdfText, searchQueryAiCall);

        log.info('Running web search for classroom generation', {
          hasPdfContext: searchQuery.hasPdfContext,
          rawRequirementLength: searchQuery.rawRequirementLength,
          rewriteAttempted: searchQuery.rewriteAttempted,
          finalQueryLength: searchQuery.finalQueryLength,
        });

        const searchResult = await searchWeb({
          providerId: webSearchConfig.providerId,
          query: searchQuery.query,
          apiKey: webSearchConfig.apiKey,
          baseUrl: webSearchConfig.baseUrl,
          baiduSubSources: webSearchConfig.baiduSubSources,
        });
        researchContext = formatSearchResultsAsContext(searchResult);
        if (researchContext) {
          log.info(`Web search returned ${searchResult.sources.length} sources`);
        }
      } catch (e) {
        log.warn('Web search failed, continuing without search context:', e);
      }
    } else {
      log.warn('enableWebSearch is true but no web search API key configured, skipping web search');
    }
  }

  await options.onProgress?.({
    step: 'generating_outlines',
    progress: 15,
    message: 'Generating scene outlines',
    scenesGenerated: 0,
  });

  const outlinesResult = await generateSceneOutlinesFromRequirements(
    requirements,
    pdfText,
    pdfImages,
    aiCall,
    {
      visionEnabled,
      imageMapping,
      imageGenerationEnabled: input.enableImageGeneration,
      videoGenerationEnabled: input.enableVideoGeneration,
      researchContext,
      // NO teacherContext — agents haven't been generated yet
    },
  );

  if (!outlinesResult.success || !outlinesResult.data) {
    log.error('Failed to generate outlines:', outlinesResult.error);
    throw new Error(outlinesResult.error || 'Failed to generate scene outlines');
  }

  const { languageDirective, courseTitle, outlines } = outlinesResult.data;
  log.info(
    `Generated ${outlines.length} scene outlines (languageDirective: ${languageDirective}, courseTitle: ${courseTitle ?? 'n/a'})`,
  );

  await options.onProgress?.({
    step: 'generating_outlines',
    progress: 30,
    message: `Generated ${outlines.length} scene outlines`,
    scenesGenerated: 0,
    totalScenes: outlines.length,
  });

  // Resolve agents based on agentMode — now AFTER outlines so we can use languageDirective
  let agents: AgentInfo[];
  const agentMode = input.agentMode || 'default';
  if (agentMode === 'generate') {
    log.info('Generating custom agent profiles via LLM...');
    try {
      agents = await generateAgentProfiles(requirement, languageDirective, aiCall);
      log.info(`Generated ${agents.length} agent profiles`);
    } catch (e) {
      log.warn('Agent profile generation failed, falling back to defaults:', e);
      agents = getDefaultAgents();
    }
  } else {
    agents = getDefaultAgents();
  }

  const stageId = nanoid(10);
  const stage: Stage = {
    id: stageId,
    name: input.title?.trim() || courseTitle || outlines[0]?.title || requirement.slice(0, 50),
    description: undefined,
    languageDirective,
    videoManifest: buildVideoManifestFromOutlines(outlines),
    style: 'interactive',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    // For LLM-generated agents, embed full configs so the client can
    // hydrate the agent registry without prior IndexedDB data.
    // For default agents, just record IDs — the client already has them.
    ...(agentMode === 'generate'
      ? {
          generatedAgentConfigs: agents.map((a, i) => ({
            id: a.id,
            name: a.name,
            role: a.role,
            persona: a.persona || '',
            avatar: AGENT_DEFAULT_AVATARS[i % AGENT_DEFAULT_AVATARS.length],
            color: AGENT_COLOR_PALETTE[i % AGENT_COLOR_PALETTE.length],
            priority: a.role === 'teacher' ? 10 : a.role === 'assistant' ? 7 : 5,
          })),
        }
      : {
          agentIds: agents.map((a) => a.id),
        }),
  };

  const store = createInMemoryStore(stage);
  const api = createStageAPI(store);

  log.info('Stage 2: Generating scene content and actions...');
  let generatedScenes = 0;

  for (const [index, outline] of outlines.entries()) {
    const safeOutline = applyOutlineFallbacks(outline, true, {
      allowProceduralSkill: vocationalActive,
    });
    const progressStart = 30 + Math.floor((index / Math.max(outlines.length, 1)) * 60);

    await options.onProgress?.({
      step: 'generating_scenes',
      progress: Math.max(progressStart, 31),
      message: `Generating scene ${index + 1}/${outlines.length}: ${safeOutline.title}`,
      scenesGenerated: generatedScenes,
      totalScenes: outlines.length,
    });

    const reportSceneRetry = async (
      phase: 'content' | 'actions',
      event: { attempt: number; maxAttempts: number; reason: string },
    ) => {
      const nextAttempt = Math.min(event.attempt + 1, event.maxAttempts);
      const message = `Retrying scene ${index + 1}/${outlines.length} ${phase} (${nextAttempt}/${event.maxAttempts}): ${safeOutline.title}`;
      log.warn(`${message} — ${event.reason}`);
      await options.onProgress?.({
        step: 'generating_scenes',
        progress: Math.max(progressStart, 31),
        message,
        scenesGenerated: generatedScenes,
        totalScenes: outlines.length,
      });
    };

    const suggestedImageIds = new Set(safeOutline.suggestedImageIds ?? []);
    const assignedImages =
      pdfImages && suggestedImageIds.size > 0
        ? sortDocumentImagesForVision(pdfImages.filter((image) => suggestedImageIds.has(image.id)))
        : undefined;
    const content = await withGenerationRetry(
      () =>
        generateSceneContent(safeOutline, sceneAiCall, {
          assignedImages,
          imageMapping,
          visionEnabled,
          agents,
          languageDirective,
          allowProceduralSkill: vocationalActive,
        }),
      {
        label: `scene ${index + 1}/${outlines.length} content`,
        shouldRetryResult: (result) => result === null,
        onRetry: (event) => reportSceneRetry('content', event),
      },
    );
    if (!content) {
      log.warn(`Skipping scene "${safeOutline.title}" — content generation failed`);
      continue;
    }

    const actions = await withGenerationRetry(
      () =>
        generateSceneActions(safeOutline, content, sceneAiCall, {
          agents,
          languageDirective,
        }),
      {
        label: `scene ${index + 1}/${outlines.length} actions`,
        onRetry: (event) => reportSceneRetry('actions', event),
      },
    );
    log.info(`Scene "${safeOutline.title}": ${actions.length} actions`);

    const sceneId = createSceneWithActions(safeOutline, content, actions, api);
    if (!sceneId) {
      log.warn(`Skipping scene "${safeOutline.title}" — scene creation failed`);
      continue;
    }

    const sceneState = store.getState();
    const generatedScene = sceneState.scenes.find((scene) => scene.id === sceneId);
    if (!generatedScene) {
      log.warn(`Skipping scene "${safeOutline.title}" - created scene was not found in store`);
      continue;
    }
    const priorScenes = sceneState.scenes.filter((scene) => scene !== generatedScene);
    const sceneGuard = guardGeneratedScene(stage, priorScenes, generatedScene);
    store.setState({
      stage: sceneGuard.bundle.stage,
      scenes: sceneGuard.bundle.scenes,
      currentSceneId: sceneGuard.scene.id,
    });
    log.info(`Scene guard completed for "${safeOutline.title}"`, {
      changed: sceneGuard.report.changed,
      critical: sceneGuard.report.counts.critical,
      warning: sceneGuard.report.counts.warning,
      repairs: sceneGuard.report.repairs.length,
    });

    generatedScenes += 1;
    const progressEnd = 30 + Math.floor(((index + 1) / Math.max(outlines.length, 1)) * 60);
    await options.onProgress?.({
      step: 'generating_scenes',
      progress: Math.min(progressEnd, 90),
      message: `Generated ${generatedScenes}/${outlines.length} scenes`,
      scenesGenerated: generatedScenes,
      totalScenes: outlines.length,
    });
  }

  const scenes = store.getState().scenes;
  log.info(`Pipeline complete: ${scenes.length} scenes generated`);

  if (scenes.length === 0) {
    throw new Error('No scenes were generated');
  }

  // Phase: Media generation (after all scenes generated)
  if (input.enableImageGeneration || input.enableVideoGeneration) {
    await options.onProgress?.({
      step: 'generating_media',
      progress: 90,
      message: 'Generating media files',
      scenesGenerated: scenes.length,
      totalScenes: outlines.length,
    });

    try {
      const mediaMap = await generateMediaForClassroom(outlines, stageId, options.baseUrl);
      replaceMediaPlaceholders(scenes, mediaMap);
      log.info(`Media generation complete: ${Object.keys(mediaMap).length} files`);
    } catch (err) {
      log.warn('Media generation phase failed, continuing:', err);
    }
  }

  // Phase: TTS generation
  if (input.enableTTS) {
    await options.onProgress?.({
      step: 'generating_tts',
      progress: 94,
      message: 'Generating TTS audio',
      scenesGenerated: scenes.length,
      totalScenes: outlines.length,
    });

    try {
      await generateTTSForClassroom(scenes, stageId, options.baseUrl);
      log.info('TTS generation complete');
    } catch (err) {
      log.warn('TTS generation phase failed, continuing:', err);
    }
  }

  const auditPolicy = resolveCoursewareAuditPolicy({
    profile: input.auditProfile,
    enableVisionAudit: input.enableVisionAudit,
  });
  let visionModel: Awaited<ReturnType<typeof resolveModel>> | undefined;
  let repairModel: Awaited<ReturnType<typeof resolveModel>> | undefined;
  const reviewScreenshot = auditPolicy.enableVisionAudit
    ? async (reviewInput: { scene: Scene; screenshotPath: string }) => {
        visionModel ??= await resolveModel({
          stage: 'courseware-vision-audit',
          modelString: input.model,
        });
        if (visionModel.modelInfo?.capabilities?.vision !== true) {
          throw new Error(
            `Model ${visionModel.modelString} is not configured as vision-capable. Configure MODEL_ROUTES.courseware-vision-audit with a vision model or set enableVisionAudit to false.`,
          );
        }
        return reviewCoursewareScreenshot({
          ...reviewInput,
          cacheNamespace: visionModel.modelString,
          enableCache: auditPolicy.enableVisionCache,
          callVisionModel: async (systemPrompt, userContent) => {
            const result = await callLLM(
              {
                model: visionModel!.model,
                system: systemPrompt,
                messages: [{ role: 'user', content: userContent }],
                maxOutputTokens: Math.min(
                  visionModel!.modelInfo?.outputWindow ?? auditPolicy.maxVisionOutputTokens,
                  auditPolicy.maxVisionOutputTokens,
                ),
              },
              'courseware-vision-audit',
              undefined,
              visionModel!.thinkingConfig,
            );
            return result.text;
          },
        });
      }
    : undefined;

  const finalized = await finalizeCourseware({
    stage,
    scenes,
    outlines,
    model: modelString,
    baseUrl: options.baseUrl,
    reviewScreenshot,
    auditPolicy,
    strictVisualSemantics: auditPolicy.strictVisualSemantics,
    regenerateNarrationAudio: input.enableTTS
      ? async (changedScenes) => {
          await generateTTSForClassroom(changedScenes, stageId, options.baseUrl);
          if (
            changedScenes.some((scene) =>
              (scene.actions ?? []).some((action) => action.type === 'speech' && !action.audioId),
            )
          ) {
            throw new Error('Portable narration repair could not regenerate all audio');
          }
        }
      : undefined,
    repairScene: async (scene, instruction, repairContext) => {
      return repairCoursewareScene({
        stage,
        scene,
        scenes,
        outlines,
        instruction,
        ...repairContext,
        aiCall: async (_repairStage, systemPrompt, userPrompt) => {
          repairModel ??= await resolveModel({
            stage: 'courseware-guard-repair',
            modelString: input.model,
          });
          const result = await callLLM(
            {
              model: repairModel.model,
              system: systemPrompt,
              prompt: userPrompt,
              maxOutputTokens: repairModel.modelInfo?.outputWindow,
            },
            'courseware-guard-repair',
            undefined,
            repairModel.thinkingConfig,
          );
          return result.text;
        },
      });
    },
    onPhase: async (step, message) => {
      await options.onProgress?.({
        step,
        progress: step === 'validating' ? 97 : step === 'persisting' ? 98 : 99,
        message,
        scenesGenerated: scenes.length,
        totalScenes: outlines.length,
      });
    },
  });
  log.info(`Courseware archive created: ${finalized.archive.path}`);

  await options.onProgress?.({
    step: 'completed',
    progress: 100,
    message: 'Classroom generation completed',
    scenesGenerated: scenes.length,
    totalScenes: outlines.length,
  });

  return {
    id: finalized.id,
    url: finalized.url,
    stage: finalized.stage,
    scenes: finalized.scenes,
    scenesCount: finalized.scenes.length,
    createdAt: finalized.createdAt,
    guardReport: finalized.guardReport,
    knowledgeReport: finalized.knowledgeReport,
    resourceReport: finalized.resourceReport,
    visualReport: finalized.visualReport,
    interactiveReport: finalized.interactiveReport,
    archive: finalized.archive,
  };
}
