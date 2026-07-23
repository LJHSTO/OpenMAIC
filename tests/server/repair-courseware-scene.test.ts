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

  it('regenerates only interactive content while preserving scene identity and actions', async () => {
    const actions = [
      {
        id: 'speech-1',
        type: 'speech' as const,
        text: '拖动滑块观察变化',
      },
    ];
    const scene = {
      id: 'interactive-1',
      stageId: 'stage-1',
      title: '极限逼近实验',
      order: 3,
      type: 'interactive' as const,
      content: {
        type: 'interactive' as const,
        url: '',
        html: '<!doctype html><button>broken</button>',
        widgetType: 'simulation' as const,
      },
      actions,
    };
    const repairedContent = {
      ...scene.content,
      html: '<!doctype html><input type="range"><output>0</output>',
    };
    const aiCall = vi.fn().mockResolvedValue(
      JSON.stringify({
        edits: [
          {
            oldText: '<button>broken</button>',
            newText: '<input type="range"><output>0</output>',
          },
        ],
      }),
    );

    const result = await repairCoursewareScene({
      stage: { id: 'stage-1', name: 'Course', createdAt: 1, updatedAt: 1 },
      scene,
      scenes: [scene],
      instruction: 'Fix the runtime error only.',
      interactiveIssues: [
        {
          id: 'interactive-0001',
          code: 'runtime_error',
          severity: 'critical',
          sceneId: scene.id,
          message: 'ReferenceError',
        },
      ],
      aiCall,
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: scene.id,
        title: scene.title,
        order: scene.order,
        content: repairedContent,
        actions,
      }),
    );
    expect(aiCall).toHaveBeenCalledWith(
      'courseware-guard-repair',
      expect.stringContaining('minimal exact-text replacements'),
      expect.stringContaining('ReferenceError'),
    );
    expect(mocks.execute).not.toHaveBeenCalled();
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
        {
          id: 'visual-0002',
          code: 'vision_issue',
          severity: 'warning',
          sceneId: scene.id,
          category: 'semantic_confusion',
          message: 'The explanation may need a clearer label after layout stabilization',
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

  it('restores action-target element IDs after AI rewrites text and portable media URLs', async () => {
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
        elements: [
          {
            id: 'learning-goal',
            type: 'text' as const,
            left: 80,
            top: 180,
            width: 420,
            height: 80,
            rotate: 0,
            content: '<p><strong>学习目标：</strong>理解矩阵如何移动基向量</p>',
            defaultFontName: 'Arial',
            defaultColor: '#111111',
          },
          {
            id: 'diagram',
            type: 'image' as const,
            left: 580,
            top: 180,
            width: 360,
            height: 240,
            rotate: 0,
            src: 'gen_img_matrix',
            fixedRatio: false,
          },
        ],
      },
    };
    const repairedContent = {
      ...originalContent,
      canvas: {
        ...originalContent.canvas,
        elements: [
          {
            ...originalContent.canvas.elements[0],
            id: 'new-goal',
            content: '<p><strong>学习目标：</strong>基向量移动决定空间形变</p>',
          },
          {
            ...originalContent.canvas.elements[1],
            id: 'new-diagram',
            src: '/api/classroom-media/stage-1/media/gen_img_matrix.png',
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
      actions: [
        {
          id: 'spotlight-goal',
          type: 'spotlight' as const,
          elementId: 'learning-goal',
          duration: 1000,
        },
        {
          id: 'spotlight-diagram',
          type: 'spotlight' as const,
          elementId: 'diagram',
          duration: 1000,
        },
      ],
    };
    mocks.execute.mockResolvedValue({ details: { sceneId: scene.id } });
    mocks.planRegenerateApply.mockReturnValue({ patch: { content: repairedContent } });

    const result = await repairCoursewareScene({
      stage: { id: 'stage-1', name: 'Course', createdAt: 1, updatedAt: 1 },
      scene,
      scenes: [scene],
      instruction: 'Rebuild the unreadable diagram.',
      aiCall: vi.fn(),
    });
    if (result?.content.type !== 'slide') throw new Error('result must be a slide');

    expect(result.content.canvas.elements.map((element) => element.id)).toEqual([
      'learning-goal',
      'diagram',
    ]);
    expect(result.actions).toBe(scene.actions);
  });
});
