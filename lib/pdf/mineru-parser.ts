/**
 * Shared MinerU result parser.
 * Used by both self-hosted (pdf-providers.ts) and cloud (mineru-cloud.ts) paths.
 * Normalizes MinerU output (markdown + images dict + content_list) into ParsedPdfContent.
 */

import type { ParsedPdfContent } from '@/lib/types/pdf';
import { createLogger } from '@/lib/logger';

const log = createLogger('MinerUParser');

/** Extract ParsedPdfContent from a single MinerU file result */
export function extractMinerUResult(fileResult: Record<string, unknown>): ParsedPdfContent {
  const markdown: string = (fileResult.md_content as string) || '';
  const imageData: Record<string, string> = {};
  let pageCount = 0;

  // Extract images from the images object (key → base64 string)
  if (fileResult.images && typeof fileResult.images === 'object') {
    Object.entries(fileResult.images as Record<string, string>).forEach(([key, value]) => {
      imageData[key] = value.startsWith('data:') ? value : `data:image/png;base64,${value}`;
    });
  }

  // Parse content_list to build image metadata lookup (img_path → metadata)
  const imageMetaLookup = new Map<string, { pageIdx: number; bbox: number[]; caption?: string }>();
  const pageTextParts = new Map<number, string[]>();
  let contentList: unknown;
  try {
    contentList =
      typeof fileResult.content_list === 'string'
        ? JSON.parse(fileResult.content_list as string)
        : fileResult.content_list;
  } catch {
    log.warn('[MinerU] content_list JSON parse failed, continuing without metadata');
  }
  if (Array.isArray(contentList)) {
    const pages = contentList
      .map((item: Record<string, unknown>) => item.page_idx)
      .filter((value: unknown): value is number => typeof value === 'number' && value >= 0);
    pageCount = pages.length > 0 ? Math.max(...pages) + 1 : 0;

    for (const item of contentList as Array<Record<string, unknown>>) {
      const pageIdx = typeof item.page_idx === 'number' ? item.page_idx : 0;
      const textCandidates = [
        item.text,
        item.content,
        item.latex,
        item.table_body,
        ...(Array.isArray(item.table_caption) ? item.table_caption : []),
        ...(Array.isArray(item.image_caption) ? item.image_caption : []),
      ];
      const pageParts = textCandidates
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim());
      if (pageParts.length > 0) {
        pageTextParts.set(pageIdx, [...(pageTextParts.get(pageIdx) ?? []), ...pageParts]);
      }
      if (item.type === 'image' && typeof item.img_path === 'string') {
        const imagePath = item.img_path;
        const metaEntry = {
          pageIdx,
          bbox: (item.bbox as number[] | undefined) || [0, 0, 1000, 1000],
          caption:
            Array.isArray(item.image_caption) && typeof item.image_caption[0] === 'string'
              ? item.image_caption[0]
              : undefined,
        };
        // Store under both the full path and basename so lookup works
        // regardless of whether images dict uses "abc.jpg" or "images/abc.jpg"
        imageMetaLookup.set(imagePath, metaEntry);
        const basename = imagePath.split('/').pop();
        if (basename && basename !== imagePath) {
          imageMetaLookup.set(basename, metaEntry);
        }
      }
    }
  }

  // Build image mapping and pdfImages array
  const imageMapping: Record<string, string> = {};
  const pdfImages: Array<{
    id: string;
    src: string;
    pageNumber: number;
    description?: string;
    width?: number;
    height?: number;
  }> = [];

  Object.entries(imageData).forEach(([key, base64Url], index) => {
    const imageId = key.startsWith('img_') ? key : `img_${index + 1}`;
    imageMapping[imageId] = base64Url;
    // Try exact key first, then with 'images/' prefix (MinerU content_list uses prefixed paths)
    const meta = imageMetaLookup.get(key) || imageMetaLookup.get(`images/${key}`);
    pdfImages.push({
      id: imageId,
      src: base64Url,
      pageNumber: meta ? meta.pageIdx + 1 : 0,
      description: meta?.caption,
      width: meta ? meta.bbox[2] - meta.bbox[0] : undefined,
      height: meta ? meta.bbox[3] - meta.bbox[1] : undefined,
    });
  });

  const images = Object.values(imageMapping);

  log.info(
    `[MinerU] Parsed successfully: ${images.length} images, ` +
      `${markdown.length} chars of markdown`,
  );

  return {
    text: markdown,
    images,
    metadata: {
      pageCount,
      parser: 'mineru',
      pageTexts: Array.from({ length: pageCount }, (_, index) =>
        (pageTextParts.get(index) ?? []).join('\n\n'),
      ),
      imageMapping,
      pdfImages,
    },
  };
}
