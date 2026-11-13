import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { apiFetch, downloadFile } from '../api';
import { copyToClipboard, toTsv } from '../clipboard';
import { draftUpdate, formFromDraft, formsEqual, validateForm, type DraftForm } from '../draftEditing';
import { parseCsv } from '../format';
import { absoluteTime, displayText, FINAL_STATUS, kindLabels, relativeTime } from '../inbox';
import type { AuditEvent, Draft } from '../types';
import { ChangeList } from './ChangeList';
import { DetailRows, DetailSection, DetailsDrawer, Hash } from './DetailsDrawer';
import { Icon } from './Icon';
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor';
import { MessagePreview } from './MessagePreview';
import { TabularData } from './SavedDocuments';
import { Notice, StatusBadge } from './Ui';

type Feedback = { tone: 'success' | 'error' | 'neutral'; text: string } | null;

function HeaderField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="header-field"><span>{label}</span>{children}</label>;
}

function auditTitle(event: AuditEvent): string {
  const name = displayText(event.event ?? event.action ?? event.type).replace(/^draft[._]/, '').replace(/[._]+/g, ' ');
  return name ? `Draft ${name}` : 'Audit event';
}

export function DraftReader({ draft, onChanged, onDirtyChange, onBack }: {
  draft: Draft;
  onChanged: (draft: Draft) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBack: () => void;
}) {
  const [baseline, setBaseline] = useState<DraftForm>(() => formFromDraft(draft));
  const [form, setForm] = useState<DraftForm>(baseline);
  const [editorDirty, setEditorDirty] = useState(false);
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);
  const [busy, setBusy] = useState<'' | 'save' | 'ack' | 'reject' | 'download' | 'copy'>('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [chatTab, setChatTab] = useState<'write' | 'preview'>('write');
  const [sheetIndex, setSheetIndex] = useState(0);
  const [sheetEditing, setSheetEditing] = useState(false);
  const [changesEditing, setChangesEditing] = useState(false);
  const editor = useRef<MarkdownEditorHandle>(null);

  const final = FINAL_STATUS.test(draft.status);
  const locked = !!(draft.native_target ?? draft.nativeTarget);
  const editable = !final && !locked;
  const dirty = editorDirty || !formsEqual(form, baseline);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<Draft>(`/drafts/${encodeURIComponent(draft.id)}`, { signal: controller.signal })
      .then((detail) => setAudit(detail.audit ?? detail.audit_events ?? detail.events ?? []))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setAudit([]);
      });
    return () => controller.abort();
  }, [draft.id, draft.version, draft.status]);

  const set = <K extends keyof DraftForm>(key: K, value: DraftForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!editable || busy || !dirty) return;
    const body = draft.kind === 'email' ? (editorDirty ? editor.current?.getMarkdown() ?? form.body : form.body) : null;
    const errors = validateForm(draft.kind, form, body);
    if (errors.length) {
      setFeedback({ tone: 'error', text: errors.join(' ') });
      return;
    }
    setBusy('save');
    setFeedback(null);
    const submitted = form;
    try {
      const request = draftUpdate(draft, form, baseline, editorDirty ? body : null);
      const next = await apiFetch<Draft>(`/drafts/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH', body: JSON.stringify(request),
      });
      const saved = { ...formFromDraft(next) };
      setBaseline(saved);
      // Keep anything typed while the save was in flight; it remains an unsaved change.
      setForm((current) => (current === submitted ? saved : current));
      editor.current?.markSaved(request.payload.body === undefined ? undefined : String(request.payload.body));
      onChanged(next);
      setFeedback({ tone: 'success', text: `Saved as version ${next.version}.` });
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save this draft.' });
    } finally {
      setBusy('');
    }
  };

  const decide = async (decision: 'acknowledge' | 'reject') => {
    if (decision === 'reject' && !window.confirm(`Reject “${draft.title}”? This records a rejection; the audit history is kept.`)) return;
    setBusy(decision === 'acknowledge' ? 'ack' : 'reject');
    setFeedback(null);
    try {
      const next = await apiFetch<Draft>(`/drafts/${encodeURIComponent(draft.id)}/${decision}`, { method: 'POST' });
      onChanged(next);
      setFeedback({
        tone: 'success',
        text: decision === 'acknowledge'
          ? 'Acknowledged locally. Nothing was sent or published.'
          : 'Rejected. No external action was taken.',
      });
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Could not record this decision.' });
    } finally {
      setBusy('');
    }
  };

  const download = async () => {
    setBusy('download');
    try {
      await downloadFile(`/drafts/${encodeURIComponent(draft.id)}/artifact`, `${draft.id}.xlsx`);
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Could not prepare the workbook.' });
    } finally {
      setBusy('');
    }
  };

  const copy = async () => {
    setBusy('copy');
    try {
      if (draft.kind === 'email') {
        await copyToClipboard(editor.current?.getPlainText() ?? form.body, editor.current?.getHtml() ?? '');
      } else if (draft.kind === 'slack' || draft.kind === 'whatsapp') {
        await copyToClipboard(form.body);
      } else if (draft.kind === 'spreadsheet') {
        await copyToClipboard(toTsv(parseCsv(form.sheets[sheetIndex]?.csv ?? '')));
      } else {
        await copyToClipboard(form.changes.map((change) => `${change.field}: ${change.before || '(empty)'} → ${change.after || '(empty)'}`).join('\n'));
      }
      setFeedback({ tone: 'neutral', text: 'Copied to the clipboard.' });
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Could not copy.' });
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

  const sheet = form.sheets[sheetIndex];
  const sheetRows = sheet ? parseCsv(sheet.csv) : [];

  return (
    <article aria-labelledby="reader-title" className="reader" onKeyDown={onKeyDown}>
      <header className="reader-bar">
        <button className="button button-quiet mobile-back" onClick={onBack} type="button"><Icon name="back" />Inbox</button>
        <div className="reader-bar-meta">
          <span className="kind-chip">{kindLabels[draft.kind]}</span>
          <StatusBadge status={draft.status} />
          {dirty && <span className="dirty-dot">Unsaved changes</span>}
        </div>
        <div className="reader-actions">
          <button aria-expanded={detailsOpen} className="button button-quiet" onClick={() => setDetailsOpen((open) => !open)} type="button"><Icon name="info" />Details</button>
          <button className="button button-quiet" disabled={!!busy} onClick={() => void copy()} type="button"><Icon name="copy" />Copy</button>
          {editable && <button className="button button-secondary" disabled={!!busy || !dirty} onClick={() => void save()} title="Save (Ctrl+S)" type="button">{busy === 'save' ? 'Saving…' : 'Save'}</button>}
        </div>
      </header>

      <div className="reader-scroll">
        <div className="paper">
          <p className="paper-meta">Drafted {relativeTime(String(draft.created_at ?? ''))} · version {draft.version}</p>
          <h2 className="paper-title" id="reader-title">{draft.title}</h2>
          {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
          {locked && <Notice><strong>Permission locked.</strong> This draft targets a native integration that is not enabled, so it cannot be edited here.</Notice>}

          {draft.kind === 'email' && (
            <>
              <div className="message-headers">
                <HeaderField label="From">
                  <select disabled={!editable} onChange={(event) => set('account', event.target.value)} value={form.account}>
                    <option value="personal">Personal account</option>
                    <option value="cisai">CISAI account</option>
                  </select>
                </HeaderField>
                <HeaderField label="To"><input disabled={!editable} onChange={(event) => set('to', event.target.value)} value={form.to} /></HeaderField>
                <HeaderField label="Cc"><input disabled={!editable} onChange={(event) => set('cc', event.target.value)} placeholder="None" value={form.cc} /></HeaderField>
                <HeaderField label="Subject"><input className="subject-input" disabled={!editable} onChange={(event) => set('subject', event.target.value)} value={form.subject} /></HeaderField>
              </div>
              <MarkdownEditor
                editable={editable}
                initialMarkdown={baseline.body}
                key={draft.id}
                label="Email body"
                onDirtyChange={setEditorDirty}
                placeholder="Write the message…"
                ref={editor}
                variant="message"
              />
            </>
          )}

          {(draft.kind === 'slack' || draft.kind === 'whatsapp') && (
            <>
              <div className="message-headers">
                {draft.kind === 'slack' ? (
                  <>
                    <HeaderField label="Workspace"><input disabled={!editable} onChange={(event) => set('workspace', event.target.value)} value={form.workspace} /></HeaderField>
                    <HeaderField label="Channel"><input disabled={!editable} onChange={(event) => set('channel', event.target.value)} value={form.channel} /></HeaderField>
                  </>
                ) : (
                  <HeaderField label="To"><input disabled={!editable} onChange={(event) => set('recipient', event.target.value)} value={form.recipient} /></HeaderField>
                )}
              </div>
              <div className="chat-editor">
                <div aria-label="Message view" className="segmented-control" role="group">
                  <button aria-pressed={chatTab === 'write'} disabled={!editable} onClick={() => setChatTab('write')} type="button">Write</button>
                  <button aria-pressed={chatTab === 'preview' || !editable} onClick={() => setChatTab('preview')} type="button">Preview</button>
                </div>
                <span className="field-help">{draft.kind === 'slack' ? 'Slack formatting: *bold*, _italic_, ~strike~, `code`, <https://url|label>' : 'WhatsApp formatting: *bold*, _italic_, ~strike~, ```monospace```'}</span>
                {chatTab === 'write' && editable ? (
                  <textarea aria-label="Message" className="chat-source" onChange={(event) => set('body', event.target.value)} rows={10} value={form.body} />
                ) : <MessagePreview flavor={draft.kind} text={form.body} />}
              </div>
            </>
          )}

          {(draft.kind === 'notion' || draft.kind === 'airtable') && (
            <>
              <div className="message-headers">
                {draft.kind === 'notion' ? (
                  <>
                    <HeaderField label="Database"><input disabled={!editable} onChange={(event) => set('database_title', event.target.value)} value={form.database_title} /></HeaderField>
                    <HeaderField label="Page ID"><input className="mono-input" disabled={!editable} onChange={(event) => set('page_id', event.target.value)} value={form.page_id} /></HeaderField>
                  </>
                ) : (
                  <>
                    <HeaderField label="Base"><input className="mono-input" disabled={!editable} onChange={(event) => set('base_id', event.target.value)} value={form.base_id} /></HeaderField>
                    <HeaderField label="Table"><input disabled={!editable} onChange={(event) => set('table', event.target.value)} value={form.table} /></HeaderField>
                    <HeaderField label="Record"><input className="mono-input" disabled={!editable} onChange={(event) => set('record_id', event.target.value)} value={form.record_id} /></HeaderField>
                  </>
                )}
              </div>
              {changesEditing && editable ? (
                <ChangeList changes={form.changes} onChange={(changes) => set('changes', changes)} />
              ) : (
                <ol aria-label="Proposed changes" className="change-diff">
                  {form.changes.length === 0 && <li className="inline-empty">No field changes proposed.</li>}
                  {form.changes.map((change, index) => (
                    <li key={index}>
                      <span className="change-field">{change.field || 'Unnamed field'}</span>
                      <span className="change-before"><span className="sr-only">Before: </span>{change.before || '—'}</span>
                      <Icon name="arrow" size={16} />
                      <span className="change-after"><span className="sr-only">After: </span>{change.after || '—'}</span>
                    </li>
                  ))}
                </ol>
              )}
              {editable && <button className="button button-quiet button-small" onClick={() => setChangesEditing((value) => !value)} type="button">{changesEditing ? 'Done editing changes' : 'Edit changes'}</button>}
            </>
          )}

          {draft.kind === 'spreadsheet' && (
            <>
              <div className="message-headers">
                <HeaderField label="Workbook"><input disabled={!editable} onChange={(event) => set('spreadsheetTitle', event.target.value)} value={form.spreadsheetTitle} /></HeaderField>
              </div>
              {form.sheets.length > 1 && (
                <div aria-label="Sheets" className="sheet-tabs" role="tablist">
                  {form.sheets.map((item, index) => (
                    <button aria-selected={index === sheetIndex} key={`${item.name}-${index}`} onClick={() => setSheetIndex(index)} role="tab" type="button">{item.name}</button>
                  ))}
                </div>
              )}
              {sheet && (sheetEditing && editable ? (
                <label className="form-field">
                  <span>{sheet.name} rows (CSV)</span>
                  <textarea
                    className="code-input"
                    onChange={(event) => set('sheets', form.sheets.map((item, index) => index === sheetIndex ? { ...item, csv: event.target.value } : item))}
                    rows={12}
                    value={sheet.csv}
                  />
                </label>
              ) : sheetRows.length ? (
                <TabularData caption={sheet.name} headers={sheetRows[0]} rows={sheetRows.slice(1)} />
              ) : <p className="inline-empty">This sheet is empty.</p>)}
              <div className="inline-actions">
                {editable && sheet && <button className="button button-quiet button-small" onClick={() => setSheetEditing((value) => !value)} type="button">{sheetEditing ? 'Show table' : 'Edit as CSV'}</button>}
                <button className="button button-quiet button-small" disabled={!!busy || dirty} onClick={() => void download()} title={dirty ? 'Save first to download the current version' : undefined} type="button"><Icon name="download" size={16} />{busy === 'download' ? 'Preparing…' : 'Download XLSX'}</button>
              </div>
            </>
          )}
        </div>
      </div>

      {!final && (
        <footer className="decision-bar">
          <p><Icon name="lock" size={16} /><span>Decisions are recorded locally. Nothing is sent or published from here.</span></p>
          <div className="decision-actions">
            <button className="button button-danger-quiet" disabled={!!busy} onClick={() => void decide('reject')} type="button">{busy === 'reject' ? 'Rejecting…' : 'Reject'}</button>
            <button className="button button-primary" disabled={!!busy || dirty} onClick={() => void decide('acknowledge')} title={dirty ? 'Save your changes first' : undefined} type="button"><Icon name="check" />{busy === 'ack' ? 'Acknowledging…' : 'Acknowledge locally'}</button>
          </div>
        </footer>
      )}

      <DetailsDrawer onClose={() => setDetailsOpen(false)} open={detailsOpen} title={draft.title}>
        <DetailSection title="Draft">
          <label className="form-field"><span>Title</span><input disabled={!editable} maxLength={240} onChange={(event) => set('title', event.target.value)} value={form.title} /></label>
          <label className="form-field"><span>Context</span><textarea disabled={!editable} onChange={(event) => set('context', event.target.value)} rows={5} value={form.context} /></label>
          {editable && dirty && <p className="field-help">Title and context are saved with the draft.</p>}
        </DetailSection>
        <DetailSection title="Record">
          <DetailRows rows={[
            ['Status', <StatusBadge key="s" status={draft.status} />],
            ['Version', String(draft.version)],
            ['Content hash', <Hash key="h" value={displayText(draft.content_hash ?? draft.contentHash)} />],
            ['Native target', displayText(draft.native_target ?? draft.nativeTarget) || 'Local draft only'],
            ['Draft ID', <code key="i">{draft.id}</code>],
            ['Created', absoluteTime(String(draft.created_at ?? ''))],
            ['Updated', absoluteTime(String(draft.updated_at ?? ''))],
          ]} />
        </DetailSection>
        <DetailSection title="Audit history">
          {audit === null ? <p className="inline-empty">Loading…</p> : audit.length === 0 ? <p className="inline-empty">No audit events recorded.</p> : (
            <ol className="audit-list">
              {audit.map((event, index) => (
                <li key={displayText(event.id) || index}>
                  <span aria-hidden="true" className="audit-dot" />
                  <div>
                    <strong>{auditTitle(event)}</strong>
                    <small>{[absoluteTime(displayText(event.created_at ?? event.timestamp)), displayText(event.actor)].filter(Boolean).join(' · ')}</small>
                    {displayText(event.content_hash) && <Hash value={displayText(event.content_hash)} />}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </DetailSection>
      </DetailsDrawer>
    </article>
  );
}
