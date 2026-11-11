import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ApiError, apiFetch, downloadFile } from '../api';
import { copyToClipboard } from '../clipboard';
import { absoluteTime, documentStatusLabels, priorityLabel, relativeTime, taskName } from '../inbox';
import { isSafeHref } from '../markdown';
import type { DocumentVersions, SavedContent, SavedEntry, SavedFile } from '../types';
import { DetailRows, DetailSection, DetailsDrawer, Hash } from './DetailsDrawer';
import { Icon } from './Icon';
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor';
import { TabularData, WorkbookDocument } from './SavedDocuments';
import { ErrorState, LoadingState, Notice } from './Ui';

type Feedback = { tone: 'success' | 'error' | 'neutral'; text: string } | null;
type Conflict = { code: 'version_conflict'; latestVersion: number } | { code: 'original_changed'; originalSha256: string } | null;

type Loaded =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; content: SavedContent; versions: DocumentVersions | null };

function filePath(file: Pick<SavedFile, 'id'>, suffix = ''): string {
  return `/saved-drafts/${encodeURIComponent(file.id)}${suffix}`;
}

function bytes(value: number): string {
  return value < 1024 ? `${value} B` : value < 1_048_576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1_048_576).toFixed(1)} MB`;
}

function conflictFrom(error: unknown): Conflict {
  if (!(error instanceof ApiError) || error.status !== 409 || !error.detail || typeof error.detail !== 'object') return null;
  const detail = error.detail as Record<string, unknown>;
  if (detail.code === 'version_conflict' && typeof detail.latestVersion === 'number') return { code: 'version_conflict', latestVersion: detail.latestVersion };
  if (detail.code === 'original_changed' && typeof detail.originalSha256 === 'string') return { code: 'original_changed', originalSha256: detail.originalSha256 };
  return null;
}

export function DocumentReader({ entry, onDirtyChange, onBack }: {
  entry: SavedEntry;
  onDirtyChange: (dirty: boolean) => void;
  onBack: () => void;
}) {
  const [fileId, setFileId] = useState(entry.files[0]?.id ?? '');
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [reload, setReload] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'copy' | 'download'>('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [conflict, setConflict] = useState<Conflict>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [showing, setShowing] = useState<'edited' | 'original'>('edited');
  const editor = useRef<MarkdownEditorHandle>(null);
  const file = entry.files.find((item) => item.id === fileId) ?? entry.files[0];

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  // Keyed on the file id, not the entry object: refreshing the inbox list must never
  // reload (and silently discard) a document that is being edited.
  const currentFileId = file?.id;
  const currentKind = file?.kind;
  useEffect(() => {
    if (!currentFileId || !currentKind) return;
    const target = { id: currentFileId, name: currentFileId, kind: currentKind };
    const controller = new AbortController();
    setLoaded({ state: 'loading' });
    setDirty(false);
    setConflict(null);
    setShowing('edited');
    Promise.all([
      apiFetch<SavedContent>(filePath(target, '/content'), { signal: controller.signal }),
      target.kind === 'markdown'
        ? apiFetch<DocumentVersions>(filePath(target, '/versions'), { signal: controller.signal })
        : Promise.resolve(null),
    ]).then(([content, versions]) => setLoaded({ state: 'ready', content, versions }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoaded({ state: 'error', message: error instanceof Error ? error.message : 'Could not load this document.' });
      });
    return () => controller.abort();
  }, [currentFileId, currentKind, reload]);

  const confirmDiscard = useCallback(() => !dirty || window.confirm('Discard your unsaved changes to this document?'), [dirty]);

  const selectFile = (next: string) => {
    if (next === fileId || !confirmDiscard()) return;
    setFeedback(null);
    setFileId(next);
  };

  const ready = loaded.state === 'ready' ? loaded : null;
  const markdown = ready && ready.content.kind === 'markdown' ? ready.content : null;
  const versions = ready?.versions ?? null;
  const latest = versions?.latest ?? null;
  const editedText = latest?.text ?? markdown?.text ?? '';

  /** Versions are append-only, so "save anyway" never destroys another window's or the agent's text. */
  const save = async ({ originalSha256, baseVersion }: { originalSha256?: string; baseVersion?: number } = {}) => {
    const override = originalSha256 !== undefined || baseVersion !== undefined;
    if (!markdown || !versions || !file || busy || (!dirty && !override)) return;
    if (!originalSha256 && versions.originalChanged && !window.confirm(
      'The original document changed after your last edited version. Save your edit anyway? The new original stays available under Original.',
    )) return;
    setBusy('save');
    setFeedback(null);
    setConflict(null);
    const text = editor.current?.getMarkdown() ?? editedText;
    try {
      const saved = await apiFetch<{ version: number }>(filePath(file, '/versions'), {
        method: 'POST',
        body: JSON.stringify({ text, base_version: baseVersion ?? latest?.version ?? 0, original_sha256: originalSha256 ?? markdown.sha256 }),
      });
      const refreshed = await apiFetch<DocumentVersions>(filePath(file, '/versions'));
      const content = originalSha256
        ? await apiFetch<SavedContent>(filePath(file, '/content'))
        : markdown;
      editor.current?.markSaved(text);
      setLoaded({ state: 'ready', content, versions: refreshed });
      setFeedback({ tone: 'success', text: `Saved as edited version ${saved.version}. The original file was not changed.` });
    } catch (error) {
      const next = conflictFrom(error);
      if (next) setConflict(next);
      else setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save this version.' });
    } finally {
      setBusy('');
    }
  };

  const discardAndReload = () => {
    if (!window.confirm('Reload and discard the text in the editor?')) return;
    setDirty(false);
    setFeedback(null);
    setReload((value) => value + 1);
  };

  const copy = async () => {
    setBusy('copy');
    try {
      const text = showing === 'original' ? markdown?.text ?? '' : editor.current?.getMarkdown() ?? editedText;
      const html = showing === 'original' ? '' : editor.current?.getHtml() ?? '';
      await copyToClipboard(text, html);
      setFeedback({ tone: 'neutral', text: 'Copied to the clipboard.' });
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Could not copy.' });
    } finally {
      setBusy('');
    }
  };

  const download = async (path: string, fallback: string) => {
    setBusy('download');
    try {
      await downloadFile(path, fallback);
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Could not download.' });
    } finally {
      setBusy('');
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  };

  const priority = priorityLabel(entry);
  const source = entry.sourceUrl && isSafeHref(entry.sourceUrl) ? entry.sourceUrl : null;
  const canEdit = !!markdown && !!versions && showing === 'edited';

  return (
    <article aria-labelledby="reader-title" className="reader" onKeyDown={onKeyDown}>
      <header className="reader-bar">
        <button className="button button-quiet mobile-back" onClick={onBack} type="button"><Icon name="back" />Inbox</button>
        <div className="reader-bar-meta">
          <span className="kind-chip">Document</span>
          <span className={`status-badge status-${entry.status === 'completed' ? 'success' : entry.status === 'blocked' ? 'warning' : 'neutral'}`}>{documentStatusLabels[entry.status]}</span>
          {latest && showing === 'edited' && <span className="version-chip">Edited v{latest.version}</span>}
          {dirty && <span className="dirty-dot">Unsaved changes</span>}
        </div>
        <div className="reader-actions">
          <button aria-expanded={detailsOpen} className="button button-quiet" onClick={() => setDetailsOpen((open) => !open)} type="button"><Icon name="info" />Details</button>
          {markdown && <button className="button button-quiet" disabled={!!busy} onClick={() => void copy()} type="button"><Icon name="copy" />Copy</button>}
          {file && <button className="button button-quiet" disabled={!!busy} onClick={() => void download(filePath(file, '/download'), file.name)} title="Download the original file" type="button"><Icon name="download" />Download</button>}
          {canEdit && <button className="button button-secondary" disabled={!!busy || !dirty} onClick={() => void save()} title="Save as a new edited version (Ctrl+S)" type="button">{busy === 'save' ? 'Saving…' : 'Save version'}</button>}
        </div>
      </header>

      <div className="reader-scroll">
        <div className="paper">
          <p className="paper-meta">{[`Updated ${relativeTime(entry.modifiedAt)}`, priority, entry.due ? `Due ${entry.due}` : null].filter(Boolean).join(' · ')}</p>
          <h2 className="paper-title" id="reader-title">{taskName(entry)}</h2>
          {entry.status === 'blocked' && entry.blocker && <Notice><strong>Needs your input:</strong> {entry.blocker}</Notice>}
          {entry.status === 'skipped' && <Notice><strong>Skipped.</strong> {entry.blocker || 'No draft was produced for this task.'}</Notice>}

          {entry.files.length > 1 && (
            <div aria-label="Files" className="sheet-tabs" role="tablist">
              {entry.files.map((item) => (
                <button aria-selected={item.id === file?.id} key={item.id} onClick={() => selectFile(item.id)} role="tab" type="button">
                  <Icon name={item.kind === 'markdown' ? 'file' : 'table'} size={15} />{item.name}
                </button>
              ))}
            </div>
          )}

          {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
          {conflict?.code === 'version_conflict' && (
            <Notice tone="error">
              <div className="conflict"><span>Edited version {conflict.latestVersion} was saved in another window. Your text is still in the editor.</span>
                <span className="inline-actions">
                  <button className="button button-secondary button-small" onClick={() => void save({ baseVersion: conflict.latestVersion })} type="button">Save mine as version {conflict.latestVersion + 1}</button>
                  <button className="button button-quiet button-small" onClick={discardAndReload} type="button">Load newest version</button>
                </span></div>
            </Notice>
          )}
          {conflict?.code === 'original_changed' && (
            <Notice tone="error">
              <div className="conflict"><span>The original document changed after you opened it.</span>
                <span className="inline-actions">
                  <button className="button button-secondary button-small" onClick={() => void save({ originalSha256: conflict.originalSha256 })} type="button">Save my version anyway</button>
                  <button className="button button-quiet button-small" onClick={discardAndReload} type="button">Reload</button>
                </span></div>
            </Notice>
          )}

          {loaded.state === 'loading' && <LoadingState label="Opening document" />}
          {loaded.state === 'error' && <ErrorState message={loaded.message} onRetry={() => setReload((value) => value + 1)} title="Could not open this document" />}

          {markdown && versions && (
            <>
              {(latest || versions.originalChanged) && (
                <div className="version-bar">
                  <div aria-label="Show version" className="segmented-control" role="group">
                    <button aria-pressed={showing === 'edited'} onClick={() => setShowing('edited')} type="button">{latest ? `Edited copy · v${latest.version}` : 'Edited copy'}</button>
                    <button aria-pressed={showing === 'original'} disabled={dirty} onClick={() => setShowing('original')} title={dirty ? 'Save or undo your changes first' : undefined} type="button">Original</button>
                  </div>
                  {versions.originalChanged && <span className="version-warning"><Icon name="alert" size={15} />The original was updated after your last edit.</span>}
                  {showing === 'edited' && latest && (
                    <button className="button button-quiet button-small" onClick={() => editor.current?.replace(markdown.text)} type="button"><Icon name="history" size={15} />Start again from original</button>
                  )}
                </div>
              )}
              {showing === 'edited' ? (
                <MarkdownEditor
                  editable
                  initialMarkdown={editedText}
                  key={`${file?.id}:${reload}`}
                  label={`Edit ${file?.name ?? 'document'}`}
                  onDirtyChange={setDirty}
                  placeholder="Start writing…"
                  ref={editor}
                />
              ) : (
                <MarkdownEditor editable={false} initialMarkdown={markdown.text} key={`original:${markdown.sha256}`} label={`Original ${markdown.name}`} />
              )}
            </>
          )}
          {ready?.content.kind === 'csv' && (
            <>
              <TabularData caption={ready.content.name} headers={ready.content.headers} rows={ready.content.rows} />
              {ready.content.hasMoreRows && <p className="inline-empty">Showing the first 200 of {ready.content.rowCount} rows. Download the file for the rest.</p>}
            </>
          )}
          {ready?.content.kind === 'xlsx' && <WorkbookDocument content={ready.content} />}
        </div>
      </div>

      <DetailsDrawer onClose={() => setDetailsOpen(false)} open={detailsOpen} title={taskName(entry)}>
        <DetailSection title="Task">
          <DetailRows rows={[
            ['Status', documentStatusLabels[entry.status]],
            ['Priority', priority ?? 'Unrated'],
            ['Due', entry.due ?? 'None'],
            ['Last written', absoluteTime(entry.modifiedAt)],
            ['Source task', source ? <a className="artifact-link" href={source} key="s" rel="noopener noreferrer nofollow" target="_blank">Open source task<Icon name="external" size={14} /></a> : 'Not linked'],
            ['Open question', entry.blocker || 'None'],
          ]} />
        </DetailSection>
        {file && (
          <DetailSection title="Original file">
            <DetailRows rows={[
              ['File', <code key="f">{file.name}</code>],
              ['Type', file.kind.toUpperCase()],
              ...(markdown ? [['SHA-256', <Hash key="h" value={markdown.sha256} />] as [string, ReactNode]] : []),
              ['Writes', 'Never modified by this app'],
            ]} />
            <button className="button button-quiet button-small" disabled={!!busy} onClick={() => void download(filePath(file, '/download'), file.name)} type="button"><Icon name="download" size={15} />Download original</button>
          </DetailSection>
        )}
        {versions && (
          <DetailSection title="Edited versions">
            {versions.versions.length === 0 ? <p className="inline-empty">No edits saved yet. Saving creates version 1; the original stays untouched.</p> : (
              <ol className="version-list">
                {[...versions.versions].reverse().map((version) => (
                  <li key={version.version}>
                    <div>
                      <strong>Version {version.version}{version.version === latest?.version ? ' · latest' : ''}</strong>
                      <small>{absoluteTime(version.createdAt)} · {bytes(version.bytes)}</small>
                      <Hash value={version.sha256} />
                      {version.originalSha256 !== versions.originalSha256 && <small className="version-warning">Based on an earlier original</small>}
                    </div>
                    <button
                      aria-label={`Download version ${version.version}`}
                      className="icon-button"
                      disabled={!!busy || !file}
                      onClick={() => file && void download(filePath(file, `/versions/${version.version}/download`), `${file.name.replace(/\.md$/i, '')}.edited-v${version.version}.md`)}
                      title="Download"
                      type="button"
                    ><Icon name="download" size={16} /></button>
                  </li>
                ))}
              </ol>
            )}
          </DetailSection>
        )}
      </DetailsDrawer>
    </article>
  );
}
