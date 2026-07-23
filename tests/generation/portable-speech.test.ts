import { describe, expect, it } from 'vitest';
import { sanitizePortableSpeech } from '@/lib/generation/portable-speech';
import type { AgentInfo } from '@/lib/generation/pipeline-types';

const agents: AgentInfo[] = [
  { id: 'teacher-1', name: '林老师', role: 'teacher' },
  { id: 'student-1', name: '小明', role: 'student' },
  { id: 'student-2', name: '兰兰', role: 'student' },
  { id: 'assistant-1', name: '大伟', role: 'assistant' },
];

describe('sanitizePortableSpeech', () => {
  it('removes teacher self-introduction and named direct address', () => {
    const result = sanitizePortableSpeech(
      '大家好，我是林老师。小明、兰兰，你们准备好了吗？',
      agents,
    );

    expect(result.text).toBe('大家好，你们准备好了吗？');
    expect(result.changed).toBe(true);
    expect(result.removedAgentNames).toEqual(['林老师', '小明', '兰兰']);
  });

  it('turns named agent references into roster-independent narration', () => {
    const result = sanitizePortableSpeech(
      '大伟说过，极限描述的是趋近过程。刚才小明带我们看了图像。',
      agents,
    );

    expect(result.text).toBe('这里需要注意，极限描述的是趋近过程。我们看了图像。');
    expect(result.text).not.toMatch(/大伟|小明/u);
  });

  it('rewrites common teacher and assistant cues into natural portable wording', () => {
    const result = sanitizePortableSpeech(
      '林老师提个醒。林老师先请大家看关系图。小明，帮大家点开第一个节点。',
      agents,
    );

    expect(result.text).toBe('提醒一下。请大家看关系图。请点开第一个节点。');
  });

  it('removes agent-specific quiz-performance commentary without leaving a broken sentence', () => {
    const result = sanitizePortableSpeech(
      '小明在第四题上思考得非常深入。这道题考的是极限的直观描述。',
      agents,
    );

    expect(result.text).toBe('这道题考的是极限的直观描述。');
  });

  it('handles an English agent name without changing subject-matter names', () => {
    const result = sanitizePortableSpeech(
      'Lily, please try the control. Newton method remains unchanged.',
      [{ id: 'student-1', name: 'Lily', role: 'student' }],
    );

    expect(result.text).toBe('please try the control. Newton method remains unchanged.');
    expect(result.text).toContain('Newton');
  });

  it('removes stale audio references when callers detect changed text', () => {
    const result = sanitizePortableSpeech('（AI助教）：请完成本页练习。');

    expect(result).toEqual({
      text: '请完成本页练习。',
      changed: true,
      removedAgentNames: [],
    });
  });

  it('turns a legacy cross-scene opening into a standalone scene introduction', () => {
    const result = sanitizePortableSpeech(
      '上一页我们讲到了平均变化率和割线。如果让一个点逼近另一个点，会发生什么？',
      agents,
      {
        sceneTitle: '瞬时变化率和切线',
        sceneType: 'slide',
        isFirstSpeech: true,
      },
    );

    expect(result.text).toBe(
      '本场景聚焦“瞬时变化率和切线”。如果让一个点逼近另一个点，会发生什么？',
    );
  });

  it('removes repeated greetings and prior-learning assumptions from scene entry', () => {
    const result = sanitizePortableSpeech(
      '同学们好！欢迎来到今天的数学课堂。这里的割线就是我们刚学的割线。',
      agents,
      {
        sceneTitle: '割线拖动实验',
        sceneType: 'interactive',
        isFirstSpeech: true,
      },
    );

    expect(result.text).toBe('本场景通过交互探索“割线拖动实验”。这里的割线就是当前场景中的割线。');
  });

  it('preserves valid continuity between actions inside the same scene', () => {
    const result = sanitizePortableSpeech('刚才拖动滑块时，可以观察到割线逐渐贴近切线。', agents, {
      sceneTitle: '瞬时变化率拖动实验',
      sceneType: 'interactive',
      isFirstSpeech: false,
      isLastSpeech: false,
    });

    expect(result.changed).toBe(false);
    expect(result.text).toBe('刚才拖动滑块时，可以观察到割线逐渐贴近切线。');
  });

  it('removes fixed next-scene announcements from the final speech', () => {
    const result = sanitizePortableSpeech(
      '导数描述函数在一点附近的瞬时变化率。接下来我们将学习导数符号。',
      agents,
      {
        sceneTitle: '瞬时变化率和切线',
        sceneType: 'slide',
        isLastSpeech: true,
      },
    );

    expect(result.text).toBe('导数描述函数在一点附近的瞬时变化率。');
  });

  it('removes a comma-separated next-scene announcement from the final speech', () => {
    const result = sanitizePortableSpeech(
      '概念和定义已经说明清楚。接下来，我们通过拖动实验继续观察。',
      agents,
      {
        sceneTitle: '平均变化率和割线',
        sceneType: 'slide',
        isLastSpeech: true,
      },
    );

    expect(result.text).toBe('概念和定义已经说明清楚。');
  });

  it('replaces platform-specific post-submit promises with a neutral instruction', () => {
    const result = sanitizePortableSpeech('请先独立作答，提交后我会带你逐题分析。', agents, {
      sceneTitle: '导数概念检查',
      sceneType: 'quiz',
      isFirstSpeech: true,
      isLastSpeech: true,
    });

    expect(result.text).toBe(
      '这是一组关于“导数概念检查”的独立测验。请独立完成每道题，准备好后提交答案。',
    );
  });
});
