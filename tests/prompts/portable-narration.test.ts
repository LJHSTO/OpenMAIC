import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const actionTemplates = [
  'slide-actions/system.md',
  'interactive-actions/system.md',
  'quiz-actions/system.md',
  'pbl-actions/system.md',
];

describe('portable narration prompt rules', () => {
  it.each(actionTemplates)('%s forbids agent names in speech', (relativePath) => {
    const text = readFileSync(
      path.join(process.cwd(), 'lib', 'prompts', 'templates', relativePath),
      'utf8',
    );

    expect(text).toMatch(/Portable narration/i);
    expect(text).toMatch(/never[\s\S]*agent[\s\S]*name/i);
    expect(text).toMatch(/must never appear in `text` content/i);
    expect(text).toMatch(/Standalone (?:scene|quiz) continuity/i);
    expect(text).toMatch(/previous|surrounding|fixed next/i);
  });

  it('keeps web research inside the requested course boundary', () => {
    const text = readFileSync(
      path.join(
        process.cwd(),
        'lib',
        'prompts',
        'templates',
        'requirements-to-outlines',
        'user.md',
      ),
      'utf8',
    );

    expect(text).toMatch(/supplementary evidence only/i);
    expect(text).toMatch(/preserve[\s\S]*learner level[\s\S]*quiz scope/i);
    expect(text).toMatch(/do not add advanced concepts/i);
  });

  it('quiz narration does not promise a post-submit agent conversation', () => {
    const text = readFileSync(
      path.join(process.cwd(), 'lib', 'prompts', 'templates', 'quiz-actions', 'system.md'),
      'utf8',
    );

    expect(text).toMatch(/platform-independent/i);
    expect(text).toMatch(/Never promise[\s\S]*(?:teacher|assistant|agent)/i);
    expect(text).not.toContain("I'll be right here after you submit");
    expect(text).not.toMatch(/discuss results[\s\S]*after (?:they|you) submit/i);
    expect(text).not.toMatch(/set expectations for what happens after submitting/i);
  });
});
