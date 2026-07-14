import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import {
  buildCoursewareArtifactFilename,
  createCoursewareArchive,
  resolveCoursewareOutputDir,
  sanitizeArtifactSegment,
} from '@/lib/courseware-guard/archive';

const stageId = 'archive-portable-test';
const resourceDir = path.join(process.cwd(), 'data', 'classrooms', stageId);
const temporaryOutputDir = path.join(os.tmpdir(), 'openmaic-courseware-archive-test');

afterEach(async () => {
  await Promise.all([
    fs.rm(resourceDir, { recursive: true, force: true }),
    fs.rm(temporaryOutputDir, { recursive: true, force: true }),
  ]);
});

describe('courseware archive naming', () => {
  it('labels archives with a filesystem-safe course title, model and timestamp', () => {
    const filename = buildCoursewareArtifactFilename(
      'Calculus: limits / continuity',
      'openai:gpt-5.4',
      new Date('2026-07-15T01:02:03.000Z'),
    );

    expect(filename).toBe('Calculus_limits_continuity__openai_gpt-5.4__20260715T010203Z.maic.zip');
  });

  it('uses a bounded fallback for invalid Windows path segments', () => {
    expect(sanitizeArtifactSegment('  <>:"/\\|?*  ', 'course')).toBe('course');
    expect(sanitizeArtifactSegment('a'.repeat(120), 'course')).toHaveLength(80);
  });

  it('groups automatic output under a filesystem-safe model directory', () => {
    expect(resolveCoursewareOutputDir('D:\\Courseware', 'openai:gpt-5.5')).toBe(
      path.resolve('D:\\Courseware', 'openai_gpt-5.5'),
    );
    expect(resolveCoursewareOutputDir('D:\\Courseware', 'openai:gpt-5.5', false)).toBe(
      path.resolve('D:\\Courseware'),
    );
  });

  it('restores portable media references in the importable manifest', async () => {
    await fs.mkdir(path.join(resourceDir, 'media'), { recursive: true });
    await fs.writeFile(path.join(resourceDir, 'media', 'gen_img_1.png'), Buffer.from([1, 2, 3]));
    const stage = { id: stageId, name: 'Portable', createdAt: 1, updatedAt: 1 };
    const scenes = [
      {
        id: 'scene-1',
        stageId,
        title: 'Media',
        order: 0,
        type: 'slide' as const,
        content: {
          type: 'slide' as const,
          canvas: {
            id: 'slide-1',
            viewportSize: 1000,
            viewportRatio: 0.5625,
            theme: {
              backgroundColor: '#fff',
              themeColors: ['#111'],
              fontColor: '#111',
              fontName: 'Arial',
            },
            elements: [
              {
                id: 'image-1',
                type: 'image' as const,
                left: 0,
                top: 0,
                width: 100,
                height: 100,
                rotate: 0,
                src: `http://localhost/api/classroom-media/${stageId}/media/gen_img_1.png`,
                fixedRatio: false,
              },
            ],
          },
        },
        actions: [],
      },
    ];
    const result = await createCoursewareArchive({
      stage,
      scenes,
      model: 'test:model',
      outputDir: temporaryOutputDir,
      screenshotsDir: path.join(temporaryOutputDir, 'screenshots'),
      guardReport: {
        schemaVersion: 'openmaic-courseware-guard-v1',
        mode: 'safe-fix',
        beforeFingerprint: 'before',
        afterFingerprint: 'after',
        changed: false,
        publishable: true,
        counts: { critical: 0, warning: 0, info: 0 },
        issues: [],
        repairs: [],
      },
      visualReport: {
        schemaVersion: 'openmaic-courseware-visual-audit-v1',
        generatedAt: '2026-07-15T00:00:00.000Z',
        classroomId: stageId,
        viewport: { width: 1600, height: 900 },
        publishable: true,
        counts: { critical: 0, warning: 0 },
        slides: [],
        issues: [],
      },
    });
    const zip = await JSZip.loadAsync(await fs.readFile(result.path));
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as {
      scenes: Array<{ content: { canvas: { elements: Array<{ src: string }> } } }>;
      mediaIndex: Record<string, unknown>;
    };

    expect(manifest.scenes[0].content.canvas.elements[0].src).toBe('gen_img_1');
    expect(manifest.mediaIndex).toHaveProperty('media/gen_img_1.png');
  });
});
