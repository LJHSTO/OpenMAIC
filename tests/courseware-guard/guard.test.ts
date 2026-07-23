import { describe, expect, it } from 'vitest';
import {
  guardCourseware,
  guardGeneratedScene,
  type CoursewareBundle,
} from '@/lib/courseware-guard';

function validBundle(): CoursewareBundle {
  return {
    stage: { id: 'stage-1', name: 'Calculus', createdAt: 1, updatedAt: 1 },
    scenes: [
      {
        id: 'scene-1',
        stageId: 'stage-1',
        title: 'Derivative',
        order: 0,
        type: 'quiz',
        content: {
          type: 'quiz',
          questions: [
            {
              id: 'q1',
              type: 'single',
              question: 'What is the derivative of x?',
              options: [
                { label: '1', value: 'A' },
                { label: 'x', value: 'B' },
              ],
              answer: ['A'],
            },
          ],
        },
      },
    ],
  };
}

describe('guardCourseware', () => {
  it('accepts a structurally valid course without changing it', () => {
    const input = validBundle();
    const result = guardCourseware(input);

    expect(result.report.publishable).toBe(true);
    expect(result.report.changed).toBe(false);
    expect(result.report.issues).toEqual([]);
    expect(result.bundle).toEqual(input);
  });

  it('reports narration that depends on classroom agent names', () => {
    const input = validBundle();
    input.stage.generatedAgentConfigs = [
      {
        id: 'teacher-1',
        name: '陈老师',
        role: 'teacher',
        persona: '',
        avatar: '',
        color: '#000000',
        priority: 10,
      },
      {
        id: 'student-1',
        name: '小明',
        role: 'student',
        persona: '',
        avatar: '',
        color: '#000000',
        priority: 1,
      },
    ];
    input.scenes[0].actions = [
      {
        id: 'speech-1',
        type: 'speech',
        text: '（陈老师）：大家好，我是陈老师。小明，你来试试。',
      },
    ];

    const result = guardCourseware(input, { contentPolicy: 'strict' });

    expect(result.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'speech_speaker_label', severity: 'critical' }),
        expect.objectContaining({
          code: 'speech_teacher_self_introduction',
          severity: 'critical',
        }),
        expect.objectContaining({ code: 'speech_named_agent_reference', severity: 'critical' }),
      ]),
    );
  });

  it('safely repairs roster-dependent narration and invalidates stale audio', () => {
    const input = validBundle();
    input.stage.generatedAgentConfigs = [
      {
        id: 'teacher-1',
        name: '陈老师',
        role: 'teacher',
        persona: '',
        avatar: '',
        color: '#000000',
        priority: 10,
      },
      {
        id: 'student-1',
        name: '小明',
        role: 'student',
        persona: '',
        avatar: '',
        color: '#000000',
        priority: 1,
      },
    ];
    input.scenes[0].actions = [
      {
        id: 'speech-1',
        type: 'speech',
        text: '大家好，我是陈老师。小明，你来试试。',
        audioId: 'old-audio',
        audioUrl: 'http://localhost/old-audio.mp3',
      },
    ];

    const result = guardCourseware(input, { mode: 'safe-fix', contentPolicy: 'strict' });
    const speech = result.bundle.scenes[0].actions?.[0];

    expect(result.report.publishable).toBe(true);
    expect(result.report.repairs).toContainEqual(
      expect.objectContaining({ code: 'speech_portability_repaired', sceneId: 'scene-1' }),
    );
    expect(speech).toEqual(
      expect.objectContaining({
        type: 'speech',
        text: '这是一组关于“Derivative”的独立测验。你来试试。',
      }),
    );
    expect(speech).not.toHaveProperty('audioId');
    expect(speech).not.toHaveProperty('audioUrl');
  });

  it('reports entry, exit, page-order and platform dependencies in narration', () => {
    const input = validBundle();
    input.scenes[0].actions = [
      {
        id: 'speech-1',
        type: 'speech',
        text: '上一页我们完成了概念学习，现在开始测验。',
      },
      {
        id: 'speech-2',
        type: 'speech',
        text: '提交后我会逐题讲解，下一页继续学习。',
      },
    ];

    const result = guardCourseware(input, { contentPolicy: 'strict' });

    expect(result.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'speech_cross_scene_entry_dependency' }),
        expect.objectContaining({ code: 'speech_standalone_anchor_missing' }),
        expect.objectContaining({ code: 'speech_page_order_dependency' }),
        expect.objectContaining({ code: 'speech_cross_scene_exit_dependency' }),
        expect.objectContaining({ code: 'speech_platform_promise' }),
      ]),
    );
  });

  it('safely repairs cross-scene narration and invalidates only affected audio', () => {
    const input = validBundle();
    input.scenes[0].actions = [
      {
        id: 'speech-1',
        type: 'speech',
        text: '上一页我们完成了概念学习，现在开始测验。',
        audioId: 'old-entry-audio',
      },
      {
        id: 'speech-2',
        type: 'speech',
        text: '提交后我会逐题讲解。下一页继续学习。',
        audioId: 'old-exit-audio',
      },
    ];

    const result = guardCourseware(input, { mode: 'safe-fix', contentPolicy: 'strict' });
    const speeches = result.bundle.scenes[0].actions ?? [];

    expect(result.report.publishable).toBe(true);
    expect(
      result.report.repairs.filter((repair) => repair.code === 'speech_portability_repaired'),
    ).toHaveLength(2);
    expect(speeches[0]).toEqual(
      expect.objectContaining({
        type: 'speech',
        text: '这是一组关于“Derivative”的独立测验。现在开始测验。',
      }),
    );
    expect(speeches[1]).toEqual(
      expect.objectContaining({
        type: 'speech',
        text: '请独立完成每道题，准备好后提交答案。',
      }),
    );
    expect(speeches.every((action) => !('audioId' in action))).toBe(true);
  });

  it('repairs deterministic identifiers, links, ordering and doctype', () => {
    const input = validBundle() as unknown as CoursewareBundle;
    const first = input.scenes[0] as unknown as Record<string, unknown>;
    first.id = '';
    first.stageId = 'wrong-stage';
    first.title = '';
    first.order = Number.NaN;
    first.type = 'slide';
    first.content = { type: 'interactive', url: '', html: '<html><body>lesson</body></html>' };
    input.scenes.push({ ...input.scenes[0], id: '', order: Number.NaN } as never);

    const result = guardCourseware(input, { mode: 'safe-fix' });
    const secondPass = guardCourseware(result.bundle, { mode: 'safe-fix' });

    expect(result.report.changed).toBe(true);
    expect(result.bundle.scenes.map((scene) => scene.id)).toEqual(['scene-1', 'scene-2']);
    expect(result.bundle.scenes.map((scene) => scene.order)).toEqual([0, 1]);
    expect(result.bundle.scenes.every((scene) => scene.stageId === 'stage-1')).toBe(true);
    expect(result.bundle.scenes.every((scene) => scene.type === 'interactive')).toBe(true);
    expect((result.bundle.scenes[0].content as { html: string }).html).toMatch(/^<!doctype html>/i);
    expect(secondPass.report.changed).toBe(false);
    expect(secondPass.report.repairs).toEqual([]);
  });

  it('never rewrites answer semantics and blocks invalid answer keys', () => {
    const input = validBundle();
    const quiz = input.scenes[0].content;
    if (quiz.type !== 'quiz') throw new Error('fixture must be quiz');
    quiz.questions[0].answer = ['Z'];

    const result = guardCourseware(input, { mode: 'safe-fix' });

    expect(result.report.publishable).toBe(false);
    expect(result.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'quiz_answer_not_in_options', repairable: false }),
      ]),
    );
    const repairedQuiz = result.bundle.scenes[0].content;
    expect(repairedQuiz.type).toBe('quiz');
    if (repairedQuiz.type === 'quiz') expect(repairedQuiz.questions[0].answer).toEqual(['Z']);
  });

  it('returns scene locations for Pro Mode instead of editing unsafe content', () => {
    const input = validBundle();
    input.scenes[0] = {
      ...input.scenes[0],
      type: 'interactive',
      content: {
        type: 'interactive',
        url: '',
        html: '<!doctype html><a href="javascript:alert(1)">x</a>',
      },
    };

    const result = guardCourseware(input, { mode: 'safe-fix' });

    expect(result.report.publishable).toBe(false);
    expect(result.report.issues).toContainEqual(
      expect.objectContaining({
        code: 'interactive_unsafe_url',
        sceneId: 'scene-1',
        repairable: false,
      }),
    );
    expect((result.bundle.scenes[0].content as { html: string }).html).toContain('javascript:');
  });

  it('reports slide elements that cross the canvas boundary', () => {
    const input = validBundle();
    input.scenes[0] = {
      ...input.scenes[0],
      type: 'slide',
      content: {
        type: 'slide',
        canvas: {
          id: 'slide-1',
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
              id: 'text-1',
              type: 'text',
              left: 900,
              top: 500,
              width: 200,
              height: 100,
              rotate: 0,
              content: '<p>Outside</p>',
              defaultFontName: 'Arial',
              defaultColor: '#111111',
            },
          ],
        },
      },
    };

    const result = guardCourseware(input, { mode: 'safe-fix' });

    expect(result.report.issues).toContainEqual(
      expect.objectContaining({
        code: 'slide_element_out_of_bounds',
        sceneId: 'scene-1',
        repairable: false,
      }),
    );
    expect(result.bundle.scenes[0]).toEqual(input.scenes[0]);
  });

  it('accepts line elements without box-only height and rotate fields', () => {
    const input = validBundle();
    input.scenes[0] = {
      ...input.scenes[0],
      type: 'slide',
      content: {
        type: 'slide',
        canvas: {
          id: 'slide-1',
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
              id: 'line-1',
              type: 'line',
              left: 100,
              top: 100,
              width: 3,
              start: [0, 0],
              end: [200, 0],
              style: 'solid',
              color: '#111111',
              points: ['', 'arrow'],
            },
          ],
        },
      },
    };

    const result = guardCourseware(input);

    expect(result.report.issues).not.toContainEqual(
      expect.objectContaining({ code: 'slide_element_geometry_invalid' }),
    );
    expect(result.report.publishable).toBe(true);
  });

  it('detects and safely repairs malformed SVG shape paths before browser rendering', () => {
    const input = validBundle();
    input.scenes[0] = {
      ...input.scenes[0],
      type: 'slide',
      content: {
        type: 'slide',
        canvas: {
          id: 'slide-1',
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
              id: 'broken-circle',
              type: 'shape',
              left: 100,
              top: 100,
              width: 20,
              height: 20,
              rotate: 0,
              fill: '#1A3A5C',
              path: 'M 1 0.5 A 0.5 0.5 0 1 1 0 0.5 A 0.5 0 1 1 1 0.5 Z',
              viewBox: [1, 1],
              fixedRatio: true,
            },
          ],
        },
      },
    };

    const inspected = guardCourseware(input);
    const repaired = guardCourseware(input, { mode: 'safe-fix' });
    const secondPass = guardCourseware(repaired.bundle, { mode: 'safe-fix' });
    const repairedScene = repaired.bundle.scenes[0];
    if (repairedScene.content.type !== 'slide') throw new Error('fixture must be slide');

    expect(inspected.report.publishable).toBe(false);
    expect(inspected.report.issues).toContainEqual(
      expect.objectContaining({
        code: 'slide_shape_path_invalid',
        sceneId: 'scene-1',
        repairable: true,
      }),
    );
    expect(repaired.report.publishable).toBe(true);
    expect(repaired.report.repairs).toContainEqual(
      expect.objectContaining({
        code: 'slide_shape_path_repaired',
        sceneId: 'scene-1',
      }),
    );
    expect(repairedScene.content.canvas.elements[0]).toEqual(
      expect.objectContaining({
        path: 'M 1 0.5 A 0.5 0.5 0 1 1 0 0.5 A 0.5 0.5 0 1 1 1 0.5 Z',
        viewBox: [1, 1],
      }),
    );
    expect(secondPass.report.changed).toBe(false);
  });

  it('blocks slide actions that reference elements missing from the repaired canvas', () => {
    const input = validBundle();
    input.scenes[0] = {
      ...input.scenes[0],
      type: 'slide',
      content: {
        type: 'slide',
        canvas: {
          id: 'slide-1',
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
              id: 'title',
              type: 'text',
              left: 100,
              top: 100,
              width: 400,
              height: 80,
              rotate: 0,
              content: '<p>Derivative</p>',
              defaultFontName: 'Arial',
              defaultColor: '#111111',
            },
          ],
        },
      },
      actions: [
        {
          id: 'spotlight-1',
          type: 'spotlight',
          elementId: 'removed-diagram',
          duration: 1000,
        },
      ] as never,
    };

    const result = guardCourseware(input, { mode: 'safe-fix' });

    expect(result.report.publishable).toBe(false);
    expect(result.report.issues).toContainEqual(
      expect.objectContaining({
        code: 'slide_action_element_reference_invalid',
        sceneId: 'scene-1',
        repairable: false,
      }),
    );
  });

  it('reports significant overlap between content-bearing elements but ignores backgrounds', () => {
    const input = validBundle();
    const base = {
      left: 100,
      top: 100,
      width: 300,
      height: 120,
      rotate: 0,
    };
    input.scenes[0] = {
      ...input.scenes[0],
      type: 'slide',
      content: {
        type: 'slide',
        canvas: {
          id: 'slide-1',
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
              id: 'background',
              type: 'shape',
              ...base,
              viewBox: [200, 200],
              path: 'M0 0 H200 V200 H0 Z',
              fixedRatio: false,
              fill: '#eeeeee',
            },
            {
              id: 'text-1',
              type: 'text',
              ...base,
              content: '<p>First</p>',
              defaultFontName: 'Arial',
              defaultColor: '#111111',
            },
            {
              id: 'text-2',
              type: 'text',
              ...base,
              left: 200,
              content: '<p>Second</p>',
              defaultFontName: 'Arial',
              defaultColor: '#111111',
            },
          ],
        },
      },
    };

    const result = guardCourseware(input);
    const overlaps = result.report.issues.filter((issue) => issue.code === 'slide_content_overlap');

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].path).toContain('elements[1]');
    expect(overlaps[0].path).toContain('elements[2]');
  });

  it('checks and repairs each generated scene before insertion', () => {
    const input = validBundle();
    const generated = {
      ...input.scenes[0],
      id: 'scene-1',
      title: '',
      order: 0,
    };

    const result = guardGeneratedScene(input.stage, input.scenes, generated);

    expect(result.scene.id).toBe('scene-1-2');
    expect(result.scene.title).toBe('未命名场景 2');
    expect(result.scene.order).toBe(1);
    expect(result.report.repairs.length).toBeGreaterThan(0);
    expect(result.bundle.scenes[0]).toEqual(input.scenes[0]);
  });

  it('blocks opaque Slide references in strict content mode', () => {
    const input = validBundle();
    input.scenes[0] = {
      ...input.scenes[0],
      type: 'slide',
      content: {
        type: 'slide',
        canvas: {
          id: 'slide-1',
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
              id: 'summary',
              type: 'text',
              left: 100,
              top: 100,
              width: 500,
              height: 80,
              rotate: 0,
              content: '<p>从场景3的实验过渡到结论</p>',
              defaultFontName: 'Arial',
              defaultColor: '#111111',
            },
          ],
        },
      },
    };

    const result = guardCourseware(input, { contentPolicy: 'strict' });

    expect(result.report.publishable).toBe(false);
    expect(result.report.issues).toContainEqual(
      expect.objectContaining({
        code: 'slide_opaque_scene_reference',
        severity: 'critical',
        sceneId: 'scene-1',
      }),
    );
  });

  it('blocks Quiz questions that depend on a missing image or table', () => {
    const input = validBundle();
    const quiz = input.scenes[0].content;
    if (quiz.type !== 'quiz') throw new Error('fixture must be quiz');
    quiz.questions[0].question = '观察下图，判断函数在哪个区间递增。';

    const result = guardCourseware(input, { contentPolicy: 'strict' });

    expect(result.report.publishable).toBe(false);
    expect(result.report.issues).toContainEqual(
      expect.objectContaining({
        code: 'quiz_missing_visual_dependency',
        severity: 'critical',
      }),
    );
  });

  it('rejects malformed LaTeX and visible mojibake before browser rendering', () => {
    const input = validBundle();
    input.scenes[0] = {
      ...input.scenes[0],
      type: 'slide',
      content: {
        type: 'slide',
        canvas: {
          id: 'slide-1',
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
              id: 'broken-formula',
              type: 'latex',
              left: 100,
              top: 100,
              width: 500,
              height: 80,
              rotate: 0,
              latex: String.raw`\frac{1`,
              html: '<span>Ã©</span>',
              color: '#111111',
              fixedRatio: true,
            },
          ],
        },
      },
    };

    const result = guardCourseware(input, { contentPolicy: 'strict' });

    expect(result.report.publishable).toBe(false);
    expect(result.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'slide_latex_invalid' }),
        expect.objectContaining({ code: 'content_mojibake_detected' }),
      ]),
    );
  });
});
