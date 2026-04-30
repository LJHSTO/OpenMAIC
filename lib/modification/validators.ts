import { hasUnsafeHtml } from '@/lib/modification/sanitize';
import type { EditOperation, EditPlan, PlanValidationResult } from '@/lib/types/modification';
import type { QuizContent, QuizQuestion, Scene, SlideContent } from '@/lib/types/stage';
import type { PPTElement } from '@/lib/types/slides';

const SLIDE_OPERATION_TYPES = new Set([
  'slide.update_element',
  'slide.add_element',
  'slide.delete_element',
  'slide.move_element',
]);

const QUIZ_OPERATION_TYPES = new Set([
  'quiz.update_question',
  'quiz.add_question',
  'quiz.delete_question',
]);

const ELEMENT_TYPES = new Set([
  'text',
  'image',
  'shape',
  'line',
  'chart',
  'table',
  'latex',
  'video',
  'audio',
  'code',
]);

const QUESTION_TYPES = new Set(['single', 'multiple', 'short_answer']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateSafeStrings(value: unknown, errors: string[], context: string, path = 'value') {
  if (typeof value === 'string') {
    if (hasUnsafeHtml(value)) errors.push(`${context}: unsafe HTML or URL in ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateSafeStrings(item, errors, context, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  Object.entries(value).forEach(([key, entry]) => {
    validateSafeStrings(entry, errors, context, `${path}.${key}`);
  });
}

function validateSlidePatchForElement(
  element: PPTElement,
  patch: Record<string, unknown>,
  errors: string[],
  context: string,
) {
  validateSafeStrings(patch, errors, context, 'patch');

  if ('left' in patch && !isFiniteNumber(patch.left))
    errors.push(`${context}: left must be a number`);
  if ('top' in patch && !isFiniteNumber(patch.top)) errors.push(`${context}: top must be a number`);
  if ('rotate' in patch && !isFiniteNumber(patch.rotate)) {
    errors.push(`${context}: rotate must be a number`);
  }
  if ('width' in patch && (!isFiniteNumber(patch.width) || patch.width <= 0)) {
    errors.push(`${context}: width must be a positive number`);
  }
  if (
    'height' in patch &&
    element.type !== 'line' &&
    (!isFiniteNumber(patch.height) || patch.height <= 0)
  ) {
    errors.push(`${context}: height must be a positive number`);
  }
  if (
    'opacity' in patch &&
    (!isFiniteNumber(patch.opacity) || patch.opacity < 0 || patch.opacity > 1)
  ) {
    errors.push(`${context}: opacity must be a number between 0 and 1`);
  }

  if (element.type === 'line') {
    for (const pointName of ['start', 'end'] as const) {
      if (!(pointName in patch)) continue;
      const point = patch[pointName];
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        !point.every((coordinate) => isFiniteNumber(coordinate))
      ) {
        errors.push(`${context}: ${pointName} must be a numeric [x, y] tuple`);
      }
    }
  }
}

function validateQuizPatch(patch: Record<string, unknown>, errors: string[], context: string) {
  validateSafeStrings(patch, errors, context, 'patch');
  if ('type' in patch && !QUESTION_TYPES.has(patch.type as string)) {
    errors.push(`${context}: unsupported question type`);
  }
  if ('question' in patch && typeof patch.question !== 'string') {
    errors.push(`${context}: question must be a string`);
  }
  if ('options' in patch && !Array.isArray(patch.options)) {
    errors.push(`${context}: options must be an array`);
  }
  if ('answer' in patch && !Array.isArray(patch.answer)) {
    errors.push(`${context}: answer must be an array`);
  }
  if ('points' in patch && (!isFiniteNumber(patch.points) || patch.points <= 0)) {
    errors.push(`${context}: points must be a positive number`);
  }
}

function validatePlanShape(plan: EditPlan, errors: string[], warnings: string[]) {
  if (!plan.id || typeof plan.id !== 'string') errors.push('plan.id is required');
  if (!plan.summary || typeof plan.summary !== 'string') errors.push('plan.summary is required');
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
    errors.push('plan.operations must contain at least one operation');
  }
  if (!isFiniteNumber(plan.confidence) || plan.confidence < 0 || plan.confidence > 1) {
    errors.push('plan.confidence must be a number between 0 and 1');
  }
  if (plan.confidence < 0.5) warnings.push('plan confidence is below 0.5');
  if (plan.riskLevel === 'high') warnings.push('plan risk level is high');
  if (plan.mode && plan.mode !== 'spot' && plan.mode !== 'scene' && plan.mode !== 'conversation') {
    errors.push('plan.mode is invalid');
  }
  if (plan.targetElementIds && !Array.isArray(plan.targetElementIds)) {
    errors.push('plan.targetElementIds must be an array when provided');
  }
}

function getSlideElementMap(scene: Scene): Map<string, PPTElement> {
  const content = scene.content as SlideContent;
  return new Map(content.canvas.elements.map((element) => [element.id, element]));
}

function getQuizQuestionMap(scene: Scene): Map<string, QuizQuestion> {
  const content = scene.content as QuizContent;
  return new Map(content.questions.map((question) => [question.id, question]));
}

function validateElement(element: PPTElement, errors: string[], context: string) {
  if (!element || typeof element !== 'object') {
    errors.push(`${context}: element must be an object`);
    return;
  }
  if (!element.id || typeof element.id !== 'string')
    errors.push(`${context}: element.id is required`);
  if (!ELEMENT_TYPES.has(element.type)) errors.push(`${context}: unsupported element type`);
  if (!isFiniteNumber(element.left)) errors.push(`${context}: element.left must be a number`);
  if (!isFiniteNumber(element.top)) errors.push(`${context}: element.top must be a number`);
  if (!isFiniteNumber(element.width) || element.width <= 0) {
    errors.push(`${context}: element.width must be a positive number`);
  }
  if (element.type !== 'line' && (!isFiniteNumber(element.height) || element.height <= 0)) {
    errors.push(`${context}: element.height must be a positive number`);
  }
  validateSafeStrings(element, errors, context, 'element');
}

function validateQuestion(question: QuizQuestion, errors: string[], context: string) {
  if (!question || typeof question !== 'object') {
    errors.push(`${context}: question must be an object`);
    return;
  }
  if (!question.id || typeof question.id !== 'string')
    errors.push(`${context}: question.id is required`);
  if (!QUESTION_TYPES.has(question.type)) errors.push(`${context}: unsupported question type`);
  if (!question.question || typeof question.question !== 'string') {
    errors.push(`${context}: question text is required`);
  }
  if (question.type !== 'short_answer' && (!question.options || question.options.length === 0)) {
    errors.push(`${context}: choice questions require options`);
  }
  validateSafeStrings(question, errors, context, 'question');
}

function validateSlideOperation(
  scene: Scene,
  operation: EditOperation,
  index: number,
  errors: string[],
  warnings: string[],
) {
  const context = `operation[${index}]`;
  const elements = getSlideElementMap(scene);

  if (!SLIDE_OPERATION_TYPES.has(operation.type)) {
    errors.push(`${context}: operation type ${operation.type} does not apply to slide scenes`);
    return;
  }

  switch (operation.type) {
    case 'slide.update_element': {
      if (!elements.has(operation.elementId)) {
        errors.push(`${context}: element not found: ${operation.elementId}`);
      }
      if (!isRecord(operation.patch)) {
        errors.push(`${context}: patch must be an object`);
      } else {
        if ('id' in operation.patch) errors.push(`${context}: patch cannot change element id`);
        if ('type' in operation.patch) errors.push(`${context}: patch cannot change element type`);
        const element = elements.get(operation.elementId);
        if (element) validateSlidePatchForElement(element, operation.patch, errors, context);
      }
      break;
    }
    case 'slide.add_element': {
      validateElement(operation.element, errors, context);
      if (operation.element?.id && elements.has(operation.element.id)) {
        errors.push(`${context}: duplicate element id: ${operation.element.id}`);
      }
      break;
    }
    case 'slide.delete_element': {
      if (!elements.has(operation.elementId)) {
        errors.push(`${context}: element not found: ${operation.elementId}`);
      }
      break;
    }
    case 'slide.move_element': {
      if (!elements.has(operation.elementId)) {
        errors.push(`${context}: element not found: ${operation.elementId}`);
      }
      if (!isFiniteNumber(operation.dx)) errors.push(`${context}: dx must be a number`);
      if (!isFiniteNumber(operation.dy)) errors.push(`${context}: dy must be a number`);
      break;
    }
  }

  const deleteCount = operation.type === 'slide.delete_element' ? 1 : 0;
  if (deleteCount > 0 && elements.size > 0 && deleteCount / elements.size >= 0.5) {
    warnings.push(`${context}: deletes at least half of slide elements`);
  }
}

function validateSpotOperationScope(
  plan: EditPlan,
  operation: EditOperation,
  index: number,
  errors: string[],
  warnings: string[],
) {
  if (plan.mode !== 'spot') return;
  const context = `operation[${index}]`;
  const targetIds = new Set(plan.targetElementIds ?? []);

  if (targetIds.size === 0) {
    errors.push('spot edit requires at least one targetElementId');
    return;
  }

  if (operation.type === 'slide.add_element') {
    errors.push(`${context}: spot edit cannot add new slide elements`);
    return;
  }

  if (
    (operation.type === 'slide.update_element' ||
      operation.type === 'slide.delete_element' ||
      operation.type === 'slide.move_element') &&
    !targetIds.has(operation.elementId)
  ) {
    errors.push(`${context}: spot edit can only change selected element IDs`);
  }

  if (operation.type === 'slide.delete_element') {
    warnings.push(`${context}: spot edit deletes a selected element`);
  }
}

function validateQuizOperation(
  scene: Scene,
  operation: EditOperation,
  index: number,
  errors: string[],
  warnings: string[],
) {
  const context = `operation[${index}]`;
  const questions = getQuizQuestionMap(scene);

  if (!QUIZ_OPERATION_TYPES.has(operation.type)) {
    errors.push(`${context}: operation type ${operation.type} does not apply to quiz scenes`);
    return;
  }

  switch (operation.type) {
    case 'quiz.update_question': {
      if (!questions.has(operation.questionId)) {
        errors.push(`${context}: question not found: ${operation.questionId}`);
      }
      if (!isRecord(operation.patch)) {
        errors.push(`${context}: patch must be an object`);
      } else {
        if ('id' in operation.patch) errors.push(`${context}: patch cannot change question id`);
        if ('answer' in operation.patch) warnings.push(`${context}: modifies a quiz answer`);
        validateQuizPatch(operation.patch, errors, context);
      }
      break;
    }
    case 'quiz.add_question': {
      validateQuestion(operation.question, errors, context);
      if (operation.question?.id && questions.has(operation.question.id)) {
        errors.push(`${context}: duplicate question id: ${operation.question.id}`);
      }
      break;
    }
    case 'quiz.delete_question': {
      if (!questions.has(operation.questionId)) {
        errors.push(`${context}: question not found: ${operation.questionId}`);
      }
      if (questions.size <= 1) warnings.push(`${context}: deletes the last quiz question`);
      break;
    }
  }
}

export function validateEditPlanForScene(scene: Scene, plan: EditPlan): PlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  validatePlanShape(plan, errors, warnings);

  const operations = Array.isArray(plan.operations) ? plan.operations : [];
  const deleteCount = operations.filter(
    (operation) =>
      operation.type === 'slide.delete_element' || operation.type === 'quiz.delete_question',
  ).length;

  if (scene.type === 'slide') {
    const elementCount = getSlideElementMap(scene).size;
    if (deleteCount > 0 && elementCount > 0 && deleteCount / elementCount >= 0.5) {
      warnings.push('plan deletes at least half of slide elements');
    }
  }

  if (scene.type === 'quiz') {
    const questionCount = getQuizQuestionMap(scene).size;
    if (deleteCount > 0 && questionCount > 0 && deleteCount / questionCount >= 0.5) {
      warnings.push('plan deletes at least half of quiz questions');
    }
  }

  operations.forEach((operation, index) => {
    if (scene.type === 'slide') {
      validateSlideOperation(scene, operation, index, errors, warnings);
      validateSpotOperationScope(plan, operation, index, errors, warnings);
      return;
    }
    if (scene.type === 'quiz') {
      validateQuizOperation(scene, operation, index, errors, warnings);
      return;
    }
    errors.push(`operation[${index}]: scene type ${scene.type} is not supported in phase 1`);
  });

  return { valid: errors.length === 0, errors, warnings };
}
