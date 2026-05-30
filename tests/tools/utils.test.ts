/**
 * @fileoverview Tests for shared tool utilities — stripHtml formatter.
 * @module tests/tools/utils.test
 */

import { describe, expect, it } from 'vitest';
import { stripHtml } from '@/mcp-server/tools/utils.js';

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
});
