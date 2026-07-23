import { describe, expect, it } from 'vitest';
import {
  mergeCoursewareVisualAuditReports,
  type CoursewareVisualAuditReport,
  type VisualAuditSlideResult,
} from '@/lib/courseware-guard/visual-audit';
import type { Scene } from '@/lib/types/stage';

function slideScene(id: string, order: number): Scene {
  return {
    id,
    stageId: 'stage-1',
    title: id,
    order,
    type: 'slide',
    content: {
      type: 'slide',
      canvas: {
        id: `canvas-${id}`,
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
    },
    actions: [],
  };
}

function slideResult(
  sceneId: string,
  issues: VisualAuditSlideResult['issues'],
): VisualAuditSlideResult {
  return {
    sceneId,
    title: sceneId,
    screenshot: `screenshots/${sceneId}.png`,
    issues,
  };
}

function report(slides: VisualAuditSlideResult[]): CoursewareVisualAuditReport {
  const issues = slides.flatMap((slide) => slide.issues);
  return {
    schemaVersion: 'openmaic-courseware-visual-audit-v1',
    generatedAt: '2026-07-15T00:00:00.000Z',
    classroomId: 'stage-1',
    viewport: { width: 1600, height: 900 },
    publishable: !issues.some((issue) => issue.severity === 'critical'),
    counts: {
      critical: issues.filter((issue) => issue.severity === 'critical').length,
      warning: issues.filter((issue) => issue.severity === 'warning').length,
    },
    slides,
    issues,
  };
}

describe('courseware visual audit report merging', () => {
  it('replaces only rechecked slides and preserves untouched slide findings', () => {
    const scenes = [slideScene('scene-1', 0), slideScene('scene-2', 1)];
    const base = report([
      slideResult('scene-1', [
        {
          id: 'visual-0001',
          code: 'text_overflow',
          severity: 'critical',
          sceneId: 'scene-1',
          message: 'old overflow',
        },
      ]),
      slideResult('scene-2', [
        {
          id: 'visual-0002',
          code: 'font_failed',
          severity: 'warning',
          sceneId: 'scene-2',
          message: 'font fallback',
        },
      ]),
    ]);
    const replacement = report([slideResult('scene-1', [])]);

    const merged = mergeCoursewareVisualAuditReports(base, replacement, scenes);

    expect(merged.slides.map((slide) => slide.sceneId)).toEqual(['scene-1', 'scene-2']);
    expect(merged.issues).toEqual([
      expect.objectContaining({
        id: 'visual-0001',
        code: 'font_failed',
        sceneId: 'scene-2',
      }),
    ]);
    expect(merged.counts).toEqual({ critical: 0, warning: 1 });
    expect(merged.publishable).toBe(true);
  });
});
