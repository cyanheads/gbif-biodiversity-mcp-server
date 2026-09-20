/**
 * @fileoverview Tests for shared tool utilities — stripHtml formatter, the
 * over-pagination-cap guidance, and the verbatim stateProvince guidance.
 * @module tests/tools/utils.test
 */

import { describe, expect, it } from 'vitest';
import {
  overPaginationCapNotice,
  PAGINATION_CAP,
  stateProvinceNoMatchNotice,
  stripHtml,
} from '@/mcp-server/tools/utils.js';

/**
 * #33 — a result set past the cap has no continuation path in this server, so the
 * guidance has to carry the whole picture: why paging stops, the partition dimension
 * that provably covers a scope, the condition under which its buckets add up to the
 * caller's own total, and the fact that a bulk download is a route the caller takes
 * elsewhere. A hint that only redirects to facet aggregation reads as "facets
 * substitute for records", which they do not.
 */
describe('overPaginationCapNotice', () => {
  it('matches the boundary GBIF enforces', () => {
    expect(PAGINATION_CAP).toBe(100_001);
  });

  it('stays silent for a result set paging can reach', () => {
    expect(overPaginationCapNotice(0)).toBeUndefined();
    expect(overPaginationCapNotice(PAGINATION_CAP)).toBeUndefined();
  });

  it('fires one record past the boundary', () => {
    expect(overPaginationCapNotice(PAGINATION_CAP + 1)).toBeDefined();
  });

  it('names the total, the partition dimension, and the absence of a cursor', () => {
    const notice = overPaginationCapNotice(60_290_950) as string;
    expect(notice).toContain('60,290,950');
    expect(notice).toContain('100,001');
    expect(notice).toContain('DATASET_KEY');
    expect(notice).toContain('gbif_occurrence_facets');
    expect(notice).toMatch(/no cursor or scroll/i);
  });

  it('states that a bulk download is not available here and names the real routes', () => {
    const notice = overPaginationCapNotice(60_290_950) as string;
    expect(notice).toMatch(/GBIF\.org account/);
    expect(notice).toContain('AWS Open Data');
  });

  it('ties the bucket arithmetic to the applied occurrenceStatus', () => {
    expect(overPaginationCapNotice(60_290_950)).toContain('occurrenceStatus');
  });

  /**
   * The two tools that emit this notice accept filters gbif_occurrence_facets does
   * not, so a facet call that drops them aggregates a wider scope than the caller
   * asked about — a search narrowed by month=6 reports 4,959,328 while its
   * DATASET_KEY buckets sum to the unnarrowed 60,290,950. Promising the buckets
   * "sum to exactly this total" unconditionally is wrong precisely where a caller
   * would use the arithmetic to plan the split.
   */
  it('conditions the bucket arithmetic on the facet call repeating the filters', () => {
    const notice = overPaginationCapNotice(60_290_950) as string;
    expect(notice).not.toMatch(/sum to exactly this total/i);
    expect(notice).toMatch(/repeat this query's filters/i);
    expect(notice).toContain('month');
    expect(notice).toContain('scientificName');
  });

  /**
   * #49 — publishingCountry became a filter on all three occurrence tools, so a
   * bucket still over the ceiling has a second gap-free axis besides basisOfRecord.
   * The guidance previously had to name only one, and a stale "only basisOfRecord"
   * would steer a caller off the axis that now works.
   */
  it('names both gap-free second axes now that each has a matching filter', () => {
    const notice = overPaginationCapNotice(60_290_950) as string;
    expect(notice).toContain('basisOfRecord');
    expect(notice).toContain('publishingCountry');
    expect(notice).not.toMatch(/only the former/i);
  });
});

/**
 * #49 — stateProvince is the one occurrence filter with no vocabulary behind it.
 * GBIF matches the verbatim string exactly and case-sensitively and answers a value
 * it does not hold with 200 and zero records, so no pattern can guard it and a zero
 * is ambiguous in a way no other filter's is: measured on one scope, `England`
 * matches 47,672,439 records while `england` and `ENGLAND` each match none.
 */
describe('stateProvinceNoMatchNotice', () => {
  it('stays silent when the filter was not applied', () => {
    expect(stateProvinceNoMatchNotice(undefined, 0)).toBeUndefined();
    expect(stateProvinceNoMatchNotice('', 0)).toBeUndefined();
    expect(stateProvinceNoMatchNotice('   ', 0)).toBeUndefined();
  });

  it('stays silent when the value matched records', () => {
    expect(stateProvinceNoMatchNotice('England', 47_672_439)).toBeUndefined();
    expect(stateProvinceNoMatchNotice('England', 1)).toBeUndefined();
  });

  it('fires only where the result is empty and the filter was applied', () => {
    expect(stateProvinceNoMatchNotice('england', 0)).toBeDefined();
  });

  it('echoes the value, names the match semantics, and points at the facet', () => {
    const notice = stateProvinceNoMatchNotice('england', 0) as string;
    expect(notice).toContain('"england"');
    expect(notice).toMatch(/verbatim/i);
    expect(notice).toMatch(/case-sensitive/i);
    expect(notice).toContain('STATE_PROVINCE');
    expect(notice).toContain('gbif_occurrence_facets');
  });

  /**
   * The whole point is separating a typo from an empty region. A notice that only
   * said "no records matched" would restate what the caller can already see.
   */
  it('says the zero does not distinguish a typo from an empty region', () => {
    const notice = stateProvinceNoMatchNotice('NotARealPlace', 0) as string;
    expect(notice).toMatch(/does not distinguish/i);
    expect(notice).toMatch(/instead of an error|rather than an error/i);
  });
});

describe('stripHtml', () => {
  it('removes simple HTML tags', () => {
    expect(stripHtml('<p>Hello world</p>')).toBe('Hello world');
  });

  it('removes nested tags', () => {
    expect(stripHtml('<div><strong>Bold</strong> text</div>')).toBe('Bold text');
  });

  it('decodes &amp;', () => {
    expect(stripHtml('A &amp; B')).toBe('A & B');
  });

  it('decodes &lt; and &gt;', () => {
    expect(stripHtml('&lt;tag&gt;')).toBe('<tag>');
  });

  it('decodes &quot;', () => {
    expect(stripHtml('Say &quot;hello&quot;')).toBe('Say "hello"');
  });

  it('decodes &#34; (decimal quote)', () => {
    expect(stripHtml('A&#34;B')).toBe('A"B');
  });

  it('decodes &#39; (apostrophe)', () => {
    expect(stripHtml('It&#39;s fine')).toBe("It's fine");
  });

  it('decodes &#61; (equals)', () => {
    expect(stripHtml('a&#61;b')).toBe('a=b');
  });

  it('decodes &#43; (plus)', () => {
    expect(stripHtml('a&#43;b')).toBe('a+b');
  });

  it('collapses multiple whitespace into single space', () => {
    expect(stripHtml('hello   world')).toBe('hello world');
  });

  it('trims leading and trailing whitespace', () => {
    expect(stripHtml('  hello  ')).toBe('hello');
  });

  it('removes tags and normalizes whitespace together', () => {
    expect(stripHtml('<p>  hello  <br/>  world  </p>')).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(stripHtml('   ')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(stripHtml('plain text')).toBe('plain text');
  });

  it('handles tag with attributes', () => {
    expect(stripHtml('<a href="https://example.com">link</a>')).toBe('link');
  });

  it('handles self-closing tags', () => {
    expect(stripHtml('line1<br/>line2')).toBe('line1 line2');
  });

  it('handles deeply nested HTML', () => {
    const html = '<div><ul><li><strong>item</strong></li></ul></div>';
    expect(stripHtml(html)).toBe('item');
  });

  // Security: tag delimiters are removed; inner text content remains (by design —
  // stripHtml is a text extractor, not an HTML sanitizer for execution contexts).
  it('removes script tag delimiters', () => {
    const result = stripHtml('<script>alert("xss")</script>description');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('</script>');
    // Inner text content is preserved — this is the extractor's intended behavior
    expect(result).toContain('description');
  });

  it('removes style tag delimiters', () => {
    const result = stripHtml('<style>body{display:none}</style>text');
    expect(result).not.toContain('<style>');
    expect(result).not.toContain('</style>');
    expect(result).toContain('text');
  });

  it('handles unicode text without modification', () => {
    expect(stripHtml('<p>Parus major — Großer Meise</p>')).toBe('Parus major — Großer Meise');
  });

  it('handles HTML with numeric entities for special chars', () => {
    // Verify numeric entities that are NOT in our map pass through unchanged
    const result = stripHtml('Copyright &#169;');
    expect(result).toContain('&#169;'); // not in decode map, left as-is
  });

  /**
   * #56 (CodeQL js/double-escaping) — a replacement's output must never be read
   * by a later replacement. Decoding `&amp;` ahead of the references that follow
   * it turned the `&` it produced into the opening of the next one, so text that
   * literally contains an escaped reference lost a level of escaping: `&amp;lt;`
   * spells the four characters `&lt;`, and the second pass collapsed them to `<`.
   */
  describe('decodes each reference exactly once', () => {
    it('leaves a double-encoded tag as the literal reference text', () => {
      expect(stripHtml('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
    });

    it('does not re-read an &amp;-produced & as the start of another reference', () => {
      expect(stripHtml('&amp;quot;q&amp;quot;')).toBe('&quot;q&quot;');
      expect(stripHtml('&amp;#39;')).toBe('&#39;');
      expect(stripHtml('&amp;amp;')).toBe('&amp;');
    });

    it('still decodes a single-encoded reference beside a double-encoded one', () => {
      expect(stripHtml('&lt;b&gt; vs &amp;lt;b&amp;gt;')).toBe('<b> vs &lt;b&gt;');
    });

    it('leaves a reference outside the supported set verbatim', () => {
      expect(stripHtml('&#169; &nbsp; &copy; &#x3c;')).toBe('&#169; &nbsp; &copy; &#x3c;');
    });
  });
});
