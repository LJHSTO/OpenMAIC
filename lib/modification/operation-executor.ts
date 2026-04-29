import { createDiffSummary } from '@/lib/modification/diff-engine';
import { validateEditPlanForScene } from '@/lib/modification/validators';
import type { EditPlan, ExecuteEditPlanResult } from '@/lib/types/modification';
import type { QuizContent, Scene, SlideContent } from '@/lib/types/stage';
import type { PPTElement } from '@/lib/types/slides';

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

function getOperationId(plan: EditPlan, index: number): string {
  return plan.operations[index].id ?? `${plan.id}:${index}`;
}

function applySlideOperations(scene: Scene, plan: EditPlan, appliedOperationIds: string[]) {
  const content = scene.content as SlideContent;
  let elements = [...content.canvas.elements];

  plan.operations.forEach((operation, index) => {
    switch (operation.type) {
      case 'slide.update_element': {
        const safePatch = withoutIdentityPatch(operation.patch);
        elements = elements.map((element) =>
          element.id === operation.elementId
            ? ({ ...element, ...safePatch } as PPTElement)
            : element,
        );
        appliedOperationIds.push(getOperationId(plan, index));
        break;
      }
      case 'slide.add_element': {
        elements = [...elements, clone(operation.element)];
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
        const safePatch = withoutIdPatch(operation.patch);
        questions = questions.map((question) =>
          question.id === operation.questionId ? { ...question, ...safePatch } : question,
        );
        appliedOperationIds.push(getOperationId(plan, index));
        break;
      }
      case 'quiz.add_question': {
        questions = [...questions, clone(operation.question)];
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
    } else {
      return {
        success: false,
        appliedOperationIds,
        errors: [`Scene type ${previewScene.type} is not supported in phase 1`],
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
