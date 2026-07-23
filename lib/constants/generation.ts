/**
 * Constants for PDF content generation
 * Shared between client and server code
 */

export function resolveGenerationLimit(
  rawValue: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

// Public env names keep browser preview and server generation on the same limits.
export const MAX_PDF_CONTENT_CHARS = resolveGenerationLimit(
  process.env.NEXT_PUBLIC_MAX_PDF_CONTENT_CHARS,
  50000,
  10000,
  500000,
);

export const MAX_VISION_IMAGES = resolveGenerationLimit(
  process.env.NEXT_PUBLIC_MAX_VISION_IMAGES,
  128,
  1,
  128,
);
