import { describe, expect, it } from 'vitest';
import { buildCourseContext } from '@/lib/generation/prompt-formatters';

describe('buildCourseContext', () => {
  it('orients the current scene without exposing prior speech or fixed page transitions', () => {
    const context = buildCourseContext({
      pageIndex: 2,
      totalPages: 3,
      allTitles: ['平均变化率', '瞬时变化率', '导数符号'],
      previousSpeeches: ['这段旧讲解不应进入提示词'],
    });

    expect(context).toContain('Current Scene: 瞬时变化率');
    expect(context).toContain('opened alone');
    expect(context).toContain('inside the current scene');
    expect(context).not.toContain('这段旧讲解不应进入提示词');
    expect(context).not.toContain('Page 2 of 3');
    expect(context).not.toContain('Continue naturally from the previous page');
  });
});
