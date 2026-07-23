import { describe, expect, it } from 'vitest';
import { applyDeterministicVisualRepairs } from '@/lib/server/courseware-layout-repair';
import type { Scene } from '@/lib/types/stage';
import type { VisualAuditIssue } from '@/lib/courseware-guard/visual-audit';

function slideScene(): Scene {
  return {
    id: 'scene-1',
    stageId: 'stage-1',
    title: 'Continuity',
    order: 0,
    type: 'slide',
    content: {
      type: 'slide',
      canvas: {
        id: 'canvas-1',
        viewportSize: 1000,
        viewportRatio: 0.5625,
        theme: {
          backgroundColor: '#ffffff',
          themeColors: ['#111111'],
          fontColor: '#111111',
          fontName: 'Arial',
        },
        elements: [
          {
            id: 'explanation',
            type: 'text',
            left: 250,
            top: 360,
            width: 180,
            height: 70,
            rotate: 0,
            content: '<p>Limit exists but differs from f(a)</p>',
            defaultFontName: 'Arial',
            defaultColor: '#2980B9',
          },
          {
            id: 'result',
            type: 'text',
            left: 210,
            top: 398,
            width: 80,
            height: 46,
            rotate: 0,
            content: '<p>Discontinuous</p>',
            defaultFontName: 'Arial',
            defaultColor: '#E74C3C',
          },
        ],
      },
    },
    actions: [],
  };
}

function issue(overrides: Partial<VisualAuditIssue>): VisualAuditIssue {
  return {
    id: 'visual-0001',
    code: 'content_overlap',
    severity: 'critical',
    sceneId: 'scene-1',
    message: 'Elements overlap',
    ...overrides,
  };
}

describe('deterministic courseware layout repair', () => {
  it('moves the smaller reported element to the nearest non-overlapping position', () => {
    const source = slideScene();
    const result = applyDeterministicVisualRepairs(source, [
      issue({ elementIds: ['explanation', 'result'] }),
    ]);
    const elements =
      result.scene.content.type === 'slide' ? result.scene.content.canvas.elements : [];
    const explanation = elements.find((element) => element.id === 'explanation');
    const repaired = elements.find((element) => element.id === 'result');
    if (explanation?.type !== 'text' || repaired?.type !== 'text') {
      throw new Error('test fixture elements are not text elements');
    }

    expect(result.handledIssueIds).toEqual(['visual-0001']);
    const separatedHorizontally =
      repaired.left + repaired.width <= explanation.left ||
      explanation.left + explanation.width <= repaired.left;
    const separatedVertically =
      repaired.top + repaired.height <= explanation.top ||
      explanation.top + explanation.height <= repaired.top;
    expect(separatedHorizontally || separatedVertically).toBe(true);
    expect(repaired.content).toBe('<p>Discontinuous</p>');
    expect(source.content.type === 'slide' && source.content.canvas.elements[1].left).toBe(210);
  });

  it('expands a reported overflowing text box without rewriting its content', () => {
    const source = slideScene();
    const text = source.content.type === 'slide' ? source.content.canvas.elements[0] : null;
    if (!text || text.type !== 'text') throw new Error('test fixture is not a text element');
    text.height = 40;

    const result = applyDeterministicVisualRepairs(source, [
      issue({ code: 'text_overflow', elementIds: ['explanation'] }),
    ]);
    const repaired =
      result.scene.content.type === 'slide' ? result.scene.content.canvas.elements[0] : null;
    if (!repaired || repaired.type !== 'text') {
      throw new Error('repaired fixture is not a text element');
    }

    expect(result.handledIssueIds).toEqual(['visual-0001']);
    expect(repaired.height).toBeGreaterThan(40);
    expect(repaired.content).toBe('<p>Limit exists but differs from f(a)</p>');
  });

  it('avoids nearby content instead of moving an overlapping label below the footer', () => {
    const source = slideScene();
    if (source.content.type !== 'slide') throw new Error('test fixture is not a slide');
    const explanation = source.content.canvas.elements[0];
    const resultLabel = source.content.canvas.elements[1];
    if (explanation.type !== 'text' || resultLabel.type !== 'text') {
      throw new Error('test fixture elements are not text elements');
    }
    explanation.top = 342;
    resultLabel.top = 420;
    source.content.canvas.elements.push({
      id: 'footer',
      type: 'text',
      left: 100,
      top: 454,
      width: 800,
      height: 52,
      rotate: 0,
      content: '<p>Summary</p>',
      defaultFontName: 'Arial',
      defaultColor: '#111111',
    });

    const repaired = applyDeterministicVisualRepairs(source, [
      issue({ elementIds: ['result', 'footer'] }),
    ]);
    if (repaired.scene.content.type !== 'slide') throw new Error('repaired scene is not a slide');
    const byId = new Map(
      repaired.scene.content.canvas.elements.map((element) => [element.id, element]),
    );
    const moved = byId.get('result')!;
    const fixedExplanation = byId.get('explanation')!;
    const footer = byId.get('footer')!;
    if (moved.type !== 'text' || fixedExplanation.type !== 'text' || footer.type !== 'text') {
      throw new Error('repaired fixture elements are not text elements');
    }
    const separated = (left: typeof moved, right: typeof moved) =>
      left.left + left.width <= right.left ||
      right.left + right.width <= left.left ||
      left.top + left.height <= right.top ||
      right.top + right.height <= left.top;

    expect(repaired.handledIssueIds).toEqual(['visual-0001']);
    expect(separated(moved, fixedExplanation)).toBe(true);
    expect(separated(moved, footer)).toBe(true);
    expect(moved.top).toBeLessThan(footer.top);
  });

  it('leaves semantic findings for human confirmation', () => {
    const source = slideScene();
    const result = applyDeterministicVisualRepairs(source, [
      issue({ code: 'vision_issue', severity: 'warning', category: 'semantic_confusion' }),
    ]);

    expect(result.scene).toBe(source);
    expect(result.handledIssueIds).toEqual([]);
  });

  it('removes a flagged unreadable bitmap before AI rebuilds the diagram', () => {
    const source = slideScene();
    if (source.content.type !== 'slide') throw new Error('fixture is not a slide');
    source.content.canvas.elements.push({
      id: 'unreadable-diagram',
      type: 'image',
      left: 520,
      top: 160,
      width: 420,
      height: 260,
      rotate: 0,
      src: 'gen_img_unreadable',
      fixedRatio: false,
    });

    const result = applyDeterministicVisualRepairs(source, [
      issue({
        code: 'vision_issue',
        severity: 'warning',
        category: 'legibility',
        elementIds: ['unreadable-diagram'],
        message: 'Embedded labels are too small to read',
      }),
    ]);
    if (result.scene.content.type !== 'slide') throw new Error('result is not a slide');

    expect(result.scene).not.toBe(source);
    expect(
      result.scene.content.canvas.elements.some((element) => element.id === 'unreadable-diagram'),
    ).toBe(false);
    expect(result.handledIssueIds).toEqual([]);
    expect(
      source.content.canvas.elements.some((element) => element.id === 'unreadable-diagram'),
    ).toBe(true);
  });
});
