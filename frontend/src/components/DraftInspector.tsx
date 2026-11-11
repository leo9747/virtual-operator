import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { apiBlob, apiFetch } from '../api';
import { buildDraftUpdate } from '../draftForms';
import { parseCsv, toCsv } from '../format';
import type { Account, ChangeEntry, Draft, JsonRecord } from '../types';
import { ChangeList } from './ChangeList';
import { Icon } from './Icon';
import { Notice, StatusBadge } from './Ui';

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function changesFromPayload(value: unknown): ChangeEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is JsonRecord => !!item && typeof item === 'object').map((item) => ({
    field: text(item.field),
    before: text(item.before),
    after: text(item.after),
  }));
}

function rowsFromPayload(payload: Record<string, unknown>): string[][] {
  if (!Array.isArray(payload.sheets)) return [];
  const first = payload.sheets[0];
  if (!first || typeof first !== 'object' || !Array.isArray((first as JsonRecord).rows)) return [];
  return ((first as JsonRecord).rows as unknown[]).map((row) => Array.isArray(row) ? row.map(text) : []);
}

function updatedDraft(response: unknown, current: Draft, changes: Partial<Draft>): Draft {
  if (response && typeof response === 'object') {
    const record = response as JsonRecord;
    const candidate = record.draft && typeof record.draft === 'object'
      ? record.draft as JsonRecord
      : 'id' in record
        ? record
        : null;
    if (candidate) {
      return {
        ...current,
        ...changes,
        ...candidate,
        id: text(candidate.id || current.id),
        payload: candidate.payload && typeof candidate.payload === 'object' ? candidate.payload as Record<string, unknown> : changes.payload ?? current.payload,
      } as Draft;
    }
  }
  return { ...current, ...changes };
}

