import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  createClassroomGenerationJob: vi.fn(),
  runClassroomGenerationJob: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}));

vi.mock('nanoid', () => ({ nanoid: () => 'batch-job-1' }));

vi.mock('@/lib/server/classroom-job-store', () => ({
  createClassroomGenerationJob: mocks.createClassroomGenerationJob,
}));

vi.mock('@/lib/server/classroom-job-runner', () => ({
  runClassroomGenerationJob: mocks.runClassroomGenerationJob,
}));

vi.mock('@/lib/server/classroom-storage', () => ({
  buildRequestOrigin: () => 'http://localhost',
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

describe('POST /api/generate-classroom', () => {
  beforeEach(() => {
    mocks.after.mockReset();
    mocks.createClassroomGenerationJob.mockReset();
    mocks.runClassroomGenerationJob.mockReset();
    mocks.createClassroomGenerationJob.mockResolvedValue({
      status: 'queued',
      step: 'queued',
      message: 'queued',
    });
  });

  it('keeps the per-job model when queuing batch generation', async () => {
    const { POST } = await import('@/app/api/generate-classroom/route');
    const request = new NextRequest('http://localhost/api/generate-classroom', {
      method: 'POST',
      body: JSON.stringify({
        requirement: 'Teach calculus in Chinese',
        model: '  openai:gpt-5.5  ',
        enableImageGeneration: false,
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = (await response.json()) as { success: boolean; jobId: string };

    expect(response.status).toBe(202);
    expect(payload).toMatchObject({ success: true, jobId: 'batch-job-1' });
    expect(mocks.createClassroomGenerationJob).toHaveBeenCalledWith('batch-job-1', {
      requirement: 'Teach calculus in Chinese',
      model: 'openai:gpt-5.5',
      enableImageGeneration: false,
    });
    expect(mocks.after).toHaveBeenCalledOnce();
  });
});
