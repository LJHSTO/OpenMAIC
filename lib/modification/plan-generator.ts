import { nanoid } from 'nanoid';
import { PROMPT_IDS, buildPrompt } from '@/lib/prompts';
import { parseJsonResponse } from '@/lib/generation/json-repair';
import type {
  ClarificationQuestion,
  EditPlan,
  ModifyScenePlanRequest,
} from '@/lib/types/modification';
import type { InteractiveContent, QuizContent, Scene, SlideContent } from '@/lib/types/stage';
import type { PPTElement } from '@/lib/types/slides';

export type ModificationAICall = (systemPrompt: string, userPrompt: string) => Promise<string>;

export interface GenerateEditPlanResult {
  success: boolean;
  plan?: EditPlan;
  needsClarification?: boolean;
  questions?: ClarificationQuestion[];
  rawResponse?: string;
  error?: string;
}

interface LLMPlanResponse {
  needsClarification?: boolean;
  questions?: ClarificationQuestion[];
  plan?: Partial<EditPlan>;
  clarificationQuestions?: ClarificationQuestion[];
  id?: string;
  summary?: string;
  confidence?: number;
  riskLevel?: EditPlan['riskLevel'];
  requiresConfirmation?: boolean;
  operations?: EditPlan['operations'];
}

function stripElementForPrompt(element: PPTElement): Record<string, unknown> {
  const base = {
    id: element.id,
    type: element.type,
    name: element.name,
    left: element.left,
    top: element.top,
    width: element.width,
    height: 'height' in element ? element.height : undefined,
  };

  if (element.type === 'text') {
    return { ...base, content: element.content, defaultColor: element.defaultColor };
  }
  if (element.type === 'image') {
    return { ...base, src: element.src?.slice(0, 120), imageType: element.imageType };
  }
  if (element.type === 'chart') {
    return { ...base, chartType: element.chartType, data: element.data };
  }
  if (element.type === 'shape') {
    return { ...base, text: element.text, fill: element.fill };
  }
  return base;
}

function stripElementReference(element: PPTElement): Record<string, unknown> {
  return {
    id: element.id,
    type: element.type,
    name: element.name,
    left: element.left,
    top: element.top,
    width: element.width,
    height: 'height' in element ? element.height : undefined,
  };
}

export function summarizeSceneForModification(
  scene: Scene,
  options: Pick<ModifyScenePlanRequest, 'mode' | 'selectedElementIds'> = {},
): Record<string, unknown> {
  if (scene.type === 'slide') {
    const content = scene.content as SlideContent;
    const selectedIds = options.selectedElementIds ?? [];
    const selectedIdSet = new Set(selectedIds);
    const targetElements = content.canvas.elements.filter((element) =>
      selectedIdSet.has(element.id),
    );
    const isSpotMode = options.mode === 'spot' && selectedIds.length > 0;

    return {
      id: scene.id,
      type: scene.type,
      title: scene.title,
      canvas: {
        viewportSize: content.canvas.viewportSize,
        viewportRatio: content.canvas.viewportRatio,
        theme: content.canvas.theme,
        background: content.canvas.background,
        elements: isSpotMode
          ? targetElements.map(stripElementForPrompt)
          : content.canvas.elements.map(stripElementForPrompt),
        targetElementIds: isSpotMode ? selectedIds : undefined,
        targetElements: isSpotMode ? targetElements.map(stripElementForPrompt) : undefined,
        otherElementRefs: isSpotMode
          ? content.canvas.elements
              .filter((element) => !selectedIdSet.has(element.id))
              .map(stripElementReference)
          : undefined,
        missingTargetElementIds: isSpotMode
          ? selectedIds.filter((id) => !targetElements.some((element) => element.id === id))
          : undefined,
      },
    };
  }

  if (scene.type === 'quiz') {
    const content = scene.content as QuizContent;
    return {
      id: scene.id,
      type: scene.type,
      title: scene.title,
      questions: content.questions,
    };
  }

  if (scene.type === 'interactive') {
    const content = scene.content as InteractiveContent;
    return {
      id: scene.id,
      type: scene.type,
      title: scene.title,
      url: content.url,
      widgetType: content.widgetType,
      widgetConfig: content.widgetConfig,
      teacherActions: content.teacherActions,
      htmlPreview: content.html
        ? {
            length: content.html.length,
            hasWidgetConfig: /id=["']widget-config["']/.test(content.html),
          }
        : undefined,
      note: 'Interactive planning supports widgetConfig and teacherActions changes. If the request requires full HTML regeneration, ask for clarification instead of generating operations.',
    };
  }

  return {
    id: scene.id,
    type: scene.type,
    title: scene.title,
    note: 'Modification planning does not support this scene type yet.',
  };
}

function normalizeRiskLevel(value: unknown): EditPlan['riskLevel'] {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium';
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function normalizePlan(
  response: LLMPlanResponse,
  request: ModifyScenePlanRequest,
): EditPlan | null {
  const candidate = response.plan ?? response;
  if (!candidate || !Array.isArray(candidate.operations)) return null;
  const selectedElementIds = request.selectedElementIds?.filter(Boolean) ?? [];

  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `plan_${nanoid(8)}`,
    summary:
      typeof candidate.summary === 'string' && candidate.summary
        ? candidate.summary
        : 'Apply the requested scene modification.',
    confidence: normalizeConfidence(candidate.confidence),
    riskLevel: normalizeRiskLevel(candidate.riskLevel),
    requiresConfirmation: true,
    mode: request.mode ?? 'scene',
    targetElementIds: selectedElementIds.length > 0 ? selectedElementIds : undefined,
    operations: candidate.operations,
    clarificationQuestions: candidate.clarificationQuestions,
  };
}

export async function generateEditPlan(
  request: ModifyScenePlanRequest,
  aiCall: ModificationAICall,
): Promise<GenerateEditPlanResult> {
  const prompt = buildPrompt(PROMPT_IDS.MODIFY_SCENE_PLAN, {
    sceneType: request.scene.type,
    sceneTitle: request.scene.title,
    mode: request.mode ?? 'scene',
    languageDirective: request.languageDirective ?? 'Use the same language as the user request.',
    selectedElementIds: request.selectedElementIds?.join(', ') ?? '',
    instruction: request.instruction,
    sceneContext: summarizeSceneForModification(request.scene, {
      mode: request.mode,
      selectedElementIds: request.selectedElementIds,
    }),
  });

  if (!prompt) {
    return { success: false, error: 'Failed to build modify-scene-plan prompt' };
  }

  const rawResponse = await aiCall(prompt.system, prompt.user);
  const parsed = parseJsonResponse<LLMPlanResponse>(rawResponse);

  if (!parsed) {
    return { success: false, rawResponse, error: 'Failed to parse edit plan JSON' };
  }

  if (parsed.needsClarification) {
    return {
      success: true,
      needsClarification: true,
      questions: parsed.questions ?? [],
      rawResponse,
    };
  }

  const plan = normalizePlan(parsed, request);
  if (!plan) {
    return { success: false, rawResponse, error: 'Parsed response did not contain a valid plan' };
  }

  return { success: true, plan, rawResponse };
}
