/**
 * @fileoverview Tests for shared tool utilities — stripHtml formatter, the
 * over-pagination-cap guidance, and the verbatim stateProvince guidance.
 * @module tests/tools/utils.test
 */

import { describe, expect, it } from 'vitest';
import {
  escapeMarkdownText,
  gadmGidNoMatchNotice,
  occurrenceFilters,
  occurrenceFilterViolation,
  occurrenceNoMatchNotices,
  occurrenceScope,
  overPaginationCapNotice,
  PAGINATION_CAP,
  recordedByNoMatchNotice,
  stateProvinceNoMatchNotice,
  stripHtml,
} from '@/mcp-server/tools/utils.js';
import { OCCURRENCE_FILTER_KEYS } from '@/services/gbif/types.js';

describe('escapeMarkdownText', () => {
  it('escapes entity openers, literal markup and Markdown syntax only at rendering', () => {
    expect(escapeMarkdownText('<i>&copy; [x](url) `x` *x*')).toBe(
      '&#60;i&#62;&#38;copy; &#91;x&#93;&#40;url&#41; &#96;x&#96; &#42;x&#42;',
    );
  });
  it('keeps multiline inline slots inside their surrounding Markdown block', () => {
    expect(escapeMarkdownText('first\n\n# second')).toBe('first&#10;&#10;&#35; second');
    expect(escapeMarkdownText('first\n\n# second', false)).toBe('first\n\n&#35; second');
  });
  it('preserves carriage returns instead of letting CommonMark normalize them', () => {
    expect(escapeMarkdownText('first\rsecond')).toBe('first&#13;second');
    expect(escapeMarkdownText('first\r\nsecond')).toBe('first&#13;&#10;second');
    expect(escapeMarkdownText('first\rsecond', false)).toBe('first&#13;second');
    expect(escapeMarkdownText('first\r\nsecond', false)).toBe('first&#13;\nsecond');
  });
  it('preserves boundary whitespace in inline names without encoding internal spaces', () => {
    expect(escapeMarkdownText('  Parus major  ')).toBe('&#32; Parus major &#32;');
    expect(escapeMarkdownText('\tParus major')).toBe('&#9;Parus major');
    expect(escapeMarkdownText('first\n    second', false)).toBe('first\n&#32;   second');
  });
});

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
   * Counts reconcile only when each call repeats the same biological filters.
   */
  it('conditions the bucket arithmetic on the facet call repeating the filters', () => {
    const notice = overPaginationCapNotice(60_290_950) as string;
    expect(notice).not.toMatch(/sum to exactly this total/i);
    expect(notice).toMatch(/repeat this query's filters/i);
    expect(notice).toContain('all three occurrence tools accept the same biological filters');
    expect(notice).not.toContain('does not accept');
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

  /** #77 — the coordinate-derived GID is the normalized alternative to the verbatim string. */
  it('names gadmGid and its facet as the normalized alternative', () => {
    const notice = stateProvinceNoMatchNotice('Andalusia', 0) as string;
    expect(notice).toContain('gadmGid');
    expect(notice).toContain('GADM_LEVEL_1_GID');
    expect(notice).toMatch(/coordinates/);
  });
});

/**
 * #77, #78 — GBIF answers a well-formed GID or collector name it does not hold with
 * 200 and zero records, so a zero under either filter is ambiguous the way a
 * stateProvince zero is, and each names the facet that lists the values it accepts.
 */
describe('gadmGid and recordedBy no-match notices', () => {
  for (const { build, field, facets, value, matchedValue, semantics } of [
    {
      build: gadmGidNoMatchNotice,
      field: 'gadmGid',
      facets: ['GADM_LEVEL_0_GID', 'GADM_LEVEL_1_GID', 'GADM_LEVEL_2_GID', 'GADM_LEVEL_3_GID'],
      value: 'ESP.99_1',
      matchedValue: 'ESP.1_1',
      semantics: /coordinates/,
    },
    {
      build: recordedByNoMatchNotice,
      field: 'recordedBy',
      facets: ['RECORDED_BY'],
      value: 'charles darwin',
      matchedValue: 'Charles Darwin',
      semantics: /case-sensitive/,
    },
  ]) {
    it(`${field} stays silent when the filter was not applied`, () => {
      for (const absent of [undefined, '', '   ']) expect(build(absent, 0)).toBeUndefined();
    });
    it(`${field} stays silent when the value matched records`, () => {
      expect(build(matchedValue, 1)).toBeUndefined();
      expect(build(matchedValue, 787)).toBeUndefined();
    });
    it(`${field} echoes the value, its matching, and every facet that lists accepted values`, () => {
      const notice = build(value, 0) as string;
      expect(notice).toContain(`${field} "${value}"`);
      expect(notice).toMatch(semantics);
      expect(notice).toMatch(/does not distinguish/);
      expect(notice).toContain('gbif_occurrence_facets');
      for (const facet of facets) expect(notice).toContain(facet);
    });
  }

  it('composes every applicable notice in a fixed order and none on a match', () => {
    const input = { stateProvince: 'Andalusia', gadmGid: 'ESP.99_1', recordedBy: 'charles darwin' };
    const notices = occurrenceNoMatchNotices(input, 0);
    expect(notices).toEqual([
      stateProvinceNoMatchNotice('Andalusia', 0),
      gadmGidNoMatchNotice('ESP.99_1', 0),
      recordedByNoMatchNotice('charles darwin', 0),
    ]);
    expect(notices.every(Boolean)).toBe(true);
    expect(occurrenceNoMatchNotices(input, 1).filter(Boolean)).toEqual([]);
    expect(occurrenceNoMatchNotices({ gadmGid: 'ESP.99_1' }, 0).filter(Boolean)).toHaveLength(1);
  });
});

/**
 * One validator serves search, count, and facets, so a filter added to one cannot
 * be guarded on another and skipped on the third. Blank detection runs first and
 * in declaration order, so the reported field is stable for a given input.
 */
describe('occurrenceFilterViolation', () => {
  const blankable = [
    'scientificName',
    'stateProvince',
    'decimalLatitude',
    'decimalLongitude',
    'geometry',
    'year',
    'coordinateUncertaintyInMeters',
    'gadmGid',
    'catalogNumber',
    'institutionCode',
    'recordedBy',
  ] as const;

  it('passes every well-formed value, and an input with no filters', () => {
    expect(occurrenceFilterViolation({})).toBeUndefined();
    expect(
      occurrenceFilterViolation({
        scientificName: ' Panthera leo ',
        stateProvince: 'England',
        decimalLatitude: '50,52',
        decimalLongitude: '-2,-1',
        geometry: 'POLYGON((-2 50,-1 50,-1 51,-2 51,-2 50))',
        year: '2020',
        coordinateUncertaintyInMeters: '0,1000',
        gadmGid: 'ESP.1_1',
        catalogNumber: 'L.1592880',
        institutionCode: 'K',
        recordedBy: 'Darwin, C.',
        datasetKey: '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
      }),
    ).toBeUndefined();
  });

  it.each(blankable)('names %s when it is blank or whitespace-only', (field) => {
    for (const blank of ['', '   ', '\t\n']) {
      expect(occurrenceFilterViolation({ [field]: blank })).toBe(
        `${field} was supplied blank. Omit the field to leave it unfiltered — a blank value is not a way to skip a filter.`,
      );
    }
  });

  it('reports the first blank field in declaration order', () => {
    expect(occurrenceFilterViolation({ recordedBy: '', scientificName: ' ' })).toContain(
      'scientificName',
    );
  });

  it.each(['', '   ', 'eBird', ' 4fa7b334-ce0d-4e88-aaae-2e0c138d049e '])(
    'rejects datasetKey "%s" as not a dataset UUID',
    (datasetKey) => {
      expect(occurrenceFilterViolation({ datasetKey })).toBe(
        `datasetKey "${datasetKey}" is not a GBIF dataset UUID.`,
      );
    },
  );

  /**
   * GBIF matches a GID exactly and case-sensitively and answers any other form —
   * `esp.1_1`, a place name, a padded or hyphenated value — with 200 and zero
   * records, so the alphabet is checked locally. The grammar is not: `Z01`,
   * `CHN.HKG`, and `GHA7_2` are real GIDs a stricter pattern would refuse.
   */
  it.each(['esp.1_1', 'Andalucía', 'ESP 1_1', 'ESP-1', ' ESP', 'ESP\n', 'ESP.1_1;', 'ÉSP'])(
    'rejects gadmGid "%s" outside the GID alphabet',
    (gadmGid) => {
      const violation = occurrenceFilterViolation({ gadmGid }) as string;
      expect(violation).toContain(`gadmGid "${gadmGid}"`);
      expect(violation).toMatch(/uppercase letters, digits, dots, and underscores/);
    },
  );

  it.each(['ESP', 'ESP.1_1', 'ESP.1.5_1', 'ESP.1.6.3_1', 'Z01', 'CHN.HKG', 'GHA7_2'])(
    'accepts the real GID shape %s',
    (gadmGid) => {
      expect(occurrenceFilterViolation({ gadmGid })).toBeUndefined();
    },
  );

  /**
   * gadmGid carries no schema length bound, so its alphabet check is timed like any
   * scanner over caller-sized text: a long valid run ending in one bad character,
   * a run that passes whole, and the two line-break shapes (one long line ending in
   * a break, breaks throughout — the latter whitespace-only, so it exercises the
   * blank check that runs first).
   */
  it('stays linear in thread CPU across a 64-fold span of gadmGid input', () => {
    const shapes = {
      'valid-run-then-bad': (size: number) => `${'A'.repeat(size)}a`,
      'valid-throughout': (size: number) => 'ESP.1_'.repeat(Math.ceil(size / 6)),
      'trailing-break': (size: number) => `${'§1 x'.repeat(size / 4)}\ny`,
      'embedded-breaks': (size: number) => '  \r\n'.repeat(size / 4),
    };
    for (const [shape, build] of Object.entries(shapes)) {
      const measurements: number[] = [];
      for (const size of [5000, 10000, 20000, 40000, 80000, 160000, 320000]) {
        const gadmGid = build(size);
        const expected = occurrenceFilterViolation({ gadmGid });
        // Warm each exact shape so regex tier transitions fall outside the measured span.
        for (let i = 0; i < 32; i++) occurrenceFilterViolation({ gadmGid });
        const start = process.threadCpuUsage();
        for (let i = 0; i < 8; i++) expect(occurrenceFilterViolation({ gadmGid })).toBe(expected);
        const cpu = process.threadCpuUsage(start);
        const cpuUs = cpu.user + cpu.system;
        expect(cpuUs, `${shape} at ${size}`).toBeLessThan(250_000);
        measurements.push(cpuUs);
      }
      expect(measurements.at(-1)! / Math.max(measurements[0]!, 1), shape).toBeLessThan(256);
    }
  });
});

/** One table decides what the three occurrence tools forward and echo. */
describe('occurrence filter table', () => {
  const everyFilter = {
    taxonKey: 0,
    scientificName: ' Panthera leo ',
    country: 'ZA',
    publishingCountry: 'US',
    stateProvince: ' Limpopo ',
    decimalLatitude: '-35,-20',
    decimalLongitude: '15,35',
    geometry: 'POLYGON((15 -35,35 -35,35 -20,15 -20,15 -35))',
    year: '2020,2024',
    month: 12,
    basisOfRecord: 'FOSSIL_SPECIMEN',
    hasCoordinate: false,
    isInCluster: false,
    coordinateUncertaintyInMeters: '0,1000',
    datasetKey: '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
    iucnRedListCategory: 'VU',
    gadmGid: 'ESP.1_1',
    catalogNumber: 'l.1592880',
    institutionCode: 'clo',
    recordedBy: 'Darwin, C.',
    mediaType: 'Sound',
  } as const;

  it('covers every biological filter the occurrence tools accept, and nothing else', () => {
    expect([...OCCURRENCE_FILTER_KEYS].sort()).toEqual(
      [...Object.keys(everyFilter), 'occurrenceStatus'].sort(),
    );
  });

  it('echoes supplied values, false and zero included, and drops controls', () => {
    const scope = occurrenceScope({
      ...everyFilter,
      occurrenceStatus: 'ANY',
      limit: 3,
      facet: 'COUNTRY',
    } as Parameters<typeof occurrenceScope>[0]);
    expect(scope).toEqual({ ...everyFilter, occurrenceStatus: 'ANY' });
    expect(occurrenceScope({ occurrenceStatus: 'PRESENT' })).toEqual({
      occurrenceStatus: 'PRESENT',
    });
  });

  it('resolves ANY to no occurrenceStatus and keeps PRESENT and ABSENT', () => {
    expect(occurrenceFilters({ ...everyFilter, occurrenceStatus: 'ANY' })).toEqual(everyFilter);
    for (const occurrenceStatus of ['PRESENT', 'ABSENT'] as const)
      expect(occurrenceFilters({ taxonKey: 1, occurrenceStatus })).toEqual({
        taxonKey: 1,
        occurrenceStatus,
      });
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
    expect(stripHtml('<p>  hello  <br/>  world  </p>')).toBe('hello\n\nworld');
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
    expect(stripHtml('line1<br/>line2')).toBe('line1\n\nline2');
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
    const result = stripHtml('Copyright &#169;');
    expect(result).toBe('Copyright ©');
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
      expect(stripHtml('&#169; &nbsp; &copy; &#x3c;')).toBe('© &copy; <');
    });
    it('decodes numeric code points once and leaves invalid scalars verbatim', () => {
      expect(stripHtml('&#64; &#x1f426; &amp;#64;')).toBe('@ 🐦 &#64;');
      expect(stripHtml('&#0; &#xD800; &#1114112;')).toBe('&#0; &#xD800; &#1114112;');
    });
  });
});
