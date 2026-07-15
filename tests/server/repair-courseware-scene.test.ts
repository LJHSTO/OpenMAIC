import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  planRegenerateApply: vi.fn(),
}));

vi.mock('@/lib/agent/tools/regenerate-scene', () => ({
  makeRegenerateSceneTool: () => ({ execute: mocks.execute }),
}));

vi.mock('@/lib/agent/client/apply-regenerate', () => ({
  planRegenerateApply: mocks.planRegenerateApply,
}));

import { repairCoursewareScene } from '@/lib/server/repair-courseware-scene';

describe('repairCoursewareScene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves narration actions while applying a slide-only layout repair', async () => {
    const originalActions = [
      {
        id: 'speech-1',
        type: 'speech' as const,
        text: 'Existing narration',
        audioId: 'audio-1',
      },
    ];
    const originalContent = {
      type: 'slide' as const,
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
        elements: [],
      },
    };
    const repairedContent = {
      ...originalContent,
      canvas: {
        ...originalContent.canvas,
        elements: [
          {
            id: 'text-1',
            type: 'text' as const,
            left: 100,
            top: 100,
            width: 400,
            height: 100,
            rotate: 0,
            content: '<p>Repaired</p>',
            defaultFontName: 'Arial',
            defaultColor: '#111111',
          },
        ],
      },
    };
    const scene = {
      id: 'scene-1',
      stageId: 'stage-1',
      title: 'Slide',
      order: 0,
      type: 'slide' as const,
      content: originalContent,
      actions: originalActions,
    };
    mocks.execute.mockResolvedValue({ details: { sceneId: scene.id } });
    mocks.planRegenerateApply.mockReturnValue({
      patch: {
        content: repairedContent,
        actions: [{ id: 'new-speech', type: 'speech', text: 'Regenerated without audio' }],
      },
    });

    const result = await repairCoursewareScene({
      stage: { id: 'stage-1', name: 'Course', createdAt: 1, updatedAt: 1 },
      scene,
      scenes: [scene],
      instruction: 'Fix the overlap only.',
      aiCall: vi.fn(),
    });

    expect(result?.content).toEqual(repairedContent);
    expect(result?.actions).toBe(originalActions);
  });

  it('repairs a reported overlap without regenerating the whole slide', async () => {
    const scene = {
      id: 'scene-1',
      stageId: 'stage-1',
      title: 'Slide',
      order: 0,
      type: 'slide' as const,
      content: {
        type: 'slide' as const,
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
              id: 'large',
              type: 'text' as const,
              left: 250,
              top: 360,
              width: 180,
              height: 70,
              rotate: 0,
              content: '<p>Explanation</p>',
              defaultFontName: 'Arial',
              defaultColor: '#111111',
            },
            {
              id: 'small',
              type: 'text' as const,
              left: 210,
              top: 398,
              width: 80,
              height: 46,
              rotate: 0,
              content: '<p>Result</p>',
              defaultFontName: 'Arial',
              defaultColor: '#111111',
            },
          ],
        },
      },
      actions: [],
    };
    const aiCall = vi.fn();

    const result = await repairCoursewareScene({
      stage: { id: 'stage-1', name: 'Course', createdAt: 1, updatedAt: 1 },
      scene,
      scenes: [scene],
      instruction: 'Fix the reported overlap.',
      visualIssues: [
        {
          id: 'visual-0001',
          code: 'content_overlap',
          severity: 'critical',
          sceneId: scene.id,
          elementIds: ['large', 'small'],
          message: 'Elements overlap',
        },
      ],
      hasStructuralIssues: false,
      aiCall,
    });

    expect(result).not.toBeNull();
    expect(result?.content).not.toEqual(scene.content);
    expect(aiCall).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
