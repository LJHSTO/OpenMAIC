import { describe, expect, it } from 'vitest';

import { getModelInfo, getProvider } from '@/lib/ai/providers';

describe('InnoSpark provider defaults', () => {
  it('uses the OpenAI-compatible endpoint and exposes configured models', () => {
    const provider = getProvider('innospark');

    expect(provider).toMatchObject({
      id: 'innospark',
      type: 'openai',
      defaultBaseUrl: 'https://api.innospark.cn/v1',
      supportsModelDiscovery: true,
      requiresApiKey: true,
    });
    expect(provider?.models.map((model) => model.id)).toContain('gpt-5.4');
  });

  it('marks the audited GPT model as vision-capable', () => {
    expect(getModelInfo('innospark', 'gpt-5.4')).toMatchObject({
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
      },
    });
  });
});
