import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

const mocks = vi.hoisted(() => ({
  persistClassroom: vi.fn(),
  runCoursewareVisualAudit: vi.fn(),
  createCoursewareArchive: vi.fn(),
}));

vi.mock('@/lib/server/classroom-storage', () => ({
  persistClassroom: mocks.persistClassroom,
}));

vi.mock('@/lib/courseware-guard/visual-audit', () => ({
  runCoursewareVisualAudit: mocks.runCoursewareVisualAudit,
}));

vi.mock('@/lib/courseware-guard/archive', () => ({
  createCoursewareArchive: mocks.createCoursewareArchive,
}));

const stage = {
  id: 'finalize-repair-test',
  name: 'Repair Test',
  createdAt: 1,
  updatedAt: 1,
};

const scene = {
  id: 'scene-1',
  stageId: stage.id,
  title: 'Overflowing slide',
  order: 0,
  type: 'slide' as const,
  content: {
    type: 'slide' as const,
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
      elements: [],
    },
  },
  actions: [],
};

describe('finalizeCourseware visual repair loop', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(path.join(process.cwd(), 'data', 'courseware-audits', stage.id), {
      recursive: true,
      force: true,
    });
  });

  it('repairs affected slides once and re-runs browser inspection before archiving', async () => {
    mocks.persistClassroom.mockResolvedValue({
      id: stage.id,
      url: `http://localhost/classroom/${stage.id}`,
      createdAt: '2026-07-15T00:00:00.000Z',
    });
    mocks.runCoursewareVisualAudit
      .mockResolvedValueOnce({
        schemaVersion: 'openmaic-courseware-visual-audit-v1',
        generatedAt: '2026-07-15T00:00:00.000Z',
        classroomId: stage.id,
        viewport: { width: 1600, height: 900 },
        publishable: false,
        counts: { critical: 1, warning: 0 },
        slides: [],
        issues: [
          {
            id: 'visual-0001',
            code: 'text_overflow',
            severity: 'critical',
            sceneId: scene.id,
            elementIds: ['text-1'],
            message: 'Text content overflows element text-1',
          },
        ],
      })
      .mockResolvedValueOnce({
        schemaVersion: 'openmaic-courseware-visual-audit-v1',
        generatedAt: '2026-07-15T00:01:00.000Z',
        classroomId: stage.id,
        viewport: { width: 1600, height: 900 },
        publishable: true,
        counts: { critical: 0, warning: 0 },
        slides: [],
        issues: [],
      });
    mocks.createCoursewareArchive.mockResolvedValue({
      path: 'D:\\output\\repair.maic.zip',
      filename: 'repair.maic.zip',
      outputDir: 'D:\\output',
      size: 100,
    });
    const repairScene = vi.fn(async (current) => ({ ...current, title: 'Repaired slide' }));
    const { finalizeCourseware } = await import('@/lib/server/finalize-courseware');

    const result = await finalizeCourseware({
      stage,
      scenes: [scene],
      model: 'test:model',
      baseUrl: 'http://localhost',
      repairScene,
    });

    expect(repairScene).toHaveBeenCalledOnce();
    expect(mocks.runCoursewareVisualAudit).toHaveBeenCalledTimes(2);
    expect(mocks.persistClassroom).toHaveBeenCalledTimes(2);
    expect(mocks.createCoursewareArchive).toHaveBeenCalledOnce();
    expect(result.scenes[0].title).toBe('Repaired slide');
  });

  it('repairs structurally invalid imported slides even when browser rendering cannot classify the layout', async () => {
    const invalidScene = {
      ...scene,
      content: {
        ...scene.content,
        canvas: {
          ...scene.content.canvas,
          elements: [
            {
              id: 'broken-text',
              type: 'text' as const,
              left: 100,
              top: 100,
              width: 500,
              height: 'invalid',
              rotate: 0,
              content: '<p>Broken imported text</p>',
              defaultFontName: 'Arial',
              defaultColor: '#111111',
            },
          ],
        },
      },
    };
    const repairedScene = {
      ...invalidScene,
      content: {
        ...invalidScene.content,
        canvas: {
          ...invalidScene.content.canvas,
          elements: [{ ...invalidScene.content.canvas.elements[0], height: 100 }],
        },
      },
    };
    mocks.persistClassroom.mockResolvedValue({
      id: stage.id,
      url: `http://localhost/classroom/${stage.id}`,
      createdAt: '2026-07-15T00:00:00.000Z',
    });
    mocks.runCoursewareVisualAudit
      .mockResolvedValueOnce({
        schemaVersion: 'openmaic-courseware-visual-audit-v1',
        generatedAt: '2026-07-15T00:00:00.000Z',
        classroomId: stage.id,
        viewport: { width: 1600, height: 900 },
        publishable: false,
        counts: { critical: 1, warning: 0 },
        slides: [],
        issues: [
          {
            id: 'visual-0001',
            code: 'render_failed',
            severity: 'critical',
            sceneId: scene.id,
            message: 'The invalid geometry prevented a reliable render',
          },
        ],
      })
      .mockResolvedValueOnce({
        schemaVersion: 'openmaic-courseware-visual-audit-v1',
        generatedAt: '2026-07-15T00:01:00.000Z',
        classroomId: stage.id,
        viewport: { width: 1600, height: 900 },
        publishable: true,
        counts: { critical: 0, warning: 0 },
        slides: [],
        issues: [],
      });
    mocks.createCoursewareArchive.mockResolvedValue({
      path: 'D:\\output\\repair.maic.zip',
      filename: 'repair.maic.zip',
      outputDir: 'D:\\output',
      size: 100,
    });
    const repairScene = vi.fn(async (_current, instruction: string) => {
      expect(instruction).toContain('slide_element_geometry_invalid');
      expect(instruction).toContain('elements[0].height');
      return repairedScene as never;
    });
    const { finalizeCourseware } = await import('@/lib/server/finalize-courseware');

    const result = await finalizeCourseware({
      stage,
      scenes: [invalidScene as never],
      model: 'test:model',
      baseUrl: 'http://localhost',
      repairScene,
    });

    expect(repairScene).toHaveBeenCalledOnce();
    expect(mocks.runCoursewareVisualAudit).toHaveBeenCalledTimes(2);
    expect(result.guardReport.publishable).toBe(true);
  });
});
