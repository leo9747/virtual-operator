import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api';
import {
  dayGroup, documentItem, documentStatusLabels, draftItem, filterItems, relativeTime, sortItems, type InboxFilter,
} from '../inbox';
import type { Draft, InboxItem, SavedCatalog } from '../types';
import { DocumentReader } from './DocumentReader';
import { DraftReader } from './DraftReader';
import { Icon, type IconName } from './Icon';
import { EmptyState, ErrorState, LoadingState, Notice, StatusBadge } from './Ui';

type Source<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; message: string };

const filters: { id: InboxFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'message', label: 'Messages' },
  { id: 'document', label: 'Documents' },
  { id: 'update', label: 'Updates' },
];

function itemIcon(item: InboxItem): IconName {
  if (item.source === 'document') return 'file';
  switch (item.draft.kind) {
    case 'email': return 'mail';
    case 'slack':
    case 'whatsapp': return 'chat';
    case 'spreadsheet': return 'table';
    default: return 'update';
  }
}

function ItemStatus({ item }: { item: InboxItem }) {
  if (item.source === 'document') {
    if (item.entry.status === 'completed') return null;
    return <span className={`status-badge status-${item.entry.status === 'blocked' ? 'warning' : 'neutral'}`}>{documentStatusLabels[item.entry.status]}</span>;
  }
  return item.draft.status === 'draft' ? null : <StatusBadge status={item.draft.status} />;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function InboxView({ onCompose, onDirtyChange: reportDirty }: {
  onCompose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<Source<Draft[]>>({ state: 'loading' });
  const [documents, setDocuments] = useState<Source<SavedCatalog>>({ state: 'loading' });
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [showClosed, setShowClosed] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<InboxItem | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const dirty = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    const [draftResult, documentResult] = await Promise.allSettled([
      apiFetch<Draft[] | { drafts?: Draft[]; items?: Draft[] }>('/drafts', { signal }),
      apiFetch<SavedCatalog>('/saved-drafts', { signal }),
    ]);
    if (signal?.aborted) return;
    if (draftResult.status === 'fulfilled') {
      const value = draftResult.value;
      setDrafts({ state: 'ready', value: Array.isArray(value) ? value : value?.drafts ?? value?.items ?? [] });
    } else {
      setDrafts({ state: 'error', message: errorText(draftResult.reason, 'Could not load queued drafts.') });
    }
    if (documentResult.status === 'fulfilled') setDocuments({ state: 'ready', value: documentResult.value });
    else setDocuments({ state: 'error', message: errorText(documentResult.reason, 'Could not load saved documents.') });
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const items = useMemo(() => sortItems([
    ...(drafts.state === 'ready' ? drafts.value.map(draftItem) : []),
    ...(documents.state === 'ready' ? documents.value.items.map(documentItem) : []),
  ]), [drafts, documents]);

  const selectedKey = selected?.key;
  const visible = useMemo(() => filterItems(items, filter, showClosed, query, selectedKey), [items, filter, showClosed, query, selectedKey]);
  const openCounts = useMemo(() => {
    const counts: Record<InboxFilter, number> = { all: 0, message: 0, document: 0, update: 0 };
    for (const item of items) {
      if (!item.open) continue;
      counts.all += 1;
      counts[item.group] += 1;
    }
    return counts;
  }, [items]);

  // Select the newest visible item on first load (desktop reading pane), but never
  // swap the open reader underneath the user when the list refreshes.
  useEffect(() => {
    if (!selected && visible.length && window.matchMedia('(min-width: 921px)').matches) setSelected(visible[0]);
  }, [selected, visible]);

  const confirmLeave = () => !dirty.current || window.confirm('You have unsaved changes. Discard them?');

  const select = (item: InboxItem) => {
    if (item.key === selected?.key) {
      setMobileDetail(true);
      return;
    }
    if (!confirmLeave()) return;
    dirty.current = false;
    reportDirty(false);
    setSelected(item);
    setMobileDetail(true);
  };

  const onDraftChanged = (next: Draft) => {
    setDrafts((current) => current.state === 'ready'
      ? { state: 'ready', value: current.value.map((draft) => draft.id === next.id ? next : draft) }
      : current);
    setSelected((current) => current?.source === 'draft' && current.draft.id === next.id ? draftItem(next) : current);
  };

  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
    reportDirty(value);
  }, [reportDirty]);
  const back = () => {
    setMobileDetail(false);
  };

  const loading = drafts.state === 'loading' && documents.state === 'loading';
  const bothFailed = drafts.state === 'error' && documents.state === 'error';
  let lastGroup = '';

  return (
    <div className={`inbox ${mobileDetail ? 'has-mobile-detail' : ''}`}>
      <section aria-labelledby="inbox-heading" className="inbox-list">
        <header className="inbox-head">
          <div className="inbox-title-row">
            <h1 id="inbox-heading">Inbox</h1>
            <span aria-label={`${openCounts.all} awaiting review`} className="count-pill">{openCounts.all}</span>
            <button aria-label="Refresh inbox" className="icon-button" disabled={refreshing} onClick={() => { if (!refreshing) void load(); }} title="Refresh" type="button">
              <span className={refreshing ? 'spin' : ''}><Icon name="refresh" /></span>
            </button>
          </div>
          <label className="search-field">
            <span className="sr-only">Search drafts</span>
            <input onChange={(event) => setQuery(event.target.value)} placeholder="Search drafts" type="search" value={query} />
          </label>
          <div aria-label="Filter by type" className="filter-chips" role="group">
            {filters.map((option) => (
              <button aria-pressed={filter === option.id} key={option.id} onClick={() => setFilter(option.id)} type="button">
                {option.label}{option.id !== 'all' && openCounts[option.id] > 0 && <span className="chip-count">{openCounts[option.id]}</span>}
              </button>
            ))}
          </div>
          <label className="toggle-row">
            <input checked={showClosed} onChange={(event) => setShowClosed(event.target.checked)} type="checkbox" />
            <span>Include reviewed and skipped</span>
          </label>
        </header>

        {drafts.state === 'error' && !bothFailed && <Notice tone="error">Queued drafts are unavailable: {drafts.message}</Notice>}
        {documents.state === 'error' && !bothFailed && <Notice>Saved documents are unavailable: {documents.message}</Notice>}

        <div className="inbox-items">
          {loading && <LoadingState label="Loading drafts" />}
          {bothFailed && <ErrorState message={drafts.message} onRetry={() => void load()} title="Could not load the inbox" />}
          {!loading && !bothFailed && visible.length === 0 && (
            <EmptyState
              action={<button className="button button-secondary" onClick={onCompose} type="button"><Icon name="compose" />Compose a draft</button>}
              title={items.length ? 'Nothing matches' : 'Nothing waiting'}
            >
              {items.length ? 'Try another filter, or include reviewed items.' : 'New drafts appear here as soon as they are created.'}
            </EmptyState>
          )}
          {visible.length > 0 && (
            <ul aria-label="Drafts" className="item-list">
              {visible.map((item) => {
                const group = dayGroup(item.time);
                const heading = group !== lastGroup ? group : null;
                lastGroup = group;
                return (
                  <li key={item.key}>
                    {heading && <h2 className="day-heading">{heading}</h2>}
                    <button
                      aria-current={selected?.key === item.key ? 'true' : undefined}
                      className={`item-row ${item.open ? '' : 'is-closed'}`}
                      onClick={() => select(item)}
                      type="button"
                    >
                      <span aria-hidden="true" className={`item-icon item-icon-${item.group}`}><Icon name={itemIcon(item)} size={17} /></span>
                      <span className="item-main">
                        <span className="item-top"><span className="item-label">{item.label}</span><time dateTime={item.time}>{relativeTime(item.time)}</time></span>
                        <strong className="item-title">{item.title}</strong>
                        {item.preview && <span className="item-preview">{item.preview}</span>}
                      </span>
                      <ItemStatus item={item} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section aria-label="Draft" className="inbox-reader">
        {selected?.source === 'draft' && (
          <DraftReader draft={selected.draft} key={selected.key} onBack={back} onChanged={onDraftChanged} onDirtyChange={onDirtyChange} />
        )}
        {selected?.source === 'document' && (
          <DocumentReader entry={selected.entry} key={selected.key} onBack={back} onDirtyChange={onDirtyChange} />
        )}
        {!selected && !loading && (
          <div className="reader-empty">
            <Icon name="inbox" size={28} />
            <p>Select a draft to read and edit it.</p>
          </div>
        )}
      </section>
    </div>
  );
}
