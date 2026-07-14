import { describe, expect, it } from 'vitest';
import { PageRangeError, parsePageRange, selectParsedPdfPages } from '@/lib/document/page-range';

describe('PDF page range selection', () => {
  it('parses, sorts, de-duplicates, and normalizes mixed ranges', () => {
    expect(parsePageRange('3, 1-2, 2, 7-8', 10)).toEqual({
      pages: [1, 2, 3, 7, 8],
      normalized: '1-3,7-8',
    });
  });

  it('rejects malformed and out-of-bounds ranges', () => {
    expect(() => parsePageRange('4-2', 10)).toThrow(PageRangeError);
    expect(() => parsePageRange('1-3,abc', 10)).toThrow(/Invalid page range segment/);
    expect(() => parsePageRange('11', 10)).toThrow(/exceeds the document page count/);
  });

  it('filters page text, images, tables, formulas, and layout together', () => {
    const selected = selectParsedPdfPages(
      {
        text: 'all pages',
        images: ['page-1-image', 'page-3-image'],
        tables: [
          { page: 1, data: [['one']] },
          { page: 3, data: [['three']] },
        ],
        formulas: [
          { page: 2, latex: 'x' },
          { page: 3, latex: 'y' },
        ],
        layout: [
          { page: 1, type: 'text', content: 'first' },
          { page: 3, type: 'text', content: 'third' },
        ],
        metadata: {
          pageCount: 3,
          parser: 'unpdf',
          pageTexts: ['first', 'second', 'third'],
          pdfImages: [
            { id: 'img_1', src: 'page-1-image', pageNumber: 1 },
            { id: 'img_2', src: 'page-3-image', pageNumber: 3 },
          ],
        },
      },
      '1,3',
    );

    expect(selected.text).toContain('Source page 1');
    expect(selected.text).toContain('Source page 3');
    expect(selected.images).toEqual(['page-1-image', 'page-3-image']);
    expect(selected.tables).toHaveLength(2);
    expect(selected.formulas).toEqual([{ page: 3, latex: 'y' }]);
    expect(selected.metadata).toMatchObject({
      pageCount: 2,
      sourcePageCount: 3,
      pageRange: '1,3',
      selectedPages: [1, 3],
    });
  });

  it('fails explicitly when a provider has no page-level text', () => {
    expect(() =>
      selectParsedPdfPages(
        { text: 'merged only', images: [], metadata: { pageCount: 3, parser: 'legacy' } },
        '2',
      ),
    ).toThrow(/did not return page-level text/);
  });
});
