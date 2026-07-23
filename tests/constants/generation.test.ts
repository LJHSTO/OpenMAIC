import { describe, expect, it } from 'vitest';

import { resolveGenerationLimit } from '@/lib/constants/generation';

describe('generation input limits', () => {
  it('accepts an integer within the configured range', () => {
    expect(resolveGenerationLimit('120000', 50000, 10000, 500000)).toBe(120000);
  });

  it('falls back for missing, non-integer, or out-of-range values', () => {
    expect(resolveGenerationLimit(undefined, 128, 1, 128)).toBe(128);
    expect(resolveGenerationLimit('32.5', 128, 1, 128)).toBe(128);
    expect(resolveGenerationLimit('0', 128, 1, 128)).toBe(128);
    expect(resolveGenerationLimit('129', 128, 1, 128)).toBe(128);
  });

  it('accepts the raised PDF vision image ceiling', () => {
    expect(resolveGenerationLimit('128', 128, 1, 128)).toBe(128);
  });
});
