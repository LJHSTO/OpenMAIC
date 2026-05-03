import { createDiffSummary } from '@/lib/modification/diff-engine';
import {
  extractJsonScriptContent,
  replaceJsonScriptContent,
  sanitizeStringsDeep,
} from '@/lib/modification/sanitize';
import { validateEditPlanForScene } from '@/lib/modification/validators';
import type { EditPlan, ExecuteEditPlanResult } from '@/lib/types/modification';
import type { InteractiveContent, QuizContent, Scene, SlideContent } from '@/lib/types/stage';
import type { PPTElement } from '@/lib/types/slides';
import type { WidgetConfig } from '@/lib/types/widgets';

function parseEmbeddedWidgetConfig(html: string | undefined): WidgetConfig | undefined {
  if (!html) return undefined;
  const json = extractJsonScriptContent(html, 'widget-config');
  if (!json) return undefined;
  try {
    return JSON.parse(json) as WidgetConfig;
  } catch {
    return undefined;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withoutIdentityPatch<T extends Record<string, unknown>>(patch: T): T {
  const { id: _id, type: _type, ...safePatch } = patch;
  return safePatch as T;
}

function withoutIdPatch<T extends Record<string, unknown>>(patch: T): T {
  const { id: _id, ...safePatch } = patch;
  return safePatch as T;
}

function withoutTypePatch<T extends Record<string, unknown>>(patch: T): T {
  const { type: _type, ...safePatch } = patch;
  return safePatch as T;
}

function getOperationId(plan: EditPlan, index: number): string {
  return plan.operations[index].id ?? `${plan.id}:${index}`;
}

function applySlideOperations(scene: Scene, plan: EditPlan, appliedOperationIds: string[]) {
  const content = scene.content as SlideContent;
  let elements = [...content.canvas.elements];

  plan.operations.forEach((operation, index) => {
    switch (operation.type) {
      case 'slide.update_element': {
        const safePatch = sanitizeStringsDeep(withoutIdentityPatch(operation.patch));
        elements = elements.map((element) =>
          element.id === operation.elementId
            ? ({ ...element, ...safePatch } as PPTElement)
            : element,
        );
        appliedOperationIds.push(getOperationId(plan, index));
        break;
      }
      case 'slide.add_element': {
        elements = [...elements, sanitizeStringsDeep(clone(operation.element))];
        appliedOperationIds.push(getOperationId(plan, index));
        break;
      }
      case 'slide.delete_element': {
        elements = elements.filter((element) => element.id !== operation.elementId);
        appliedOperationIds.push(getOperationId(plan, index));
        break;
      }
      case 'slide.move_element': {
        elements = elements.map((element) =>
          element.id === operation.elementId
            ? { ...element, left: element.left + operation.dx, top: element.top + operation.dy }
            : element,
        );
        appliedOperationIds.push(getOperationId(plan, index));
        break;
      }
    }
  });

  scene.content = {
    ...content,
    canvas: {
      ...content.canvas,
      elements,
    },
  };
}

function applyQuizOperations(scene: Scene, plan: EditPlan, appliedOperationIds: string[]) {
  const content = scene.content as QuizContent;
  let questions = [...content.questions];

  plan.operations.forEach((operation, index) => {
    switch (operation.type) {
      case 'quiz.update_question': {
        const safePatch = sanitizeStringsDeep(withoutIdPatch(operation.patch));
        questions = questions.map((question) =>
          question.id === operation.questionId ? { ...question, ...safePatch } : question,
        );
        appliedOperationIds.push(getOperationId(plan, index));
        break;
      }
      case 'quiz.add_question': {
        questions = [...questions, sanitizeStringsDeep(clone(operation.question))];
        appliedOperationIds.push(getOperationId(plan, index));
        break;
      }
      case 'quiz.delete_question': {
        questions = questions.filter((question) => question.id !== operation.questionId);
        appliedOperationIds.push(getOperationId(plan, index));
        break;
      }
    }
  });

  scene.content = {
    ...content,
    questions,
  };
}

function applyInteractiveOperations(scene: Scene, plan: EditPlan, appliedOperationIds: string[]) {
  const content = scene.content as InteractiveContent;
  let nextContent: InteractiveContent = { ...content };

  plan.operations.forEach((operation, index) => {
    switch (operation.type) {
      case 'interactive.update_widget_config': {
        const widgetConfig = nextContent.widgetConfig
          ? (sanitizeStringsDeep({
              ...nextContent.widgetConfig,
              ...withoutTypePatch(operation.patch),
            }) as WidgetConfig)
          : nextContent.widgetConfig;
        nextContent = {
          ...nextContent,
          widgetConfig,
          html: replaceJsonScriptContent(nextContent.html, 'widget-config', widgetConfig),
        };
        appliedOperationIds.push(getOperationId(plan, index));
        break;
      }
      case 'interactive.replace_widget_config': {
        nextContent = {
          ...nextContent,
          widgetType: operation.widgetConfig.type,
          widgetConfig: sanitizeStringsDeep(clone(operation.widgetConfig)),
        };
        nextContent.html = replaceJsonScriptContent(
          nextContent.html,
          'widget-config',
          nextContent.widgetConfig,
        );
        appliedOperationIds.push(getOperationId(plan, index));
        break;
      }
      case 'interactive.update_teacher_actions': {
        nextContent = {
          ...nextContent,
          teacherActions: sanitizeStringsDeep(clone(operation.teacherActions)),
        };
        appliedOperationIds.push(getOperationId(plan, index));
        break;
      }
      case 'interactive.replace_html': {
        const widgetConfig = operation.widgetConfig ?? parseEmbeddedWidgetConfig(operation.html);
        const widgetType = operation.widgetType ?? widgetConfig?.type ?? nextContent.widgetType;
        nextContent = {
          ...nextContent,
          html: operation.html,
          widgetType,
          widgetConfig,
          teacherActions: operation.teacherActions
            ? sanitizeStringsDeep(clone(operation.teacherActions))
            : nextContent.teacherActions,
        };
        if (nextContent.widgetConfig) {
          nextContent.html = replaceJsonScriptContent(
            nextContent.html,
            'widget-config',
            nextContent.widgetConfig,
          );
        }
        appliedOperationIds.push(getOperationId(plan, index));
        break;
      }
    }
  });

  scene.content = nextContent;
}

export function executeEditPlan(scene: Scene, plan: EditPlan): ExecuteEditPlanResult {
  const validation = validateEditPlanForScene(scene, plan);
  if (!validation.valid) {
    return {
      success: false,
      appliedOperationIds: [],
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }

  const previewScene = clone(scene);
  const appliedOperationIds: string[] = [];

  try {
    if (previewScene.type === 'slide') {
      applySlideOperations(previewScene, plan, appliedOperationIds);
    } else if (previewScene.type === 'quiz') {
      applyQuizOperations(previewScene, plan, appliedOperationIds);
    } else if (previewScene.type === 'interactive') {
      applyInteractiveOperations(previewScene, plan, appliedOperationIds);
    } else {
      return {
        success: false,
        appliedOperationIds,
        errors: [`Scene type ${previewScene.type} is not supported`],
        warnings: validation.warnings,
      };
    }

    previewScene.updatedAt = Date.now();
    const diffSummary = createDiffSummary(scene, previewScene, plan, validation.warnings);

    return {
      success: true,
      previewScene,
      diffSummary,
      appliedOperationIds,
      errors: [],
      warnings: validation.warnings,
    };
  } catch (error) {
    return {
      success: false,
      appliedOperationIds,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: validation.warnings,
    };
  }
}
