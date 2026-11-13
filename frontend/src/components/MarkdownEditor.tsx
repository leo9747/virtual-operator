import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { analyzeMarkdown, editorExtensions, isSafeHref } from '../markdown';
import { Icon } from './Icon';
import { MarkdownDocument } from './SavedDocuments';

export interface MarkdownEditorHandle {
  /** Current content as Markdown, whichever mode is active. */
  getMarkdown(): string;
  /** Sanitised HTML for rich clipboard copies (schema-limited; unsafe links have empty hrefs). */
  getHtml(): string;
  /** Readable plain text, without Markdown markup. */
  getPlainText(): string;
  /** Treat the current content as saved. */
  markSaved(savedText?: string): void;
  /** Replace the content (for example, revert to the original); counts as an edit. */
  replace(markdown: string): void;
}

type Mode = 'rich' | 'markdown';

function normalizeLink(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  return isSafeHref(candidate) ? candidate : null;
}

function ToolbarButton({ label, active = false, disabled = false, onClick, children }: {
  label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`tool-button ${active ? 'is-active' : ''}`}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      title={label}
      type="button"
    >{children}</button>
  );
}

function Toolbar({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'), italic: current.isActive('italic'), strike: current.isActive('strike'),
      code: current.isActive('code'), link: current.isActive('link'),
      h1: current.isActive('heading', { level: 1 }), h2: current.isActive('heading', { level: 2 }),
      h3: current.isActive('heading', { level: 3 }),
      bullet: current.isActive('bulletList'), ordered: current.isActive('orderedList'),
      task: current.isActive('taskList'), quote: current.isActive('blockquote'), codeBlock: current.isActive('codeBlock'),
      canUndo: current.can().undo(), canRedo: current.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  return (
    <div aria-label="Formatting" className="editor-toolbar" role="toolbar">
      <div className="tool-group">
        <ToolbarButton active={state.bold} label="Bold" onClick={() => chain().toggleBold().run()}><b>B</b></ToolbarButton>
        <ToolbarButton active={state.italic} label="Italic" onClick={() => chain().toggleItalic().run()}><i>I</i></ToolbarButton>
        <ToolbarButton active={state.strike} label="Strikethrough" onClick={() => chain().toggleStrike().run()}><s>S</s></ToolbarButton>
        <ToolbarButton active={state.code} label="Inline code" onClick={() => chain().toggleCode().run()}><code>{'</>'}</code></ToolbarButton>
        <ToolbarButton active={state.link} label="Link" onClick={onLink}><Icon name="link" size={16} /></ToolbarButton>
      </div>
      <div className="tool-group">
        <ToolbarButton active={state.h1} label="Heading 1" onClick={() => chain().toggleHeading({ level: 1 }).run()}>H1</ToolbarButton>
        <ToolbarButton active={state.h2} label="Heading 2" onClick={() => chain().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
        <ToolbarButton active={state.h3} label="Heading 3" onClick={() => chain().toggleHeading({ level: 3 }).run()}>H3</ToolbarButton>
      </div>
      <div className="tool-group">
        <ToolbarButton active={state.bullet} label="Bulleted list" onClick={() => chain().toggleBulletList().run()}><Icon name="list" size={17} /></ToolbarButton>
        <ToolbarButton active={state.ordered} label="Numbered list" onClick={() => chain().toggleOrderedList().run()}><Icon name="numbered" size={17} /></ToolbarButton>
        <ToolbarButton active={state.task} label="Checklist" onClick={() => chain().toggleTaskList().run()}><Icon name="checklist" size={17} /></ToolbarButton>
        <ToolbarButton active={state.quote} label="Quote" onClick={() => chain().toggleBlockquote().run()}><Icon name="quote" size={17} /></ToolbarButton>
        <ToolbarButton active={state.codeBlock} label="Code block" onClick={() => chain().toggleCodeBlock().run()}><Icon name="codeblock" size={17} /></ToolbarButton>
        <ToolbarButton label="Divider" onClick={() => chain().setHorizontalRule().run()}><Icon name="divider" size={17} /></ToolbarButton>
      </div>
      <div className="tool-group">
        <ToolbarButton disabled={!state.canUndo} label="Undo" onClick={() => chain().undo().run()}><Icon name="undo" size={17} /></ToolbarButton>
        <ToolbarButton disabled={!state.canRedo} label="Redo" onClick={() => chain().redo().run()}><Icon name="redo" size={17} /></ToolbarButton>
      </div>
    </div>
  );
}

/**
 * Rich Markdown editor with a lossless fallback. Documents containing Markdown the
 * rich schema cannot represent (raw HTML, images, link definitions…) open in Markdown
 * mode so nothing is silently dropped. Remount with a new `key` for a new document.
 */
export function MarkdownEditor({ initialMarkdown, editable, label, placeholder = '', variant = 'document', onDirtyChange, ref }: {
  initialMarkdown: string;
  editable: boolean;
  label: string;
  placeholder?: string;
  variant?: 'document' | 'message';
  onDirtyChange?: (dirty: boolean) => void;
  ref?: Ref<MarkdownEditorHandle>;
}) {
  const fidelity = useMemo(() => analyzeMarkdown(initialMarkdown), [initialMarkdown]);
  const [mode, setMode] = useState<Mode>(fidelity.lossless ? 'rich' : 'markdown');
  // Documents that cannot be shown as rich text open on a readable preview first.
  const [markdownTab, setMarkdownTab] = useState<'write' | 'preview'>('preview');
  const [source, setSource] = useState(initialMarkdown);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState('');
  const [modeNotice, setModeNotice] = useState(fidelity.lossless ? '' : fidelity.reasons.join(', '));
  const baselines = useRef<Set<string>>(new Set([initialMarkdown]));
  const dirtyRef = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  const editorRef = useRef<Editor | null>(null);

  // These read only refs, so the editor's creation-time callbacks never go stale.
  // Keep the document's own end-of-file convention (files end in a newline; email bodies usually do not).
  const trailingNewline = useRef(initialMarkdown.endsWith('\n'));
  const currentMarkdown = useCallback((): string => {
    if (modeRef.current === 'markdown' || !editorRef.current) return sourceRef.current;
    const markdown = editorRef.current.getMarkdown().replace(/\n+$/, '');
    return trailingNewline.current && markdown ? `${markdown}\n` : markdown;
  }, []);

  const reportDirty = useCallback((dirty: boolean) => {
    if (dirtyRef.current === dirty) return;
    dirtyRef.current = dirty;
    onDirtyRef.current?.(dirty);
  }, []);

  const scheduleDirtyCheck = useCallback(() => {
    window.clearTimeout(timer.current);
    // Mark dirty immediately; confirm against the saved baselines once typing pauses,
    // so undoing back to the saved text clears the flag again.
    reportDirty(true);
    timer.current = window.setTimeout(() => {
      if (editorRef.current?.isDestroyed) return;
      reportDirty(!baselines.current.has(currentMarkdown()));
    }, 180);
  }, [currentMarkdown, reportDirty]);

  const editor = useEditor({
    extensions: editorExtensions(placeholder),
    content: fidelity.lossless ? initialMarkdown : '',
    contentType: 'markdown',
    editable,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        'aria-label': label,
        'aria-multiline': 'true',
        role: 'textbox',
        class: `rich-surface rich-surface-${variant}`,
        spellcheck: 'true',
      },
    },
    onCreate: ({ editor: created }) => {
      editorRef.current = created;
      if (fidelity.lossless) baselines.current.add(currentMarkdown());
    },
    // Only user edits count; programmatic or read-only transitions never mark the draft dirty.
    onUpdate: ({ editor: updated }) => { if (updated.isEditable) scheduleDirtyCheck(); },
  }, []);
  editorRef.current = editor;

  useEffect(() => () => {
    window.clearTimeout(timer.current);
    // Unmounting discards this editor's state, so it must not leave the parent marked dirty.
    if (dirtyRef.current) onDirtyRef.current?.(false);
  }, []);

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);

  useImperativeHandle(ref, () => ({
    getMarkdown: currentMarkdown,
    getHtml: () => {
      if (modeRef.current === 'rich' && editor) return editor.getHTML();
      return '';
    },
    getPlainText: () => {
      if (modeRef.current === 'rich' && editor) return editor.getText({ blockSeparator: '\n\n' });
      return sourceRef.current;
    },
    // `savedText` is what was actually stored; anything typed while saving stays dirty.
    markSaved: (savedText?: string) => {
      const current = currentMarkdown();
      baselines.current = new Set([savedText ?? current]);
      window.clearTimeout(timer.current);
      reportDirty(!baselines.current.has(current));
    },
    replace: (markdown: string) => {
      const check = analyzeMarkdown(markdown);
      setSource(markdown);
      sourceRef.current = markdown;
      if (check.lossless && editor) {
        editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
        setMode('rich');
        modeRef.current = 'rich';
        setModeNotice('');
      } else {
        setMode('markdown');
        modeRef.current = 'markdown';
        setMarkdownTab('write');
        setModeNotice(check.reasons.join(', '));
      }
      reportDirty(!baselines.current.has(markdown));
    },
  }), [currentMarkdown, editor, reportDirty]);

  const switchMode = (next: Mode) => {
    if (next === mode || !editor) return;
    if (next === 'markdown') {
      const markdown = currentMarkdown();
      setSource(markdown);
      sourceRef.current = markdown;
      setMode('markdown');
      setMarkdownTab('write');
      return;
    }
    const check = analyzeMarkdown(source);
    if (!check.lossless && !window.confirm(
      `Rich text cannot represent ${check.reasons.join(', ')} in this document. Switching will drop or simplify them in the edited copy. Continue?`,
    )) return;
    editor.commands.setContent(source, { contentType: 'markdown', emitUpdate: false });
    setMode('rich');
    setModeNotice('');
    modeRef.current = 'rich';
    scheduleDirtyCheck();
  };

  const openLink = () => {
    if (!editor) return;
    setLinkValue(String(editor.getAttributes('link').href ?? ''));
    setLinkError('');
    setLinkOpen(true);
  };

  const applyLink = () => {
    if (!editor) return;
    if (!linkValue.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setLinkOpen(false);
      return;
    }
    const href = normalizeLink(linkValue);
    if (!href) {
      setLinkError('Use an http, https, or mailto address.');
      return;
    }
    const chain = editor.chain().focus().extendMarkRange('link');
    if (editor.state.selection.empty && !editor.isActive('link')) {
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      chain.setLink({ href }).run();
    }
    setLinkOpen(false);
  };

  return (
    <div className={`markdown-editor markdown-editor-${variant} ${editable ? '' : 'is-readonly'}`}>
      {editable && (
        <div className="editor-bar">
          {mode === 'rich' && editor ? <Toolbar editor={editor} onLink={openLink} /> : (
            <div aria-label="Markdown view" className="segmented-control editor-tabs" role="group">
              <button aria-pressed={markdownTab === 'write'} onClick={() => setMarkdownTab('write')} type="button">Write</button>
              <button aria-pressed={markdownTab === 'preview'} onClick={() => setMarkdownTab('preview')} type="button">Preview</button>
            </div>
          )}
          <div aria-label="Editor mode" className="segmented-control editor-mode" role="group">
            <button aria-pressed={mode === 'rich'} onClick={() => switchMode('rich')} type="button">Rich text</button>
            <button aria-pressed={mode === 'markdown'} onClick={() => switchMode('markdown')} type="button">Markdown</button>
          </div>
        </div>
      )}
      {linkOpen && mode === 'rich' && (
        <form className="link-form" onSubmit={(event) => { event.preventDefault(); applyLink(); }}>
          <label className="sr-only" htmlFor="editor-link-input">Link address</label>
          <input
            autoFocus
            id="editor-link-input"
            onChange={(event) => { setLinkValue(event.target.value); setLinkError(''); }}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setLinkOpen(false); editor?.commands.focus(); } }}
            placeholder="https://"
            type="url"
            value={linkValue}
          />
          <button className="button button-primary button-small" type="submit">{linkValue.trim() ? 'Apply' : 'Remove link'}</button>
          <button className="button button-quiet button-small" onClick={() => { setLinkOpen(false); editor?.commands.focus(); }} type="button">Cancel</button>
          {linkError && <p className="link-error" role="alert">{linkError}</p>}
        </form>
      )}
      {modeNotice && mode === 'markdown' && (
        <p className="editor-notice"><Icon name="lock" size={14} />Opened as Markdown so nothing is lost: this document contains {modeNotice}.</p>
      )}
      <div hidden={mode !== 'rich'}><EditorContent editor={editor} /></div>
      {mode === 'markdown' && (markdownTab === 'write' && editable ? (
        <textarea
          aria-label={`${label} (Markdown)`}
          className="markdown-source"
          onChange={(event) => { setSource(event.target.value); sourceRef.current = event.target.value; scheduleDirtyCheck(); }}
          spellCheck
          value={source}
        />
      ) : (
        <div className="markdown-preview"><MarkdownDocument text={source} /></div>
      ))}
    </div>
  );
}
