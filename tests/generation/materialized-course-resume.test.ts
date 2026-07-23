import { describe, expect, it, vi } from 'vitest';
import { completeMaterializedCourse } from '@/lib/generation/materialized-course-resume';

describe('completeMaterializedCourse', () => {
  it('waits for media before finalizing a newly materialized course', async () => {
    const calls: string[] = [];
    const resumeMedia = vi.fn(async () => {
      calls.push('media');
    });
    const finalize = vi.fn(async () => {
      calls.push('finalize');
    });

    const finalized = await completeMaterializedCourse({
      generationComplete: false,
      resumeMedia,
      finalize,
    });

    expect(finalized).toBe(true);
    expect(calls).toEqual(['media', 'finalize']);
  });

  it('does not re-finalize a course that was already completed', async () => {
    const resumeMedia = vi.fn(async () => undefined);
    const finalize = vi.fn(async () => undefined);

    const finalized = await completeMaterializedCourse({
      generationComplete: true,
      resumeMedia,
      finalize,
    });

    expect(finalized).toBe(false);
    expect(resumeMedia).toHaveBeenCalledOnce();
    expect(finalize).not.toHaveBeenCalled();
  });
});
