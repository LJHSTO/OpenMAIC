import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { auditCoursewareResources } from '@/lib/courseware-guard/resource-audit';
import type { Scene, Stage } from '@/lib/types/stage';

const stage: Stage = {
  id: 'resource-audit-test',
  name: '资源审计',
  createdAt: 1,
  updatedAt: 1,
};
const classroomDir = path.join(process.cwd(), 'data', 'classrooms', stage.id);

function imageScene(src: string): Scene {
  return {
    id: 'scene-1',
    stageId: stage.id,
    title: '图片',
    order: 0,
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
            id: 'image-1',
            type: 'image',
            left: 100,
            top: 100,
            width: 200,
            height: 120,
            rotate: 0,
            src,
            fixedRatio: false,
          },
        ],
      },
    },
    actions: [],
  };
}

afterEach(async () => {
  await fs.rm(classroomDir, { recursive: true, force: true });
});

describe('courseware resource audit', () => {
  it('fully decodes local images and records dimensions and SHA-256', async () => {
    const mediaDir = path.join(classroomDir, 'media');
    await fs.mkdir(mediaDir, { recursive: true });
    const imagePath = path.join(mediaDir, 'diagram.png');
    await sharp({
      create: {
        width: 4,
        height: 3,
        channels: 4,
        background: '#ffffff',
      },
    })
      .png()
      .toFile(imagePath);

    const report = await auditCoursewareResources(stage, [
      imageScene(`/api/classroom-media/${stage.id}/media/diagram.png`),
    ]);

    expect(report.publishable).toBe(true);
    expect(report.counts).toEqual({ critical: 0, warning: 0 });
    expect(report.resources).toEqual([
      expect.objectContaining({
        kind: 'image',
        width: 4,
        height: 3,
        format: 'png',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
  });

  it('blocks corrupt images before browser or vision review', async () => {
    const mediaDir = path.join(classroomDir, 'media');
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.writeFile(path.join(mediaDir, 'broken.png'), Buffer.from('not an image'));

    const report = await auditCoursewareResources(stage, [
      imageScene(`/api/classroom-media/${stage.id}/media/broken.png`),
    ]);

    expect(report.publishable).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'image_decode_failed', severity: 'critical' }),
    );
  });

  it('blocks session-only Blob URLs and can block external media in strict mode', async () => {
    const blob = await auditCoursewareResources(stage, [imageScene('blob:temporary-image')]);
    const external = await auditCoursewareResources(
      stage,
      [imageScene('https://example.com/diagram.png')],
      { blockExternalMedia: true },
    );

    expect(blob.issues).toContainEqual(
      expect.objectContaining({ code: 'resource_blob_url', severity: 'critical' }),
    );
    expect(external.issues).toContainEqual(
      expect.objectContaining({ code: 'resource_external', severity: 'critical' }),
    );
  });

  it('reports malformed encoded local paths instead of aborting the audit', async () => {
    const report = await auditCoursewareResources(stage, [
      imageScene(`/api/classroom-media/${stage.id}/media/%E0%A4%A.png`),
    ]);

    expect(report.publishable).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'resource_path_invalid', severity: 'critical' }),
    );
  });
});
