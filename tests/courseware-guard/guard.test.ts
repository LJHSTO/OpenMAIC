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
    expect(result.scene.title).toBe('Untitled scene 2');
    expect(result.scene.order).toBe(1);
    expect(result.report.repairs.length).toBeGreaterThan(0);
    expect(result.bundle.scenes[0]).toEqual(input.scenes[0]);
  });
});
