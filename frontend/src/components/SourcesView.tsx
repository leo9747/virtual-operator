import { useState } from 'react';
import { apiFetch } from '../api';
import type { Account, JsonRecord } from '../types';
import { EmptyState, ErrorState, LoadingState, PageHeader } from './Ui';
import { Icon } from './Icon';
import { StructuredData } from './StructuredData';

type Source = 'gmail' | 'airtable';

function messagesFrom(value: unknown): JsonRecord[] {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
  const list = Array.isArray(value) ? value : body?.messages ?? body?.items ?? [];
  return Array.isArray(list) ? list.filter((item): item is JsonRecord => !!item && typeof item === 'object') : [];
}

export function SourcesView() {
  const [source, setSource] = useState<Source>('gmail');
  const [account, setAccount] = useState<Account>('personal');
  const [messages, setMessages] = useState<JsonRecord[] | null>(null);
  const [airtable, setAirtable] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      if (source === 'gmail') {
        const response = await apiFetch<unknown>(`/context/gmail?account=${account}&limit=5`);
        setMessages(messagesFrom(response));
      } else {
        setAirtable(await apiFetch<unknown>('/context/airtable'));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load this source.');
    } finally {
      setLoading(false);
    }
  };

  const switchSource = (next: Source) => {
    setSource(next);
    setError('');
  };

  const hasLoaded = source === 'gmail' ? messages !== null : airtable !== null;

  return (
    <div className="view sources-view">
      <PageHeader description="Load explicitly requested, read-only context from your configured sources." eyebrow="Workspace / Sources" title="Source context" />
      <div className="source-layout">
        <nav aria-label="Context sources" className="source-navigation">
          <p className="eyebrow">Available sources</p>
          <button aria-pressed={source === 'gmail'} className={source === 'gmail' ? 'selected' : ''} onClick={() => switchSource('gmail')} type="button"><span><strong>Gmail</strong><small>Recent message metadata</small></span><Icon name="arrow" /></button>
          <button aria-pressed={source === 'airtable'} className={source === 'airtable' ? 'selected' : ''} onClick={() => switchSource('airtable')} type="button"><span><strong>Airtable</strong><small>Connections and schema</small></span><Icon name="arrow" /></button>
          <p className="source-privacy"><Icon name="lock" size={15} />Context is fetched only when you select Load this source.</p>
        </nav>
        <section className="source-content" aria-live="polite">
          <div className="source-toolbar">
            <div><p className="eyebrow">Read-only context</p><h2>{source === 'gmail' ? 'Gmail messages' : 'Airtable schema'}</h2><p>{source === 'gmail' ? 'Up to five messages from the selected account.' : 'Sanitized connection and schema summaries as returned by the API.'}</p></div>
            <div className="source-controls">
              {source === 'gmail' && <label className="compact-field"><span>Account</span><select disabled={loading} onChange={(event) => { setAccount(event.target.value as Account); setMessages(null); setError(''); }} value={account}><option value="personal">Personal</option><option value="cisai">CISAI</option></select></label>}
              <button className="button button-primary" disabled={loading} onClick={() => void load()} type="button"><Icon name="refresh" />{loading ? 'Loading…' : hasLoaded ? 'Reload' : 'Load this source'}</button>
            </div>
          </div>
          {loading && <LoadingState label={`Loading ${source === 'gmail' ? `${account} Gmail context` : 'Airtable context'}`} />}
          {!loading && error && <ErrorState message={error} onRetry={() => void load()} title={`Could not load ${source === 'gmail' ? 'Gmail' : 'Airtable'} context`} />}
          {!loading && !error && !hasLoaded && <EmptyState title="No source data loaded"><p>Select Load this source to request real context from the API. No cached or sample records are shown here.</p></EmptyState>}
          {!loading && !error && source === 'gmail' && messages && (
            messages.length === 0 ? <EmptyState title="No messages returned"><p>The API returned no messages for {account}. This may be an empty inbox or unavailable source context.</p></EmptyState> : (
              <div className="message-list">
                <div className="result-caption"><span>{messages.length} messages returned</span><span>Account: {account}</span></div>
                {messages.map((message, index) => (
                  <article className="message-record" key={String(message.id ?? message.message_id ?? index)}>
                    <header><h3>{String(message.subject ?? '(No subject returned)')}</h3><time>{String(message.date ?? message.received_at ?? message.internal_date ?? '')}</time></header>
                    <dl className="message-metadata"><div><dt>From</dt><dd>{String(message.from ?? message.sender ?? 'Not provided')}</dd></div>{(message.to || message.recipient) ? <div><dt>To</dt><dd>{String(message.to ?? message.recipient)}</dd></div> : null}<div><dt>Message ID</dt><dd><code>{String(message.id ?? message.message_id ?? 'Not provided')}</code></dd></div></dl>
                    {(message.snippet || message.preview) ? <p className="message-snippet">{String(message.snippet ?? message.preview)}</p> : null}
                  </article>
                ))}
              </div>
            )
          )}
          {!loading && !error && source === 'airtable' && airtable !== null && <div className="schema-content"><div className="result-caption"><span>Live API response</span><span>Read-only</span></div><StructuredData value={airtable} /></div>}
        </section>
      </div>
    </div>
  );
}
