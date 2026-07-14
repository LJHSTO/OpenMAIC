import type { ParsedPdfContent } from '@/lib/types/pdf';

const MAX_SELECTED_PAGES = 10_000;

export class PageRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageRangeError';
  }
}

export interface ParsedPageRange {
  pages: number[];
  normalized: string;
}

export function parsePageRange(value: string, maxPage?: number): ParsedPageRange {
  const input = value.trim();
  if (!input) throw new PageRangeError('Page range cannot be empty');
  if (maxPage !== undefined && (!Number.isInteger(maxPage) || maxPage < 1)) {
    throw new PageRangeError('The document does not expose a valid page count');
  }

  const pages = new Set<number>();
  for (const rawPart of input.split(',')) {
    const part = rawPart.trim();
    if (!part) throw new PageRangeError(`Invalid page range "${value}"`);

    const single = part.match(/^(\d+)$/);
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!single && !range) {
      throw new PageRangeError(
        `Invalid page range segment "${part}". Use forms such as 3, 1-10, or 1-3,7,10-12.`,
      );
    }

    const start = Number(single?.[1] ?? range?.[1]);
    const end = Number(single?.[1] ?? range?.[2]);
    if (start < 1 || end < 1) throw new PageRangeError('Page numbers must start at 1');
    if (start > end) throw new PageRangeError(`Page range start exceeds end in "${part}"`);
    if (maxPage !== undefined && end > maxPage) {
      throw new PageRangeError(
        `Page ${end} exceeds the document page count (${maxPage}) in range "${part}"`,
      );
    }
    if (end - start + 1 > MAX_SELECTED_PAGES || pages.size > MAX_SELECTED_PAGES) {
      throw new PageRangeError(`Page range selects more than ${MAX_SELECTED_PAGES} pages`);
    }
    for (let page = start; page <= end; page += 1) pages.add(page);
  }

  const sorted = [...pages].sort((left, right) => left - right);
  if (sorted.length > MAX_SELECTED_PAGES) {
    throw new PageRangeError(`Page range selects more than ${MAX_SELECTED_PAGES} pages`);
  }
  return { pages: sorted, normalized: normalizePages(sorted) };
}

function normalizePages(pages: number[]): string {
  const parts: string[] = [];
  let start = pages[0];
  let previous = pages[0];
  for (let index = 1; index <= pages.length; index += 1) {
    const current = pages[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    parts.push(start === previous ? String(start) : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  return parts.join(',');
}

function getPageTexts(content: ParsedPdfContent, pageCount: number): string[] | null {
  const metadataPageTexts = content.metadata?.pageTexts;
  if (
    Array.isArray(metadataPageTexts) &&
    metadataPageTexts.every((pageText) => typeof pageText === 'string')
  ) {
    return metadataPageTexts as string[];
  }

  if (!content.layout?.some((block) => block.page > 0)) return null;
  const pageTexts = Array.from({ length: pageCount }, () => [] as string[]);
  for (const block of content.layout) {
    if (block.page < 1 || block.page > pageCount || !block.content.trim()) continue;
    pageTexts[block.page - 1].push(block.content.trim());
  }
  return pageTexts.map((parts) => parts.join('\n\n'));
}

export function selectParsedPdfPages(
  content: ParsedPdfContent,
  pageRange: string,
): ParsedPdfContent {
  const sourcePageCount = content.metadata?.pageCount ?? 0;
  const selection = parsePageRange(pageRange, sourcePageCount);
  const selected = new Set(selection.pages);
  const pageTexts = getPageTexts(content, sourcePageCount);
  if (!pageTexts) {
    const parser = content.metadata?.parser ?? 'selected';
    throw new PageRangeError(
      `PDF provider "${parser}" did not return page-level text, so page range ${selection.normalized} cannot be applied safely. Use unpdf or a provider that returns page layout data.`,
    );
  }

  const sourceImages = content.metadata?.pdfImages;
  if (content.images.length > 0 && !sourceImages?.length) {
    throw new PageRangeError(
      `PDF provider "${content.metadata?.parser ?? 'selected'}" did not associate images with page numbers, so page range ${selection.normalized} cannot be applied safely.`,
    );
  }
  const pdfImages = (sourceImages ?? []).filter((image) => selected.has(image.pageNumber));
  const selectedPageTexts = selection.pages.map((page) => pageTexts[page - 1]?.trim() ?? '');
  if (selectedPageTexts.every((pageText) => !pageText) && pdfImages.length === 0) {
    throw new PageRangeError(
      `The selected pages (${selection.normalized}) contain no page-level text or images from provider "${content.metadata?.parser ?? 'selected'}".`,
    );
  }
  const selectedText = selection.pages
    .map((page, index) => `## Source page ${page}\n\n${selectedPageTexts[index]}`.trim())
    .join('\n\n');
  const imageMapping = Object.fromEntries(pdfImages.map((image) => [image.id, image.src]));

  return {
    ...content,
    text: selectedText,
    images: pdfImages.map((image) => image.src),
    ...(content.tables
      ? { tables: content.tables.filter((table) => selected.has(table.page)) }
      : {}),
    ...(content.formulas
      ? { formulas: content.formulas.filter((formula) => selected.has(formula.page)) }
      : {}),
    ...(content.layout
      ? { layout: content.layout.filter((block) => selected.has(block.page)) }
      : {}),
    metadata: {
      ...content.metadata,
      sourcePageCount,
      pageCount: selection.pages.length,
      pageRange: selection.normalized,
      selectedPages: selection.pages,
      pageTexts: selectedPageTexts,
      imageMapping,
      pdfImages,
    },
  };
}
