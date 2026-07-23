import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  reviewCoursewareScreenshot,
  type CoursewareVisionUserContent,
} from '@/lib/server/courseware-vision-review';

const tempFiles: string[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all([
    ...tempFiles.splice(0).map((file) => fs.rm(file, { force: true })),
    ...tempDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  ]);
});

describe('courseware multimodal vision review', () => {
  it('sends the rendered PNG to the model and returns differentiated findings', async () => {
    const screenshotPath = path.join(os.tmpdir(), `openmaic-vision-${Date.now()}.png`);
    tempFiles.push(screenshotPath);
    await fs.writeFile(screenshotPath, Buffer.from('fake-png'));
    const callVisionModel = vi.fn(
      async (_systemPrompt: string, _userContent: CoursewareVisionUserContent) =>
        JSON.stringify({
          issues: [
            {
              severity: 'critical',
              category: 'overlap',
              message: 'The definition paragraph is covered by the blue formula panel.',
              elementIds: ['definition', 'formula-panel'],
            },
          ],
        }),
    );

    const findings = await reviewCoursewareScreenshot({
      screenshotPath,
      scene: {
        id: 'scene-1',
        stageId: 'stage-1',
        title: 'Limits',
        order: 0,
        type: 'slide',
        content: {
          type: 'slide',
          canvas: {
            id: 'canvas-1',
            viewportSize: 1000,
            viewportRatio: 0.5625,
            theme: {
              backgroundColor: '#fff',
              themeColors: ['#000'],
              fontColor: '#000',
              fontName: 'Arial',
            },
            elements: [],
          },
        },
        actions: [],
      },
      callVisionModel,
    });

    expect(findings).toEqual([
      expect.objectContaining({ category: 'overlap', elementIds: ['definition', 'formula-panel'] }),
    ]);
    const userContent = callVisionModel.mock.calls[0][1];
    const systemPrompt = callVisionModel.mock.calls[0][0];
    expect(systemPrompt).toContain('objective learner-relevant contradiction');
    expect(systemPrompt).toContain('standard Chinese punctuation');
    expect(systemPrompt).toContain('origin and scale are clear enough');
    expect(systemPrompt).toContain('color-matched point/label pairs');
    expect(userContent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image',
          image: Buffer.from('fake-png').toString('base64'),
        }),
      ]),
    );
  });

  it('fails closed when the model response is not valid audit JSON', async () => {
    const screenshotPath = path.join(os.tmpdir(), `openmaic-vision-${Date.now()}-bad.png`);
    tempFiles.push(screenshotPath);
    await fs.writeFile(screenshotPath, Buffer.from('fake-png'));
    await expect(
      reviewCoursewareScreenshot({
        screenshotPath,
        scene: {
          id: 'scene-1',
          stageId: 'stage-1',
          title: 'Limits',
          order: 0,
          type: 'slide',
          content: {
            type: 'slide',
            canvas: {
              id: 'canvas-1',
              viewportSize: 1000,
              viewportRatio: 0.5625,
              theme: {
                backgroundColor: '#fff',
                themeColors: ['#000'],
                fontColor: '#000',
                fontName: 'Arial',
              },
              elements: [],
            },
          },
          actions: [],
        },
        callVisionModel: async () => 'not json',
      }),
    ).rejects.toThrow(/invalid audit response/);
  });

  it('downgrades semantic findings to warnings for human confirmation', async () => {
    const screenshotPath = path.join(os.tmpdir(), `openmaic-vision-${Date.now()}-semantic.png`);
    tempFiles.push(screenshotPath);
    await fs.writeFile(screenshotPath, Buffer.from('fake-png'));

    const findings = await reviewCoursewareScreenshot({
      screenshotPath,
      scene: {
        id: 'scene-1',
        stageId: 'stage-1',
        title: 'Limits',
        order: 0,
        type: 'slide',
        content: {
          type: 'slide',
          canvas: {
            id: 'canvas-1',
            viewportSize: 1000,
            viewportRatio: 0.5625,
            theme: {
              backgroundColor: '#fff',
              themeColors: ['#000'],
              fontColor: '#000',
              fontName: 'Arial',
            },
            elements: [],
          },
        },
        actions: [],
      },
      callVisionModel: async () =>
        JSON.stringify({
          issues: [
            {
              severity: 'critical',
              category: 'semantic_confusion',
              message: 'The definition appears inconsistent',
            },
          ],
        }),
    });

    expect(findings).toEqual([
      expect.objectContaining({ category: 'semantic_confusion', severity: 'warning' }),
    ]);
  });

  it('truncates an overlong valid finding instead of failing the visual audit', async () => {
    const screenshotPath = path.join(os.tmpdir(), `openmaic-vision-${Date.now()}-long.png`);
    tempFiles.push(screenshotPath);
    await fs.writeFile(screenshotPath, Buffer.from('fake-png'));

    const findings = await reviewCoursewareScreenshot({
      screenshotPath,
      scene: {
        id: 'scene-1',
        stageId: 'stage-1',
        title: 'Coordinates',
        order: 0,
        type: 'slide',
        content: {
          type: 'slide',
          canvas: {
            id: 'canvas-1',
            viewportSize: 1000,
            viewportRatio: 0.5625,
            theme: {
              backgroundColor: '#fff',
              themeColors: ['#000'],
              fontColor: '#000',
              fontName: 'Arial',
            },
            elements: [],
          },
        },
        actions: [],
      },
      callVisionModel: async () =>
        JSON.stringify({
          issues: [
            {
              severity: 'warning',
              category: 'visual_hierarchy',
              message: 'x'.repeat(800),
            },
          ],
        }),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toHaveLength(600);
  });

  it('reuses a cached review for the same screenshot, element summary, model, and prompt', async () => {
    const screenshotPath = path.join(os.tmpdir(), `openmaic-vision-${Date.now()}-cached.png`);
    const cacheDir = path.join(os.tmpdir(), `openmaic-vision-cache-${Date.now()}`);
    tempFiles.push(screenshotPath);
    tempDirectories.push(cacheDir);
    await fs.writeFile(screenshotPath, Buffer.from('same-rendered-slide'));
    const scene = {
      id: 'scene-cached',
      stageId: 'stage-1',
      title: 'Cached limits',
      order: 0,
      type: 'slide' as const,
      content: {
        type: 'slide' as const,
        canvas: {
          id: 'canvas-cached',
          viewportSize: 1000,
          viewportRatio: 0.5625,
          theme: {
            backgroundColor: '#fff',
            themeColors: ['#000'],
            fontColor: '#000',
            fontName: 'Arial',
          },
          elements: [],
        },
      },
      actions: [],
    };
    const callVisionModel = vi.fn(async () => JSON.stringify({ issues: [] }));
    const options = {
      screenshotPath,
      scene,
      cacheNamespace: 'test:vision-model',
      cacheDir,
      enableCache: true,
      callVisionModel,
    };

    const first = await reviewCoursewareScreenshot(options);
    const second = await reviewCoursewareScreenshot(options);

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(callVisionModel).toHaveBeenCalledOnce();
  });
});
