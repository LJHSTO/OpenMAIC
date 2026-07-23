import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { resolveCoursewareAuditPolicy } from '@/lib/courseware-guard/audit-policy';

const mocks = vi.hoisted(() => ({
  persistClassroom: vi.fn(),
  runCoursewareVisualAudit: vi.fn(),
  createCoursewareArchive: vi.fn(),
}));

vi.mock('@/lib/server/classroom-storage', () => ({
  persistClassroom: mocks.persistClassroom,
}));

vi.mock('@/lib/courseware-guard/visual-audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/courseware-guard/visual-audit')>();
  return {
    ...actual,
    runCoursewareVisualAudit: mocks.runCoursewareVisualAudit,
    mergeCoursewareVisualAuditReports: (
      ...args: Parameters<typeof actual.mergeCoursewareVisualAuditReports>
    ) => args[1],
  };
});

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
    vi.resetAllMocks();
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
    const verificationOptions = mocks.runCoursewareVisualAudit.mock.calls[1][0] as {
      sceneIds?: Iterable<string>;
    };
    expect([...(verificationOptions.sceneIds ?? [])]).toEqual([scene.id]);
    expect(mocks.persistClassroom).toHaveBeenCalledTimes(2);
    expect(mocks.createCoursewareArchive).toHaveBeenCalledOnce();
    expect(result.scenes[0].title).toBe('Repaired slide');
  });

  it('repairs actionable multimodal warnings before archiving', async () => {
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
        publishable: true,
        counts: { critical: 0, warning: 1 },
        slides: [],
        issues: [
          {
            id: 'visual-0001',
            code: 'vision_issue',
            severity: 'warning',
            sceneId: scene.id,
            elementIds: ['table-1'],
            category: 'broken_math',
            message: 'Formula is rendered as plain source text',
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
    const repairScene = vi.fn(async (current, instruction: string) => {
      expect(instruction).toContain('remove it and rebuild');
      expect(instruction).toContain('Do not cover an unreadable diagram');
      expect(instruction).toContain('canonical rectangle or circle paths');
      return { ...current, title: 'Repaired formula' };
    });
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
    expect(result.scenes[0].title).toBe('Repaired formula');
  });

  it('does not regenerate a slide for an unconfirmed semantic warning', async () => {
    mocks.persistClassroom.mockResolvedValue({
      id: stage.id,
      url: `http://localhost/classroom/${stage.id}`,
      createdAt: '2026-07-15T00:00:00.000Z',
    });
    mocks.runCoursewareVisualAudit.mockResolvedValueOnce({
      schemaVersion: 'openmaic-courseware-visual-audit-v1',
      generatedAt: '2026-07-15T00:00:00.000Z',
      classroomId: stage.id,
      viewport: { width: 1600, height: 900 },
      publishable: true,
      counts: { critical: 0, warning: 1 },
      slides: [],
      issues: [
        {
          id: 'visual-0001',
          code: 'vision_issue',
          severity: 'warning',
          sceneId: scene.id,
          elementIds: ['definition-1'],
          category: 'semantic_confusion',
          message: 'The definition may be confusing',
        },
      ],
    });
    mocks.createCoursewareArchive.mockResolvedValue({
      path: 'D:\\output\\repair.maic.zip',
      filename: 'repair.maic.zip',
      outputDir: 'D:\\output',
      size: 100,
    });
    const repairScene = vi.fn(async (current) => ({ ...current, title: 'Unexpected rewrite' }));
    const { finalizeCourseware } = await import('@/lib/server/finalize-courseware');

    await finalizeCourseware({
      stage,
      scenes: [scene],
      model: 'test:model',
      baseUrl: 'http://localhost',
      repairScene,
    });

    expect(repairScene).not.toHaveBeenCalled();
    expect(mocks.runCoursewareVisualAudit).toHaveBeenCalledOnce();
    expect(mocks.createCoursewareArchive).toHaveBeenCalledOnce();
  });

  it('repairs explicit semantic-confusion warnings when strict visual semantics are enabled', async () => {
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
        publishable: true,
        counts: { critical: 0, warning: 1 },
        slides: [],
        issues: [
          {
            id: 'visual-0001',
            code: 'vision_issue',
            severity: 'warning',
            sceneId: scene.id,
            elementIds: ['projection-diagram'],
            category: 'semantic_confusion',
            message: 'Projection point does not lie on the subspace',
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
    const repairScene = vi.fn(async (current) => ({ ...current, title: 'Correct projection' }));
    const { finalizeCourseware } = await import('@/lib/server/finalize-courseware');

    const result = await finalizeCourseware({
      stage,
      scenes: [scene],
      model: 'test:model',
      baseUrl: 'http://localhost',
      repairScene,
      strictVisualSemantics: true,
      auditPolicy: resolveCoursewareAuditPolicy({
        profile: 'strict',
        enableVisionAudit: false,
        strictVisualSemantics: true,
      }),
    });

    expect(repairScene).toHaveBeenCalledOnce();
    expect(mocks.runCoursewareVisualAudit).toHaveBeenCalledTimes(2);
    expect(result.scenes[0].title).toBe('Correct projection');
  });

  it('rolls back and does not repeat the same AI repair after a strict pass regresses', async () => {
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
        publishable: true,
        counts: { critical: 0, warning: 1 },
        slides: [],
        issues: [
          {
            id: 'visual-0001',
            code: 'vision_issue',
            severity: 'warning',
            sceneId: scene.id,
            category: 'semantic_confusion',
            message: 'Diagram label conflicts with the stated definition',
          },
        ],
      })
      .mockResolvedValueOnce({
        schemaVersion: 'openmaic-courseware-visual-audit-v1',
        generatedAt: '2026-07-15T00:01:00.000Z',
        classroomId: stage.id,
        viewport: { width: 1600, height: 900 },
        publishable: false,
        counts: { critical: 1, warning: 0 },
        slides: [],
        issues: [
          {
            id: 'visual-0002',
            code: 'console_error',
            severity: 'critical',
            sceneId: scene.id,
            message: 'Regenerated SVG path is invalid',
          },
        ],
      })
      .mockResolvedValueOnce({
        schemaVersion: 'openmaic-courseware-visual-audit-v1',
        generatedAt: '2026-07-15T00:02:00.000Z',
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
    const repairScene = vi.fn(async (current) => ({ ...current, title: 'Regressed slide' }));
    const { finalizeCourseware } = await import('@/lib/server/finalize-courseware');

    await expect(
      finalizeCourseware({
        stage,
        scenes: [scene],
        model: 'test:model',
        baseUrl: 'http://localhost',
        repairScene,
        strictVisualSemantics: true,
      }),
    ).rejects.toMatchObject({
      name: 'CoursewareValidationError',
      scenes: [expect.objectContaining({ title: scene.title })],
    });

    expect(repairScene).toHaveBeenCalledOnce();
    expect(mocks.runCoursewareVisualAudit).toHaveBeenCalledTimes(2);
    expect(mocks.createCoursewareArchive).not.toHaveBeenCalled();
  });

  it('stabilizes deterministic layout regressions before considering rollback', async () => {
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
        publishable: true,
        counts: { critical: 0, warning: 1 },
        slides: [],
        issues: [
          {
            id: 'visual-0001',
            code: 'vision_issue',
            severity: 'warning',
            sceneId: scene.id,
            category: 'semantic_confusion',
            message: 'Diagram label conflicts with the stated definition',
          },
        ],
      })
      .mockResolvedValueOnce({
        schemaVersion: 'openmaic-courseware-visual-audit-v1',
        generatedAt: '2026-07-15T00:01:00.000Z',
        classroomId: stage.id,
        viewport: { width: 1600, height: 900 },
        publishable: false,
        counts: { critical: 2, warning: 0 },
        slides: [],
        issues: [
          {
            id: 'visual-0002',
            code: 'content_overlap',
            severity: 'critical',
            sceneId: scene.id,
            message: 'Regenerated labels overlap',
          },
          {
            id: 'visual-0003',
            code: 'text_overflow',
            severity: 'critical',
            sceneId: scene.id,
            message: 'Regenerated text overflows',
          },
        ],
      })
      .mockResolvedValueOnce({
        schemaVersion: 'openmaic-courseware-visual-audit-v1',
        generatedAt: '2026-07-15T00:02:00.000Z',
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
    const repairScene = vi
      .fn()
      .mockImplementationOnce(async (current) => ({ ...current, title: 'Layout candidate' }))
      .mockImplementationOnce(async (current) => {
        expect(current.title).toBe('Layout candidate');
        return { ...current, title: 'Stabilized slide' };
      });
    const { finalizeCourseware } = await import('@/lib/server/finalize-courseware');

    const result = await finalizeCourseware({
      stage,
      scenes: [scene],
      model: 'test:model',
      baseUrl: 'http://localhost',
      repairScene,
      auditPolicy: resolveCoursewareAuditPolicy({
        profile: 'strict',
        enableVisionAudit: false,
      }),
      strictVisualSemantics: true,
    });

    expect(repairScene).toHaveBeenCalledTimes(2);
    expect(result.scenes[0].title).toBe('Stabilized slide');
  });

  it('runs another bounded repair pass when verification exposes a new runtime defect', async () => {
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
            code: 'content_overlap',
            severity: 'critical',
            sceneId: scene.id,
            message: 'Two text elements overlap',
          },
        ],
      })
      .mockResolvedValueOnce({
        schemaVersion: 'openmaic-courseware-visual-audit-v1',
        generatedAt: '2026-07-15T00:01:00.000Z',
        classroomId: stage.id,
        viewport: { width: 1600, height: 900 },
        publishable: false,
        counts: { critical: 1, warning: 0 },
        slides: [],
        issues: [
          {
            id: 'visual-0002',
            code: 'console_error',
            severity: 'critical',
            sceneId: scene.id,
            message: 'Invalid SVG path data',
          },
        ],
      })
      .mockResolvedValueOnce({
        schemaVersion: 'openmaic-courseware-visual-audit-v1',
        generatedAt: '2026-07-15T00:02:00.000Z',
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
      auditPolicy: resolveCoursewareAuditPolicy({
        profile: 'strict',
        enableVisionAudit: false,
      }),
    });

    expect(repairScene).toHaveBeenCalledTimes(2);
    expect(mocks.runCoursewareVisualAudit).toHaveBeenCalledTimes(3);
    expect(mocks.persistClassroom).toHaveBeenCalledTimes(3);
    expect(result.visualReport.publishable).toBe(true);
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

  it('repairs a broken interactive scene once and rechecks only that scene', async () => {
    const brokenInteractive = {
      id: 'interactive-1',
      stageId: stage.id,
      title: 'Limit experiment',
      order: 0,
      type: 'interactive' as const,
      content: {
        type: 'interactive' as const,
        url: '',
        html: '<!doctype html><html><body><button>Test</button><script>throw new Error("broken interactive")</script></body></html>',
        widgetType: 'simulation' as const,
      },
      actions: [],
    };
    const repairedInteractive = {
      ...brokenInteractive,
      content: {
        ...brokenInteractive.content,
        html: '<!doctype html><html><body><button id="step">Test</button><output id="value">0</output><script>document.getElementById("step").addEventListener("click",()=>document.getElementById("value").textContent="1")</script></body></html>',
      },
    };
    mocks.persistClassroom.mockResolvedValue({
      id: stage.id,
      url: `http://localhost/classroom/${stage.id}`,
      createdAt: '2026-07-15T00:00:00.000Z',
    });
    mocks.runCoursewareVisualAudit.mockResolvedValue({
      schemaVersion: 'openmaic-courseware-visual-audit-v1',
      generatedAt: '2026-07-15T00:00:00.000Z',
      classroomId: stage.id,
      viewport: { width: 1600, height: 900 },
      publishable: true,
      counts: { critical: 0, warning: 0 },
      slides: [],
      issues: [],
    });
    mocks.createCoursewareArchive.mockResolvedValue({
      path: 'D:\\output\\interactive.maic.zip',
      filename: 'interactive.maic.zip',
      outputDir: 'D:\\output',
      size: 100,
    });
    const repairScene = vi.fn(async (_current, instruction: string, context) => {
      expect(instruction).toContain('interactive runtime defects');
      expect(context.interactiveIssues).toContainEqual(
        expect.objectContaining({ code: 'runtime_error' }),
      );
      return repairedInteractive;
    });
    const { finalizeCourseware } = await import('@/lib/server/finalize-courseware');

    const result = await finalizeCourseware({
      stage,
      scenes: [brokenInteractive],
      model: 'test:model',
      baseUrl: 'http://127.0.0.1:3000',
      repairScene,
    });

    expect(repairScene).toHaveBeenCalledOnce();
    expect(result.interactiveReport.publishable).toBe(true);
    expect(result.scenes[0].content).toEqual(repairedInteractive.content);
    expect(mocks.createCoursewareArchive).toHaveBeenCalledOnce();
  }, 30_000);
});
