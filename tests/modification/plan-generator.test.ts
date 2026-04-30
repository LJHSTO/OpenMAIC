import { describe, expect, it } from 'vitest';
import { generateEditPlan, summarizeSceneForModification } from '@/lib/modification/plan-generator';
import type { Scene } from '@/lib/types/stage';
import type { PPTTextElement, Slide } from '@/lib/types/slides';

function textElement(id: string, content: string): PPTTextElement {
  return {
    id,
    type: 'text',
    left: 100,
    top: 80,
    width: 800,
    height: 80,
    rotate: 0,
    content,
    defaultFontName: 'Arial',
    defaultColor: '#111111',
  };
}

function slideScene(): Scene {
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
    elements: [
      textElement('title', '<p>Old title</p>'),
      textElement('subtitle', '<p>Old subtitle</p>'),
    ],
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

describe('summarizeSceneForModification', () => {
  it('keeps full element detail only for selected targets in spot mode', () => {
    const summary = summarizeSceneForModification(slideScene(), {
      mode: 'spot',
      selectedElementIds: ['title'],
    });

    const canvas = summary.canvas as {
      elements: Array<{ id: string; content?: string }>;
      targetElementIds: string[];
      otherElementRefs: Array<{ id: string; content?: string }>;
    };

    expect(canvas.targetElementIds).toEqual(['title']);
    expect(canvas.elements).toHaveLength(1);
    expect(canvas.elements[0]).toMatchObject({ id: 'title', content: '<p>Old title</p>' });
    expect(canvas.otherElementRefs).toEqual([expect.objectContaining({ id: 'subtitle' })]);
    expect(canvas.otherElementRefs[0]).not.toHaveProperty('content');
  });
});

describe('generateEditPlan', () => {
  it('normalizes mode and target element IDs from the request', async () => {
    const result = await generateEditPlan(
      {
        scene: slideScene(),
        instruction: 'Shorten the selected title',
        mode: 'spot',
        selectedElementIds: ['title'],
      },
      async () =>
        JSON.stringify({
          plan: {
            id: 'plan_1',
            summary: 'Shorten title',
            confidence: 0.8,
            riskLevel: 'low',
            requiresConfirmation: true,
            operations: [
              {
                type: 'slide.update_element',
                elementId: 'title',
                patch: { content: '<p>Short title</p>' },
                reason: 'User selected the title',
              },
            ],
          },
        }),
    );

    expect(result.success).toBe(true);
    expect(result.plan).toMatchObject({ mode: 'spot', targetElementIds: ['title'] });
  });
});
