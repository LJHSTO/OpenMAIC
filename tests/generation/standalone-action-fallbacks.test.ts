import { describe, expect, it } from 'vitest';
import { generateSceneActions } from '@/lib/generation/scene-generator';
import type {
  GeneratedInteractiveContent,
  GeneratedQuizContent,
  GeneratedSlideContent,
  SceneOutline,
} from '@/lib/types/generation';

const emptyAiCall = async () => '';

function outline(type: SceneOutline['type'], title: string): SceneOutline {
  return {
    id: `scene-${type}`,
    type,
    title,
    description: '',
    keyPoints: [],
    order: 1,
  };
}

describe('standalone action fallbacks', () => {
  it('anchors fallback Slide narration to the current scene', async () => {
    const content: GeneratedSlideContent = {
      elements: [],
      background: { type: 'solid', color: '#ffffff' },
    };

    const actions = await generateSceneActions(
      outline('slide', '平均变化率和割线'),
      content,
      emptyAiCall,
    );

    expect(actions).toContainEqual(
      expect.objectContaining({
        type: 'speech',
        text: expect.stringMatching(/^本场景聚焦“平均变化率和割线”/u),
      }),
    );
  });

  it('uses a platform-independent fallback Quiz opening', async () => {
    const content: GeneratedQuizContent = {
      questions: [],
    };

    const actions = await generateSceneActions(
      outline('quiz', '导数概念检查'),
      content,
      emptyAiCall,
    );

    expect(actions).toContainEqual(
      expect.objectContaining({
        type: 'speech',
        text: '这是一组关于“导数概念检查”的独立测验。请独立完成每道题，准备好后提交答案。',
      }),
    );
  });

  it('anchors fallback interactive narration without prior-scene assumptions', async () => {
    const content: GeneratedInteractiveContent = {
      html: '<!doctype html><html><body><button id="start-btn">开始</button></body></html>',
      widgetType: 'simulation',
    };

    const actions = await generateSceneActions(
      {
        ...outline('interactive', '割线逼近切线拖动实验'),
        widgetType: 'simulation',
        widgetOutline: { concept: '割线逼近切线' },
      },
      content,
      emptyAiCall,
    );

    expect(actions).toContainEqual(
      expect.objectContaining({
        type: 'speech',
        text: expect.stringMatching(/^本场景通过交互探索“割线逼近切线拖动实验”/u),
      }),
    );
  });
});