export function DraftInspector({ draft, onBack, onChanged }: {
  draft: Draft;
  onBack: () => void;
  onChanged: (draft: Draft) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [context, setContext] = useState(draft.context);
  const [payload, setPayload] = useState<Record<string, unknown>>({ ...draft.payload });
  const [nativeTarget, setNativeTarget] = useState(text(draft.native_target ?? draft.nativeTarget));
  const [sheetRows, setSheetRows] = useState(toCsv(rowsFromPayload(draft.payload)));
  const [busy, setBusy] = useState<'save' | 'ack' | 'reject' | 'artifact' | ''>('');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'neutral'; text: string } | null>(null);
  const [artifact, setArtifact] = useState<{ url: string; filename: string } | null>(null);

  useEffect(() => {
    setTitle(draft.title);
    setContext(draft.context);
    setPayload({ ...draft.payload });
    setNativeTarget(text(draft.native_target ?? draft.nativeTarget));
    setSheetRows(toCsv(rowsFromPayload(draft.payload)));
    setFeedback(null);
    setArtifact(null);
  }, [draft.id]);

  useEffect(() => () => {
    if (artifact) URL.revokeObjectURL(artifact.url);
  }, [artifact]);

  const finalStatus = /acknowledged|rejected|sent|published|completed|approved/i.test(draft.status);
  const canEdit = !finalStatus && !busy;
  const set = (key: string, value: unknown) => setPayload((current) => ({ ...current, [key]: value }));

  const loadArtifact = async () => {
    setBusy('artifact');
    try {
      const result = await apiBlob(`/drafts/${encodeURIComponent(draft.id)}/artifact`, `${draft.id}.xlsx`);
      if (artifact) URL.revokeObjectURL(artifact.url);
      setArtifact({ url: URL.createObjectURL(result.blob), filename: result.filename });
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Could not prepare the artifact.' });
    } finally {
      setBusy('');
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('save');
    setFeedback(null);
    const nextPayload = { ...payload };
    if (draft.kind === 'spreadsheet') {
      const sheetTitle = text(nextPayload.title) || title;
      nextPayload.title = sheetTitle;
      nextPayload.sheets = [{ name: 'Sheet1', rows: parseCsv(sheetRows) }];
    }
    const native = nativeTarget || null;
    try {
      const response = await apiFetch<unknown>(`/drafts/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(buildDraftUpdate(draft, title, context, nextPayload, nativeTarget)),
      });
      const next = updatedDraft(response, draft, { title: title.trim(), context: context.trim(), payload: nextPayload, native_target: native });
      onChanged(next);
      setPayload(nextPayload);
      setFeedback({ tone: 'success', text: `Draft saved${next.version !== draft.version ? ` as version ${next.version}` : ''}.` });
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save this draft.' });
    } finally {
      setBusy('');
    }
  };

  const acknowledge = async () => {
    setBusy('ack');
    setFeedback(null);
    try {
      const response = await apiFetch<unknown>(`/drafts/${encodeURIComponent(draft.id)}/acknowledge`, { method: 'POST' });
      const next = updatedDraft(response, draft, { status: 'acknowledged' });
      onChanged(next);
      setFeedback({ tone: 'success', text: 'Acknowledged locally. Nothing was sent or published.' });
      if (draft.kind === 'spreadsheet') await loadArtifact();
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Could not acknowledge this draft.' });
    } finally {
      setBusy('');
    }
  };

  const reject = async () => {
    if (!window.confirm(`Reject “${draft.title}”? This records a rejection; it does not delete the audit history.`)) return;
    setBusy('reject');
    setFeedback(null);
    try {
      const response = await apiFetch<unknown>(`/drafts/${encodeURIComponent(draft.id)}/reject`, { method: 'POST' });
      onChanged(updatedDraft(response, draft, { status: 'rejected' }));
      setFeedback({ tone: 'success', text: 'Draft rejected. No external action was taken.' });
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Could not reject this draft.' });
    } finally {
      setBusy('');
    }
  };

  const events = draft.audit_events ?? draft.audit ?? draft.events ?? [];
  const hash = text(draft.content_hash ?? draft.contentHash);

  return (
    <div className="draft-inspector">
      <div className="inspector-topbar">
        <button className="button button-quiet mobile-back" onClick={onBack} type="button"><Icon name="back" />Queue</button>
        <div><span className="kind-label">{draft.kind} draft</span><span className="draft-id">{draft.id}</span></div>
        <StatusBadge status={draft.status} />
      </div>
      <form onSubmit={save}>
        <div className="inspector-heading">
          <p className="eyebrow">Command / Inspect</p>
          <h2>{draft.title}</h2>
          <p>Review the exact proposed payload before recording a decision.</p>
        </div>
        {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
        {artifact && (
          <Notice tone="success">
            <div className="artifact-ready"><span>Your XLSX artifact is ready.</span><a className="button button-secondary button-small" download={artifact.filename} href={artifact.url}><Icon name="download" size={16} />{artifact.filename}</a></div>
          </Notice>
        )}
        <div className="metadata-strip" aria-label="Draft metadata">
          <div><span>Version</span><strong>{draft.version}</strong></div>
          <div><span>Native target</span><strong>{nativeTarget || 'Local draft only'}</strong></div>
          <div className="hash-field"><span>Content hash</span><code>{hash || 'Not provided'}</code></div>
        </div>
        <div className="form-section">
          <h3>Draft details</h3>
          <label className="form-field"><span>Title</span><input disabled={!canEdit} onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
          <label className="form-field"><span>Context</span><textarea disabled={!canEdit} onChange={(event) => setContext(event.target.value)} rows={3} value={context} /></label>
        </div>
        <div className="form-section">
          <h3>Proposed payload</h3>
          {draft.kind === 'email' && (
            <>
              <label className="form-field"><span>Sending account</span><select disabled={!canEdit} onChange={(event) => set('account', event.target.value as Account)} value={text(payload.account) || 'personal'}><option value="personal">Personal</option><option value="cisai">CISAI</option></select></label>
              <div className="form-row"><label className="form-field"><span>To</span><input disabled={!canEdit} onChange={(event) => set('to', event.target.value)} required value={text(payload.to)} /></label><label className="form-field"><span>CC</span><input disabled={!canEdit} onChange={(event) => set('cc', event.target.value)} value={text(payload.cc)} /></label></div>
              <label className="form-field"><span>Subject</span><input disabled={!canEdit} onChange={(event) => set('subject', event.target.value)} required value={text(payload.subject)} /></label>
              <label className="form-field"><span>Body</span><textarea disabled={!canEdit} onChange={(event) => set('body', event.target.value)} required rows={9} value={text(payload.body)} /></label>
            </>
          )}
          {draft.kind === 'slack' && (
            <>
              <div className="form-row"><label className="form-field"><span>Workspace</span><input disabled={!canEdit} onChange={(event) => set('workspace', event.target.value)} required value={text(payload.workspace)} /></label><label className="form-field"><span>Channel</span><input disabled={!canEdit} onChange={(event) => set('channel', event.target.value)} required value={text(payload.channel)} /></label></div>
              <label className="form-field"><span>Message</span><textarea disabled={!canEdit} onChange={(event) => set('body', event.target.value)} required rows={9} value={text(payload.body)} /></label>
            </>
          )}
          {draft.kind === 'whatsapp' && (
            <><label className="form-field"><span>Recipient</span><input disabled={!canEdit} onChange={(event) => set('recipient', event.target.value)} required value={text(payload.recipient)} /></label><label className="form-field"><span>Message</span><textarea disabled={!canEdit} onChange={(event) => set('body', event.target.value)} required rows={9} value={text(payload.body)} /></label></>
          )}
          {draft.kind === 'notion' && (
            <><div className="form-row"><label className="form-field"><span>Database title</span><input disabled={!canEdit} onChange={(event) => set('database_title', event.target.value)} required value={text(payload.database_title)} /></label><label className="form-field"><span>Page ID</span><input disabled={!canEdit} onChange={(event) => set('page_id', event.target.value)} required value={text(payload.page_id)} /></label></div><ChangeList changes={changesFromPayload(payload.changes)} disabled={!canEdit} onChange={(changes) => set('changes', changes)} /></>
          )}
          {draft.kind === 'airtable' && (
            <><div className="form-row form-row-three"><label className="form-field"><span>Base ID</span><input disabled={!canEdit} onChange={(event) => set('base_id', event.target.value)} required value={text(payload.base_id)} /></label><label className="form-field"><span>Table</span><input disabled={!canEdit} onChange={(event) => set('table', event.target.value)} required value={text(payload.table)} /></label><label className="form-field"><span>Record ID</span><input disabled={!canEdit} onChange={(event) => set('record_id', event.target.value)} required value={text(payload.record_id)} /></label></div><ChangeList changes={changesFromPayload(payload.changes)} disabled={!canEdit} onChange={(changes) => set('changes', changes)} /></>
          )}
          {draft.kind === 'spreadsheet' && (
            <><label className="form-field"><span>Spreadsheet title</span><input disabled={!canEdit} onChange={(event) => set('title', event.target.value)} value={text(payload.title)} /></label><label className="form-field"><span>Sheet1 rows (CSV)</span><textarea className="code-input" disabled={!canEdit} onChange={(event) => setSheetRows(event.target.value)} required rows={9} value={sheetRows} /></label></>
          )}
        </div>
        {(draft.kind === 'email' || draft.kind === 'spreadsheet') && (
          <div className="form-section">
            <h3>Native target</h3>
            <label className="form-field"><span>Destination</span><select disabled={!canEdit} onChange={(event) => setNativeTarget(event.target.value)} value={nativeTarget}><option value="">Local draft / artifact only</option>{draft.kind === 'email' ? <option value="gmail">Gmail (requires added scopes)</option> : <option value="google_sheets">Google Sheets (requires added scopes)</option>}</select></label>
            {nativeTarget && <Notice><strong>Native delivery is not available yet.</strong> Gmail and Sheets require additional OAuth scopes. Saving or acknowledging this draft does not create a Gmail draft or Google Sheet.</Notice>}
          </div>
        )}
        {!finalStatus && <div className="save-row"><button className="button button-secondary" disabled={!!busy} type="submit">{busy === 'save' ? 'Saving…' : 'Save changes'}</button><span>PATCH creates a new reviewed version when the backend supports versioning.</span></div>}
      </form>
      <section aria-labelledby="audit-heading" className="audit-section">
        <div className="section-heading"><div><p className="eyebrow">Traceability</p><h3 id="audit-heading">Audit history</h3></div><span>{events.length} events</span></div>
        {events.length === 0 ? <p className="inline-empty">No audit events were returned for this draft.</p> : (
          <ol className="audit-list">
            {events.map((event, index) => (
              <li key={event.id ?? index}>
                <span aria-hidden="true" className="audit-dot" />
                <div><strong>{text(event.action ?? event.event ?? event.type) || 'Audit event'}</strong><p>{text(event.detail ?? event.message) || 'No event detail provided.'}</p><small>{[text(event.created_at ?? event.timestamp), text(event.actor)].filter(Boolean).join(' · ') || 'Timestamp not provided'}</small></div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-label="Review decision" className="decision-panel">
        <div className="decision-copy"><Icon name="lock" size={17} /><p><strong>Local decision only</strong><span>Acknowledge to record your review. No publish or send action is available.</span></p></div>
        <div className="decision-actions">
          {draft.kind === 'spreadsheet' && !artifact && <button className="button button-quiet" disabled={!!busy} onClick={() => void loadArtifact()} type="button"><Icon name="download" />{busy === 'artifact' ? 'Preparing…' : 'Prepare XLSX'}</button>}
          {!finalStatus && <><button className="button button-danger-quiet" disabled={!!busy} onClick={() => void reject()} type="button">{busy === 'reject' ? 'Rejecting…' : 'Reject'}</button><button className="button button-primary" disabled={!!busy} onClick={() => void acknowledge()} type="button"><Icon name="check" />{busy === 'ack' ? 'Acknowledging…' : 'Acknowledge locally'}</button></>}
        </div>
      </section>
    </div>
  );
}
