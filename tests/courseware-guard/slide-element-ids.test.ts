import { describe, expect, it } from 'vitest';
import { restoreStableSlideElementIdsInScene } from '@/lib/courseware-guard/slide-element-ids';

describe('restoreStableSlideElementIdsInScene', () => {
  it('uses geometry to preserve an image action target when the bitmap becomes native shapes', () => {
    const original = {
      order: 7,
      content: {
        type: 'slide',
        canvas: {
          elements: [
            {
              id: 'diagram-image',
              type: 'image',
              left: 580,
              top: 220,
              width: 360,
              height: 290,
              src: 'gen_img_projection',
            },
          ],
        },
      },
      actions: [{ id: 'spotlight-1', type: 'spotlight', elementId: 'diagram-image' }],
    };
    const repaired = {
      order: 7,
      content: {
        type: 'slide',
        canvas: {
          elements: [
            {
              id: 'new-panel',
              type: 'shape',
              left: 580,
              top: 220,
              width: 360,
              height: 290,
              path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
              viewBox: [1, 1],
            },
            {
              id: 'unrelated-title',
              type: 'text',
              left: 60,
              top: 50,
              width: 880,
              height: 70,
              content: '<p>正交性与投影</p>',
            },
          ],
        },
      },
      actions: original.actions,
    };

    const repairs = restoreStableSlideElementIdsInScene(original, repaired);

    expect(repaired.content.canvas.elements[0].id).toBe('diagram-image');
    expect(repairs).toContainEqual(
      expect.objectContaining({
        after: 'diagram-image',
        strategy: 'action-target-geometry',
      }),
    );
  });

  it('rebinds an unreferenced stable ID when an action target has no strong semantic match', () => {
    const original = {
      order: 8,
      content: {
        type: 'slide',
        canvas: {
          elements: [
            {
              id: 'missing-focus',
              type: 'text',
              left: 60,
              top: 60,
              width: 260,
              height: 60,
              content: '<p>导数的局部线性含义</p>',
            },
            {
              id: 'valid-focus',
              type: 'text',
              left: 360,
              top: 60,
              width: 260,
              height: 60,
              content: '<p>切线斜率</p>',
            },
            {
              id: 'unreferenced-caption',
              type: 'text',
              left: 700,
              top: 400,
              width: 220,
              height: 60,
              content: '<p>补充说明</p>',
            },
          ],
        },
      },
      actions: [
        { id: 'spotlight-missing', type: 'spotlight', elementId: 'missing-focus' },
        { id: 'spotlight-valid', type: 'spotlight', elementId: 'valid-focus' },
      ],
    };
    const repaired = {
      order: 8,
      content: {
        type: 'slide',
        canvas: {
          elements: [
            {
              id: 'valid-focus',
              type: 'text',
              left: 70,
              top: 70,
              width: 260,
              height: 60,
              content: '<p>保留的动作目标</p>',
            },
            {
              id: 'unreferenced-caption',
              type: 'text',
              left: 620,
              top: 360,
              width: 220,
              height: 60,
              content: '<p>重构后的核心说明</p>',
            },
          ],
        },
      },
      actions: original.actions,
    };

    const repairs = restoreStableSlideElementIdsInScene(original, repaired);
    const finalIds = repaired.content.canvas.elements.map((element) => element.id);
    const actionTargetIds = repaired.actions.map((action) => action.elementId);

    expect(finalIds).toContain('valid-focus');
    expect(finalIds).toContain('missing-focus');
    expect(new Set(finalIds).size).toBe(finalIds.length);
    expect(actionTargetIds.every((targetId) => finalIds.includes(targetId))).toBe(true);
    expect(repairs).toContainEqual(
      expect.objectContaining({
        before: 'unreferenced-caption',
        after: 'missing-focus',
        strategy: 'action-target-fallback',
      }),
    );
  });
});
