import { Editor, type AnyExtension, type JSONContent } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { Lexer, type Token, type Tokens } from 'marked';

// Unsafe link targets (javascript:, data:, relative) survive in the Markdown text but
// render with an empty href, so they are inert in the editor and in copied HTML.

/** Only these link targets become navigable anchors anywhere in the interface. */
export function isSafeHref(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/**
 * The single editor schema used for every rich draft. It deliberately has no
 * image, iframe, raw HTML, or underline support: everything it can hold can be
 * written back as plain Markdown.
 */
export function editorExtensions(placeholder = ''): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ['mailto'],
        defaultProtocol: 'https',
        isAllowedUri: (url) => isSafeHref(url),
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({ placeholder }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
  ];
}

/** Markdown constructs the rich editor would drop or alter instead of preserving. */
export interface MarkdownFidelity {
  lossless: boolean;
  reasons: string[];
}

const SUPPORTED_BLOCKS = new Set([
  'space', 'paragraph', 'heading', 'list', 'list_item', 'blockquote', 'code', 'hr', 'table', 'text', 'checkbox',
]);
const SUPPORTED_INLINE = new Set([
  'text', 'strong', 'em', 'codespan', 'del', 'link', 'br', 'escape', 'checkbox',
]);

function describe(type: string): string {
  switch (type) {
    case 'html': return 'raw HTML';
    case 'image': return 'images';
    case 'def': return 'reference-style link definitions';
    default: return `${type} blocks`;
  }
}

function walkInline(tokens: Token[] | undefined, reasons: Set<string>) {
  for (const token of tokens ?? []) {
    if (!SUPPORTED_INLINE.has(token.type)) {
      reasons.add(describe(token.type));
      continue;
    }
    if ('tokens' in token && Array.isArray(token.tokens)) walkInline(token.tokens, reasons);
  }
}

function walkBlocks(tokens: Token[], reasons: Set<string>) {
  for (const token of tokens) {
    if (!SUPPORTED_BLOCKS.has(token.type)) {
      reasons.add(describe(token.type));
      continue;
    }
    switch (token.type) {
      case 'heading':
      case 'paragraph':
        walkInline(token.tokens, reasons);
        break;
      case 'text':
        if (token.tokens) walkInline(token.tokens, reasons);
        break;
      case 'blockquote':
        walkBlocks((token as Tokens.Blockquote).tokens, reasons);
        break;
      case 'list':
        for (const item of (token as Tokens.List).items) walkBlocks(item.tokens, reasons);
        break;
      case 'table': {
        const table = token as Tokens.Table;
        if (table.align.some((value) => value !== null)) reasons.add('table column alignment');
        for (const cell of [...table.header, ...table.rows.flat()]) walkInline(cell.tokens, reasons);
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Decide whether a document can be edited in the rich editor without silently
 * losing content. Documents that fail open in Markdown mode instead.
 */
export function analyzeMarkdown(text: string): MarkdownFidelity {
  const reasons = new Set<string>();
  const tokens = new Lexer({ gfm: true, breaks: false }).lex(text);
  walkBlocks(tokens, reasons);
  if (tokens.links && Object.keys(tokens.links).length) reasons.add(describe('def'));
  if (/\r/.test(text)) reasons.add('Windows line endings');
  return { lossless: reasons.size === 0, reasons: [...reasons] };
}

/** Headless conversion helpers, shared by tests and non-visual code paths. */
export function withHeadlessEditor<T>(markdown: string, run: (editor: Editor) => T): T {
  const element = document.createElement('div');
  const editor = new Editor({
    element,
    extensions: editorExtensions(),
    content: markdown,
    contentType: 'markdown',
  });
  try {
    return run(editor);
  } finally {
    editor.destroy();
  }
}

export function roundTrip(markdown: string): string {
  return withHeadlessEditor(markdown, (editor) => editor.getMarkdown());
}

export function markdownToJson(markdown: string): JSONContent {
  return withHeadlessEditor(markdown, (editor) => editor.getJSON());
}
