import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBlob, apiFetch } from '../api';
import type { SavedCatalog, SavedContent, SavedEntry, SavedStatus } from '../types';
import { Icon } from './Icon';
import { SavedDocument } from './SavedDocuments';
import { EmptyState, ErrorState, LoadingState, Notice, PageHeader } from './Ui';

const statusLabels: Record<SavedStatus, string> = {
  completed: 'Ready locally', blocked: 'Needs input', skipped: 'Skipped',
};
const filters: { value: SavedStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'completed', label: 'Ready locally' },
  { value: 'blocked', label: 'Needs input' }, { value: 'skipped', label: 'Skipped' },
];

function taskName(entry: SavedEntry) {
  return entry.title.replace(/\s*\[Priority:\s*[^\]]+\]\s*$/, '');
}

function dueLabel(entry: SavedEntry) {
  return entry.due && entry.due !== 'unscheduled' ? `Due ${entry.due}` : 'Unscheduled';
}

function focusLabel(entry: SavedEntry) {
  return !entry.priority || entry.priority.toLowerCase() === 'unrated' ? 'Unrated' : entry.priority;
}

async function triggerDownload(fileId: string) {
  const result = await apiBlob(`/saved-drafts/${encodeURIComponent(fileId)}/download`, fileId);
  const href = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = result.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function SavedDraftsView() {
  const [catalog, setCatalog] = useState<SavedCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [selectedFileChoice, setSelectedFileChoice] = useState('');
  const [content, setContent] = useState<SavedContent | null>(null);
  const [contentError, setContentError] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentAttempt, setContentAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SavedStatus | 'all'>('all');
  const [priority, setPriority] = useState('all');
  const [mobileDetail, setMobileDetail] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);

  const loadCatalog = useCallback(async (signal?: AbortSignal) => {
    setLoadingCatalog(true);
    setCatalogError('');
    try {
      const result = await apiFetch<SavedCatalog>('/saved-drafts', { signal });
      setCatalog(result);
      setSelectedId(previous => result.items.some(item => item.id === previous)
        ? previous
        : result.items.find(item => item.priority === 'P0')?.id ?? result.items[0]?.id ?? '');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setCatalogError(error instanceof Error ? error.message : 'Saved drafts could not be loaded');
    } finally {
      if (!signal?.aborted) setLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadCatalog(controller.signal);
    return () => controller.abort();
  }, [loadCatalog]);

  const selectedEntry = catalog?.items.find(item => item.id === selectedId) ?? null;
  const selectedFileId = selectedEntry
    ? selectedEntry.files.some(file => file.id === selectedFileChoice) ? selectedFileChoice : selectedEntry.files[0].id
    : '';

  useEffect(() => {
    if (!selectedFileId) {
      setContent(null);
      setLoadingContent(false);
      return;
    }
    const controller = new AbortController();
    setContent(null);
    setContentError('');
    setLoadingContent(true);
    void apiFetch<SavedContent>(`/saved-drafts/${encodeURIComponent(selectedFileId)}/content`, { signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted) setContent(result);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!controller.signal.aborted) setContentError(error instanceof Error ? error.message : 'Document could not be read');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingContent(false);
      });
    return () => controller.abort();
  }, [selectedFileId, contentAttempt]);

  const filtered = catalog?.items.filter(item => {
    const needle = query.trim().toLowerCase();
    const haystack = `${item.title} ${item.blocker} ${item.files.map(file => file.name).join(' ')}`.toLowerCase();
    return (!needle || haystack.includes(needle))
      && (status === 'all' || item.status === status)
      && (priority === 'all' || focusLabel(item) === priority);
  }) ?? [];

  const openEntry = (entry: SavedEntry) => {
    setSelectedId(entry.id);
    setSelectedFileChoice('');
    setDownloadError('');
    setMobileDetail(true);
    inspectorRef.current?.scrollTo({ top: 0 });
  };

  const download = async () => {
    if (!selectedFileId || downloading) return;
    setDownloading(true);
    setDownloadError('');
    try {
      await triggerDownload(selectedFileId);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Local download failed');
    } finally {
      setDownloading(false);
    }
  };

  return <div className="view review-view saved-view">
    <PageHeader
      actions={<button className="button button-secondary" disabled={!selectedFileId || downloading}
        onClick={() => void download()} title="Download local copy" type="button">
        <Icon name="download" size={16} />{downloading ? 'Preparing…' : 'Download local copy'}
      </button>}
      description="Read the files produced for your Notion tasks. Ready locally describes the saved draft, not task completion, approval, or any external action."
      eyebrow="Local document library · Read-only" title="Saved drafts" />
    {loadingCatalog && <LoadingState label="Reading the local draft index" />}
    {!loadingCatalog && catalogError && <>
      <ErrorState message={catalogError} onRetry={() => void loadCatalog()} title="The saved-draft index is unavailable" />
      <p className="saved-config-note">VO_REVIEW_DIR must point to an owner-only directory containing INDEX.md. No files were imported or altered.</p>
    </>}
    {!loadingCatalog && catalog && !catalogError && <>
      <section aria-label="Saved draft counts" className="saved-summary">
        <div><strong>{catalog.itemCount}</strong><span>Indexed entries</span></div>
        <div><strong>{catalog.fileCount}</strong><span>Documents</span></div>
        <div><strong>{catalog.statusCounts.completed ?? 0}</strong><span>Ready locally</span></div>
        <div><strong>{catalog.statusCounts.blocked ?? 0}</strong><span>Need input</span></div>
        <span className="saved-readonly"><Icon name="lock" size={14} />Files are read only</span>
      </section>
      <div className={`review-layout saved-layout ${mobileDetail ? 'has-mobile-detail' : ''}`}>
        <section aria-label="Saved draft list" className="queue-panel saved-queue">
          <div className="queue-tools">
            <div className="queue-heading"><h2>Draft library</h2><span>{filtered.length} shown</span></div>
            <label className="search-field"><span className="sr-only">Search saved drafts</span>
              <input aria-label="Search saved drafts" onChange={event => setQuery(event.target.value)}
                placeholder="Search title, filename or open question…" ref={searchRef} type="search" value={query} />
            </label>
            <div aria-label="Filter saved drafts by status" className="saved-filters" role="group">
              {filters.map(filter => <button aria-pressed={status === filter.value}
                className={status === filter.value ? 'saved-filter active' : 'saved-filter'}
                key={filter.value} onClick={() => setStatus(filter.value)} type="button">{filter.label}</button>)}
            </div>
            <label className="saved-priority"><span>Priority focus</span>
              <select aria-label="Priority focus" onChange={event => setPriority(event.target.value)} value={priority}>
                <option value="all">All priorities</option>
                {['P0', 'P1', 'P2', 'P3', 'Unrated'].map(value => <option key={value} value={value}>{value === 'Unrated' ? value : `${value} only`}</option>)}
              </select>
            </label>
          </div>
          <div className="queue-list saved-list">
            {filtered.map(entry => <button aria-current={entry.id === selectedId ? 'true' : undefined}
              aria-label={`Open ${taskName(entry)}, ${statusLabels[entry.status]}`}
              className={`draft-row saved-row ${entry.id === selectedId ? 'draft-row-selected' : ''}`}
              key={entry.id} onClick={() => openEntry(entry)} type="button">
              <span className="saved-row-meta"><span className={`saved-priority-mark priority-${focusLabel(entry).toLowerCase()}`}>{entry.priority ?? 'Unrated'}</span>
                <span className={`status-badge ${entry.status === 'completed' ? 'status-success' : ''}`}>{statusLabels[entry.status]}</span></span>
              <strong>{taskName(entry)}</strong>
              <span className="saved-row-bottom">{dueLabel(entry)}<span>{entry.files.length === 1 ? entry.files[0].name.endsWith('.xlsx') ? 'XLSX' : entry.files[0].kind.toUpperCase() : `${entry.files.length} files`}</span></span>
            </button>)}
            {!filtered.length && <EmptyState title="No saved drafts match"><p>Try another search, status, or priority focus.</p></EmptyState>}
          </div>
          <p className="queue-footnote">Source status is preserved from INDEX.md. Selecting a file only reads it; it never marks the Notion task complete.</p>
        </section>
        <section aria-label="Document preview" className="inspector-panel saved-inspector" ref={inspectorRef}>
          {!selectedEntry && <EmptyState title="Choose a saved draft"><p>Select an entry to read its local document.</p></EmptyState>}
          {selectedEntry && <>
            <div className="inspector-topbar">
              <button aria-label="Back to saved drafts" className="button button-quiet button-small mobile-back saved-mobile-back"
                onClick={() => { setMobileDetail(false); requestAnimationFrame(() => searchRef.current?.focus()); }} type="button">
                <Icon name="back" size={17} />Saved drafts
              </button>
              <div className="saved-inspector-status"><span className="kind-label">{selectedEntry.status === 'blocked' ? 'Input needed' : 'Local draft'}</span>
                <span className="saved-file-kind">{selectedEntry.files.find(file => file.id === selectedFileId)?.kind ?? 'File'}</span></div>
              {selectedEntry.sourceUrl && <a className="button button-quiet button-small saved-source-link"
                href={selectedEntry.sourceUrl} rel="noopener noreferrer" target="_blank">Source task<Icon name="arrow" size={15} /></a>}
            </div>
            <header className="saved-document-heading">
              <p className="eyebrow">{focusLabel(selectedEntry)}{selectedEntry.due && selectedEntry.due !== 'unscheduled' ? ` · Due ${selectedEntry.due}` : ' · Unscheduled'}</p>
              <h2>{taskName(selectedEntry)}</h2>
              <p className="saved-file-name">{selectedFileId}</p>
              {selectedEntry.files.length > 1 && <label className="form-field saved-document-select"><span>Document within entry</span>
                <select aria-label="Document within entry" onChange={event => { setSelectedFileChoice(event.target.value); setDownloadError(''); }} value={selectedFileId}>
                  {selectedEntry.files.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}
                </select>
              </label>}
              <div className="saved-blocker"><strong>Blocker / open question</strong><p>{selectedEntry.blocker}</p></div>
              {!selectedEntry.sourceUrl && <p className="saved-source-note">No external source link is attached to this index entry.</p>}
            </header>
            {downloadError && <div className="saved-file-error"><Notice tone="error">{downloadError}</Notice></div>}
            <div className="artifact-body">
              {loadingContent && <LoadingState label="Reading local document" />}
              {!loadingContent && contentError && <ErrorState message={contentError} onRetry={() => setContentAttempt(value => value + 1)} title="This document could not be previewed" />}
              {!loadingContent && content && content.id === selectedFileId && <SavedDocument content={content} />}
            </div>
          </>}
        </section>
      </div>
    </>}
  </div>;
}
