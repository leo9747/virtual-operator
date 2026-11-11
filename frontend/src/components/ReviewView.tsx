import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api';
import type { Draft, DraftKind, JsonRecord } from '../types';
import { DraftInspector } from './DraftInspector';
import { Icon } from './Icon';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from './Ui';

function normalizeDraft(value: JsonRecord): Draft {
  return {
    ...value,
    id: String(value.id ?? value.draft_id ?? ''),
    kind: String(value.kind ?? 'email') as DraftKind,
    title: String(value.title ?? 'Untitled draft'),
    context: String(value.context ?? ''),
    status: String(value.status ?? 'pending_review'),
    version: (value.version as string | number | undefined) ?? '—',
    payload: value.payload && typeof value.payload === 'object' ? value.payload as Record<string, unknown> : {},
  };
}

function listFrom(value: unknown): Draft[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? (value as JsonRecord).drafts ?? (value as JsonRecord).items ?? []
      : [];
  return Array.isArray(list) ? list.filter((item): item is JsonRecord => !!item && typeof item === 'object').map(normalizeDraft) : [];
}

function detailFrom(value: unknown): Draft {
  const record = value && typeof value === 'object' ? value as JsonRecord : {};
  const draft = record.draft && typeof record.draft === 'object' ? record.draft as JsonRecord : record;
  return normalizeDraft(draft);
}

export function ReviewView() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<Draft | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRetry, setDetailRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    apiFetch<unknown>('/drafts', { signal: controller.signal })
      .then((response) => {
        const next = listFrom(response);
        setDrafts(next);
        if (next.length && window.matchMedia('(min-width: 921px)').matches) {
          setSelectedId((current) => current || next[0].id);
        }
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Could not load drafts.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError('');
    setSelected(null);
    apiFetch<unknown>(`/drafts/${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then((response) => setSelected(detailFrom(response)))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setDetailError(reason instanceof Error ? reason.message : 'Could not load this draft.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId, detailRetry]);

  const filtered = useMemo(() => drafts.filter((draft) => {
    if (!showAll && /acknowledged|rejected|sent|published|completed/i.test(draft.status)) return false;
    return `${draft.title} ${draft.kind} ${draft.status}`.toLowerCase().includes(query.toLowerCase());
  }), [drafts, query, showAll]);

  const handleChanged = useCallback((next: Draft) => {
    setSelected(next);
    setDrafts((current) => current.map((draft) => draft.id === next.id ? { ...draft, ...next } : draft));
  }, []);

  return (
    <div className="view review-view">
      <PageHeader
        actions={<button className="button button-secondary" onClick={() => setRetry((value) => value + 1)} type="button"><Icon name="refresh" />Refresh</button>}
        description="Inspect, edit, and decide. Nothing leaves this workspace from a review action."
        eyebrow="Operations / Review"
        title="Review queue"
      />
      <div className={`review-layout ${selectedId ? 'has-mobile-detail' : ''}`}>
        <section aria-label="Draft queue" className="queue-panel">
          <div className="queue-tools">
            <div className="queue-heading"><h2>Drafts</h2><span>{loading ? 'Loading' : `${filtered.length} shown`}</span></div>
            <label className="search-field">
              <span className="sr-only">Search drafts</span>
              <input onChange={(event) => setQuery(event.target.value)} placeholder="Filter by title, kind, or status" type="search" value={query} />
            </label>
            <div aria-label="Draft status filter" className="segmented-control" role="group">
              <button aria-pressed={!showAll} onClick={() => setShowAll(false)} type="button">Open</button>
              <button aria-pressed={showAll} onClick={() => setShowAll(true)} type="button">All</button>
            </div>
          </div>
          <div className="queue-list">
            {loading && <LoadingState label="Loading the review queue" />}
            {!loading && error && <ErrorState message={error} onRetry={() => setRetry((value) => value + 1)} title="The queue is unavailable" />}
            {!loading && !error && drafts.length === 0 && (
              <EmptyState title="No drafts yet">
                <p>When the agent or Compose creates a draft, it will wait here for your review.</p>
                <a className="button button-primary" href="#compose">Compose a draft</a>
              </EmptyState>
            )}
            {!loading && !error && drafts.length > 0 && filtered.length === 0 && (
              <EmptyState title="No matching drafts"><p>Change the filter or switch to All to include completed reviews.</p></EmptyState>
            )}
            {!loading && !error && filtered.map((draft) => (
              <button
                aria-label={`Open ${draft.title}, ${draft.kind}, ${draft.status}`}
                aria-pressed={selectedId === draft.id}
                className={`draft-row ${selectedId === draft.id ? 'draft-row-selected' : ''}`}
                key={draft.id}
                onClick={() => setSelectedId(draft.id)}
                type="button"
              >
                <span className="draft-row-top"><span className="kind-label">{draft.kind}</span><StatusBadge status={draft.status} /></span>
                <strong>{draft.title}</strong>
                <span className="draft-row-bottom"><span>v{draft.version}</span><span className="row-open">Inspect <Icon name="arrow" size={14} /></span></span>
              </button>
            ))}
          </div>
          <p className="queue-footnote">Acknowledgement is a local review record—not approval to send.</p>
        </section>
        <section aria-label="Draft inspector" className="inspector-panel">
          {!selectedId && <EmptyState title="Select a draft"><p>Choose an item from the queue to inspect its contents and audit history.</p></EmptyState>}
          {selectedId && detailLoading && <LoadingState label="Loading draft details" />}
          {selectedId && !detailLoading && detailError && (
            <ErrorState message={detailError} onRetry={() => setDetailRetry((value) => value + 1)} title="Could not inspect this draft" />
          )}
          {selectedId && !detailLoading && !detailError && selected && (
            <DraftInspector draft={selected} onBack={() => setSelectedId('')} onChanged={handleChanged} />
          )}
        </section>
      </div>
    </div>
  );
}
