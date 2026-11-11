// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { analyzeMarkdown, isSafeHref, markdownToJson, roundTrip, withHeadlessEditor } from './markdown';

const RICH_SAMPLES = {
  basic: '# Title\n\nA paragraph with **bold**, *italic*, ~~strike~~, `code` and a [link](https://example.com/a?b=1&c=2).\n\n## Section\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n> quoted\n\n---\n\n```\ncode block\n```\n',
  tasks: '- [ ] Check the source before acting.\n- [x] Preserve a local-only record.\n',
  table: '| Name | Value |\n| --- | --- |\n| a | 1 |\n| b, c | 2 |\n',
  email: 'Hi Sam,\n\nThanks for the note.\nI will follow up tomorrow.\n\nBest,\nLeo\n',
  numbered: '3. three\n4. four\n',
};

describe('Markdown fidelity', () => {
  it.each(Object.entries(RICH_SAMPLES))('%s is editable as rich text without losing structure', (_name, text) => {
    expect(analyzeMarkdown(text)).toEqual({ lossless: true, reasons: [] });
    const once = roundTrip(text);
    // Serialising is stable, and re-parsing the output yields the same document.
    expect(roundTrip(once)).toBe(once);
    expect(markdownToJson(once)).toEqual(markdownToJson(text));
  });

  it('keeps plain email line breaks and paragraphs exactly', () => {
    expect(roundTrip(RICH_SAMPLES.email).trimEnd()).toBe(RICH_SAMPLES.email.trimEnd());
  });

  it.each([
    ['raw HTML', 'Text <b>bold</b> and <script>alert(1)</script>\n'],
    ['images', '![alt](https://example.com/a.png)\n'],
    ['reference-style link definitions', 'See [docs][1].\n\n[1]: https://example.com\n'],
    ['table column alignment', '| a | b |\n| :-- | --: |\n| 1 | 2 |\n'],
  ])('flags %s so the document opens in Markdown mode', (reason, text) => {
    const result = analyzeMarkdown(text);
    expect(result.lossless).toBe(false);
    expect(result.reasons).toContain(reason);
  });
});

describe('link safety', () => {
  it('allows only http, https, and mailto targets', () => {
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('http://example.com')).toBe(true);
    expect(isSafeHref('mailto:a@example.org')).toBe(true);
    for (const href of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,hi', 'vbscript:x', '/relative', '']) {
      expect(isSafeHref(href)).toBe(false);
    }
  });

  it('renders unsafe links inert while keeping them in the Markdown text', () => {
    withHeadlessEditor('[x](javascript:alert(1)) and [ok](https://ok.example/)\n', (editor) => {
      const anchors = [...editor.view.dom.querySelectorAll('a')];
      expect(anchors.map((anchor) => anchor.getAttribute('href'))).toEqual(['', 'https://ok.example/']);
      expect(anchors.every((anchor) => anchor.getAttribute('rel')?.includes('noopener'))).toBe(true);
      expect(editor.getHTML()).not.toContain('javascript:');
      expect(editor.getMarkdown()).toContain('[x](javascript:alert(1))');
    });
  });

  it('never creates script, image, or iframe nodes from Markdown input', () => {
    withHeadlessEditor('<script>window.x=1</script><img src=x onerror=alert(1)><iframe src="https://e.com"></iframe>\n', (editor) => {
      expect(editor.view.dom.querySelector('script, img, iframe, [onerror]')).toBeNull();
      expect(editor.getHTML()).not.toMatch(/<(script|img|iframe)/i);
    });
  });
});
