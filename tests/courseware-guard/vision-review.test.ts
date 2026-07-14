import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  reviewCoursewareScreenshot,
  type CoursewareVisionUserContent,
} from '@/lib/server/courseware-vision-review';

const tempFiles: string[] = [];

afterEach(async () => {
  await Promise.all(tempFiles.splice(0).map((file) => fs.rm(file, { force: true })));
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
});
