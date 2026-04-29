import { describe, expect, it } from 'vitest';
import { executeEditPlan } from '@/lib/modification/operation-executor';
import { validateEditPlanForScene } from '@/lib/modification/validators';
import type { EditPlan } from '@/lib/types/modification';
import type { QuizQuestion, Scene } from '@/lib/types/stage';
import type { PPTTextElement, Slide } from '@/lib/types/slides';

function textElement(overrides: Partial<PPTTextElement> = {}): PPTTextElement {
  return {
    id: 'title',
    type: 'text',
    left: 100,
    top: 80,
    width: 800,
    height: 80,
    rotate: 0,
    content: '<p>Old title</p>',
    defaultFontName: 'Arial',
    defaultColor: '#111111',
    ...overrides,
  };
}

function slideScene(elements = [textElement()]): Scene {
  const canvas: Slide = {
    id: 'slide_canvas',
    viewportSize: 1000,
    viewportRatio: 16 / 9,
    theme: {
      backgroundColor: '#ffffff',
      themeColors: ['#111111'],
      fontColor: '#111111',
      fontName: 'Arial',
    },
    elements,
  };

  return {
    id: 'scene_1',
    stageId: 'stage_1',
    type: 'slide',
    title: 'Slide scene',
    order: 1,
    content: { type: 'slide', canvas },
  };
}

function quizQuestion(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    id: 'q1',
    type: 'single',
    question: 'Pick one',
    options: [
      { value: 'A', label: 'Alpha' },
      { value: 'B', label: 'Beta' },
    ],
    answer: ['A'],
    analysis: 'A is correct',
    hasAnswer: true,
    points: 1,
    ...overrides,
  };
}

function quizScene(questions = [quizQuestion()]): Scene {
  return {
    id: 'scene_quiz',
    stageId: 'stage_1',
    type: 'quiz',
    title: 'Quiz scene',
    order: 2,
    content: { type: 'quiz', questions },
  };
}

describe('executeEditPlan', () => {
  it('updates a slide element without mutating the original scene', () => {
    const scene = slideScene();
    const plan: EditPlan = {
      id: 'plan_1',
      summary: 'Shorten the title',
      confidence: 0.9,
      riskLevel: 'low',
      requiresConfirmation: true,
      operations: [
        {
          type: 'slide.update_element',
          elementId: 'title',
          patch: { content: '<p>New title</p>' },
          reason: 'User requested a title change',
        },
      ],
    };

    const result = executeEditPlan(scene, plan);

    expect(result.success).toBe(true);
    expect(result.previewScene?.content.type).toBe('slide');
    const preview =
      result.previewScene?.content.type === 'slide' ? result.previewScene.content : null;
    expect(preview?.canvas.elements[0]).toMatchObject({ content: '<p>New title</p>' });
    expect(scene.content.type === 'slide' ? scene.content.canvas.elements[0] : null).toMatchObject({
      content: '<p>Old title</p>',
    });
    expect(result.diffSummary?.updatedCount).toBe(1);
  });

  it('rejects a slide operation targeting an unknown element', () => {
    const scene = slideScene();
    const plan: EditPlan = {
      id: 'plan_missing',
      summary: 'Change missing element',
      confidence: 0.8,
      riskLevel: 'low',
      requiresConfirmation: true,
      operations: [
        {
          type: 'slide.update_element',
          elementId: 'missing',
          patch: { content: '<p>New</p>' },
          reason: 'Invalid target',
        },
      ],
    };

    const result = executeEditPlan(scene, plan);

    expect(result.success).toBe(false);
    expect(result.errors.join('\n')).toContain('element not found');
  });

  it('updates quiz questions and allows changing question type', () => {
    const scene = quizScene();
    const plan: EditPlan = {
      id: 'plan_quiz',
      summary: 'Make the question multiple-choice',
      confidence: 0.85,
      riskLevel: 'medium',
      requiresConfirmation: true,
      operations: [
        {
          type: 'quiz.update_question',
          questionId: 'q1',
          patch: {
            type: 'multiple',
            answer: ['A', 'B'],
            analysis: 'Both answers are acceptable in this version.',
          },
          reason: 'User requested a multiple-choice version',
        },
      ],
    };

    const result = executeEditPlan(scene, plan);

    expect(result.success).toBe(true);
    const preview =
      result.previewScene?.content.type === 'quiz' ? result.previewScene.content : null;
    expect(preview?.questions[0]).toMatchObject({ type: 'multiple', answer: ['A', 'B'] });
    expect(result.warnings.join('\n')).toContain('modifies a quiz answer');
  });
});

describe('validateEditPlanForScene', () => {
  it('handles malformed plans without throwing', () => {
    const scene = slideScene();
    const malformed = {
      id: 'bad',
      summary: 'Bad plan',
      confidence: 0.7,
      riskLevel: 'low',
      requiresConfirmation: true,
    } as EditPlan;

    const validation = validateEditPlanForScene(scene, malformed);

    expect(validation.valid).toBe(false);
    expect(validation.errors.join('\n')).toContain('operations');
  });
});
