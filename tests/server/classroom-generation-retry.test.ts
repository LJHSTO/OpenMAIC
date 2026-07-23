import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveModel: vi.fn(),
  isProviderKeyRequired: vi.fn(),
  generateSceneOutlinesFromRequirements: vi.fn(),
  applyOutlineFallbacks: vi.fn(),
  generateSceneContent: vi.fn(),
  generateSceneActions: vi.fn(),
  createSceneWithActions: vi.fn(),
  persistClassroom: vi.fn(),
  runCoursewareVisualAudit: vi.fn(),
  createCoursewareArchive: vi.fn(),
  callLLM: vi.fn(),
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModel: mocks.resolveModel,
}));

vi.mock('@/lib/ai/providers', () => ({
  isProviderKeyRequired: mocks.isProviderKeyRequired,
}));

vi.mock('@/lib/ai/llm', () => ({
  callLLM: mocks.callLLM,
}));

vi.mock('@/lib/generation/outline-generator', () => ({
  generateSceneOutlinesFromRequirements: mocks.generateSceneOutlinesFromRequirements,
  applyOutlineFallbacks: mocks.applyOutlineFallbacks,
}));

vi.mock('@/lib/generation/scene-generator', () => ({
  generateSceneContent: mocks.generateSceneContent,
  generateSceneActions: mocks.generateSceneActions,
  createSceneWithActions: mocks.createSceneWithActions,
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

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const outline = {
  id: 'outline-1',
  type: 'slide',
  title: 'Retry Basics',
  description: 'Explain retries',
  keyPoints: ['Retry transient failures'],
  order: 1,
} as const;

const slideContent = {
  elements: [],
  remark: 'Retry transient failures',
};

async function generateWithProgress(
  input: {
    requirement: string;
    model?: string;
    pdfContent?: { text: string; images: string[] };
  } = {
    requirement: 'Teach retry basics',
  },
) {
  const progress: Array<{ message: string }> = [];
  const { generateClassroom } = await import('@/lib/server/classroom-generation');
  const result = await generateClassroom(input, {
    baseUrl: 'http://localhost',
    onProgress: (event) => {
      progress.push({ message: event.message });
    },
  });
  return { result, progress };
}

describe('classroom scene generation retries', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    mocks.resolveModel.mockResolvedValue({
      model: { id: 'language-model' },
      modelInfo: {},
      modelString: 'test:model',
      providerId: 'test',
      apiKey: '',
    });
    mocks.isProviderKeyRequired.mockReturnValue(false);
    mocks.callLLM.mockResolvedValue({ text: 'ok' });
    mocks.generateSceneOutlinesFromRequirements.mockResolvedValue({
      success: true,
      data: {
        languageDirective: 'Use English.',
        outlines: [outline],
      },
    });
    mocks.applyOutlineFallbacks.mockImplementation((value) => value);
    mocks.generateSceneActions.mockResolvedValue([]);
    mocks.createSceneWithActions.mockImplementation((sceneOutline, content, actions, api) => {
      const sceneResult = api.scene.create({
        type: sceneOutline.type,
        title: sceneOutline.title,
        order: sceneOutline.order,
        content: {
          type: 'slide',
          canvas: {
            id: 'slide-1',
            viewportSize: 1000,
            viewportRatio: 0.5625,
            elements: content.elements,
          },
        },
        actions,
      });
      return sceneResult.success ? (sceneResult.data ?? null) : null;
    });
    mocks.persistClassroom.mockImplementation(async ({ id, scenes }) => ({
      id,
      url: `http://localhost/classroom/${id}`,
      scenesCount: scenes.length,
      createdAt: '2026-06-22T00:00:00.000Z',
    }));
    mocks.runCoursewareVisualAudit.mockResolvedValue({
      schemaVersion: 'openmaic-courseware-visual-audit-v1',
      generatedAt: '2026-06-22T00:00:00.000Z',
      classroomId: 'stage-1',
      viewport: { width: 1600, height: 900 },
      publishable: true,
      counts: { critical: 0, warning: 0 },
      slides: [],
      issues: [],
    });
    mocks.createCoursewareArchive.mockResolvedValue({
      path: 'D:\\output\\Retry_Basics__test_model.maic.zip',
      filename: 'Retry_Basics__test_model.maic.zip',
      outputDir: 'D:\\output',
      size: 123,
    });
  });

  it('retries an empty scene content result before skipping the scene', async () => {
    mocks.generateSceneContent.mockResolvedValueOnce(null).mockResolvedValueOnce(slideContent);

    const { result, progress } = await generateWithProgress();

    expect(result.scenesCount).toBe(1);
    expect(mocks.generateSceneContent).toHaveBeenCalledTimes(2);
    expect(progress.some((event) => event.message.includes('Retrying scene 1/1 content'))).toBe(
      true,
    );
  }, 15_000);

  it('forwards classroom thinking config to scene retry LLM calls', async () => {
    const thinkingConfig = { enabled: true, effort: 'high' };
    mocks.resolveModel.mockResolvedValue({
      model: { id: 'language-model' },
      modelInfo: {},
      modelString: 'test:model',
      providerId: 'test',
      apiKey: '',
      thinkingConfig,
    });
    mocks.generateSceneContent.mockImplementation(async (_outline, aiCall) => {
      await aiCall('system', 'user');
      return slideContent;
    });

    await generateWithProgress();

    expect(mocks.callLLM).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0 }),
      'generate-classroom-scene',
      undefined,
      thinkingConfig,
    );
  });

  it('resolves a model selected for an individual batch job', async () => {
    mocks.generateSceneContent.mockResolvedValue(slideContent);

    await generateWithProgress({
      requirement: 'Teach retry basics',
      model: 'openai:gpt-5.5',
    });

    expect(mocks.resolveModel).toHaveBeenCalledWith({
      stage: 'generate-classroom',
      modelString: 'openai:gpt-5.5',
    });
  });

  it('forwards batch PDF images through the same vision path used by browser generation', async () => {
    const image = 'data:image/png;base64,c291cmNl';
    mocks.resolveModel.mockResolvedValue({
      model: { id: 'vision-model' },
      modelInfo: { outputWindow: 16_384, capabilities: { vision: true } },
      modelString: 'test:vision-model',
      providerId: 'test',
      apiKey: '',
    });
    mocks.generateSceneOutlinesFromRequirements.mockImplementation(
      async (_requirements, _pdfText, pdfImages, aiCall, options) => {
        expect(pdfImages).toEqual([
          expect.objectContaining({ id: 'img_1', src: image, pageNumber: 0 }),
        ]);
        expect(options).toEqual(
          expect.objectContaining({
            visionEnabled: true,
            imageMapping: { img_1: image },
          }),
        );
        await aiCall('outline system', 'outline user', [{ id: 'img_1', src: image }]);
        return {
          success: true,
          data: {
            languageDirective: 'Use English.',
            outlines: [{ ...outline, suggestedImageIds: ['img_1'] }],
          },
        };
      },
    );
    mocks.generateSceneContent.mockResolvedValue(slideContent);

    await generateWithProgress({
      requirement: 'Teach retry basics',
      pdfContent: { text: 'Source text', images: [image] },
    });

    expect(mocks.callLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'outline system',
        messages: [
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'image',
                image: 'c291cmNl',
                mimeType: 'image/png',
              }),
            ]),
          }),
        ],
      }),
      'generate-classroom',
      undefined,
      undefined,
    );
    expect(mocks.generateSceneContent).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedImageIds: ['img_1'] }),
      expect.any(Function),
      expect.objectContaining({
        assignedImages: [expect.objectContaining({ id: 'img_1', src: image })],
        imageMapping: { img_1: image },
        visionEnabled: true,
      }),
    );
  });

  it('retries retryable action generation errors', async () => {
    mocks.generateSceneContent.mockResolvedValue(slideContent);
    mocks.generateSceneActions
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { statusCode: 429 }))
      .mockResolvedValueOnce([]);

    const { result, progress } = await generateWithProgress();

    expect(result.scenesCount).toBe(1);
    expect(mocks.generateSceneActions).toHaveBeenCalledTimes(2);
    expect(progress.some((event) => event.message.includes('Retrying scene 1/1 actions'))).toBe(
      true,
    );
  });

  it('does not retry non-retryable action generation errors', async () => {
    const unauthorized = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    mocks.generateSceneContent.mockResolvedValue(slideContent);
    mocks.generateSceneActions.mockRejectedValue(unauthorized);

    await expect(generateWithProgress()).rejects.toBe(unauthorized);

    expect(mocks.generateSceneActions).toHaveBeenCalledTimes(1);
  });
});
