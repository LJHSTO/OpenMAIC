import { describe, expect, it } from 'vitest';
import { auditCoursewareKnowledgeContract } from '@/lib/courseware-guard/knowledge-audit';
import type { SceneOutline } from '@/lib/types/generation';
import type { Scene, Stage } from '@/lib/types/stage';

const stage: Stage = {
  id: 'knowledge-audit',
  name: '知识契约审计',
  createdAt: 1,
  updatedAt: 1,
};

function outline(id: string, order: number, keyPoints: string[]): SceneOutline {
  return {
    id,
    type: 'slide',
    title: '导数的几何意义',
    description: '解释切线斜率',
    keyPoints,
    order,
  };
}

function slide(id: string, outlineId: string, content: string): Scene {
  return {
    id,
    outlineId,
    stageId: stage.id,
    title: '导数的几何意义',
    order: 0,
    type: 'slide',
    content: {
      type: 'slide',
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
            id: 'text-1',
            type: 'text',
            left: 100,
            top: 100,
            width: 600,
            height: 120,
            rotate: 0,
            content,
            defaultFontName: 'Arial',
            defaultColor: '#111111',
          },
        ],
      },
    },
    actions: [],
  };
}

describe('courseware knowledge contract audit', () => {
  it('maps outlines to scenes and warns when a key point has no visible evidence', () => {
    const expected = outline('outline-1', 0, ['导数等于切线斜率', '割线逼近切线']);
    const report = auditCoursewareKnowledgeContract(
      stage,
      [slide('scene-1', expected.id, '<p>导数等于函数图像在该点的切线斜率。</p>')],
      [expected],
    );

    expect(report.publishable).toBe(true);
    expect(report.matchedOutlines).toBe(1);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'key_point_not_evidenced',
        severity: 'warning',
        keyPoint: '割线逼近切线',
      }),
    );
  });

  it('blocks publishing when an expected outline has no generated scene', () => {
    const report = auditCoursewareKnowledgeContract(
      stage,
      [],
      [outline('outline-1', 0, ['切线斜率'])],
    );

    expect(report.publishable).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'outline_scene_missing', severity: 'critical' }),
    );
  });

  it('stays neutral when legacy courseware has no retained outline contract', () => {
    const report = auditCoursewareKnowledgeContract(stage, [], undefined);

    expect(report.contractAvailable).toBe(false);
    expect(report.publishable).toBe(true);
    expect(report.issues).toEqual([]);
  });
});
