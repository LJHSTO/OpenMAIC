import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mergeCoursewareInteractiveAuditReports,
  runCoursewareInteractiveAudit,
  type CoursewareInteractiveAuditReport,
  type InteractiveAuditSceneResult,
} from '@/lib/courseware-guard/interactive-audit';
import type { Scene } from '@/lib/types/stage';

const temporaryDirectories: string[] = [];

function interactiveScene(id: string, order: number, html: string): Scene {
  return {
    id,
    stageId: 'stage-1',
    title: id,
    order,
    type: 'interactive',
    content: {
      type: 'interactive',
      url: '',
      html,
      widgetType: 'simulation',
    },
    actions: [],
  };
}

function report(scenes: InteractiveAuditSceneResult[]): CoursewareInteractiveAuditReport {
  const issues = scenes.flatMap((scene) => scene.issues);
  return {
    schemaVersion: 'openmaic-courseware-interactive-audit-v1',
    generatedAt: '2026-07-15T00:00:00.000Z',
    classroomId: 'stage-1',
    viewport: { width: 1280, height: 720 },
    publishable: !issues.some((issue) => issue.severity === 'critical'),
    counts: {
      critical: issues.filter((issue) => issue.severity === 'critical').length,
      warning: issues.filter((issue) => issue.severity === 'warning').length,
    },
    scenes,
    issues,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('courseware interactive audit', () => {
  it('renders valid HTML, exercises a control, and captures runtime failures without a model', async () => {
    const screenshotsDir = path.join(os.tmpdir(), `openmaic-interactive-${Date.now()}`);
    temporaryDirectories.push(screenshotsDir);
    const valid = interactiveScene(
      'valid',
      0,
      '<!doctype html><html><body><button id="step">推进</button><output id="value">0</output><script>document.getElementById("step").addEventListener("click",()=>document.getElementById("value").textContent="1")</script></body></html>',
    );
    const broken = interactiveScene(
      'broken',
      1,
      '<!doctype html><html><body><button>测试</button><script>throw new Error("runtime exploded")</script></body></html>',
    );

    const result = await runCoursewareInteractiveAudit({
      baseUrl: 'http://127.0.0.1:3000',
      classroomId: 'stage-1',
      scenes: [valid, broken],
      screenshotsDir,
      concurrency: 2,
      exercise: true,
    });

    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0].interaction).toEqual(
      expect.objectContaining({ attempted: true, succeeded: true }),
    );
    expect(result.scenes[0].issues.some((issue) => issue.severity === 'critical')).toBe(false);
    expect(result.scenes[1].issues).toContainEqual(
      expect.objectContaining({
        code: 'runtime_error',
        severity: 'critical',
        message: expect.stringContaining('runtime exploded'),
      }),
    );
    expect(result.publishable).toBe(false);
  }, 30_000);

  it('merges a partial recheck without dropping untouched interactive findings', () => {
    const scenes = [
      interactiveScene('interactive-1', 0, '<!doctype html><button>1</button>'),
      interactiveScene('interactive-2', 1, '<!doctype html><button>2</button>'),
    ];
    const base = report([
      {
        sceneId: 'interactive-1',
        title: 'interactive-1',
        screenshot: 'interactive-screenshots/1.png',
        issues: [
          {
            id: 'interactive-0001',
            code: 'runtime_error',
            severity: 'critical',
            sceneId: 'interactive-1',
            message: 'old runtime error',
          },
        ],
      },
      {
        sceneId: 'interactive-2',
        title: 'interactive-2',
        screenshot: 'interactive-screenshots/2.png',
        issues: [
          {
            id: 'interactive-0002',
            code: 'viewport_overflow',
            severity: 'warning',
            sceneId: 'interactive-2',
            message: 'still too tall',
          },
        ],
      },
    ]);
    const replacement = report([
      {
        sceneId: 'interactive-1',
        title: 'interactive-1',
        screenshot: 'interactive-screenshots/1-fixed.png',
        issues: [],
      },
    ]);

    const merged = mergeCoursewareInteractiveAuditReports(base, replacement, scenes);

    expect(merged.scenes.map((scene) => scene.sceneId)).toEqual(['interactive-1', 'interactive-2']);
    expect(merged.issues).toEqual([
      expect.objectContaining({
        code: 'viewport_overflow',
        sceneId: 'interactive-2',
      }),
    ]);
    expect(merged.counts).toEqual({ critical: 0, warning: 1 });
  });
});
