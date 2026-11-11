import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiFetch } from '../api';
import { buildDraftRequest, validateDraft } from '../draftForms';
import type { Account, ComposeValues, DraftKind, JsonRecord } from '../types';
import { ChangeList } from './ChangeList';
import { Icon } from './Icon';
import { Notice, PageHeader } from './Ui';

const kinds: { id: DraftKind; label: string; description: string }[] = [
  { id: 'email', label: 'Email', description: 'A message addressed and ready for review.' },
  { id: 'notion', label: 'Notion', description: 'Field-level changes to an existing page.' },
  { id: 'slack', label: 'Slack', description: 'A message for a workspace channel.' },
  { id: 'whatsapp', label: 'WhatsApp', description: 'A message to one recipient.' },
  { id: 'spreadsheet', label: 'Spreadsheet', description: 'CSV rows packaged as a local XLSX artifact.' },
  { id: 'airtable', label: 'Airtable', description: 'Field-level changes to one record.' },
];

const initialValues: ComposeValues = {
  title: '', context: '', account: 'personal', instructions: '', destination: '', nativeTarget: '',
  to: '', cc: '', subject: '', body: '', workspace: '', channel: '', recipient: '',
  databaseTitle: '', pageId: '', baseId: '', table: '', recordId: '',
  changes: [{ field: '', before: '', after: '' }], spreadsheetTitle: '', rows: '',
};

export function ComposeView({ onCreated }: { onCreated: () => void }) {
  const [kind, setKind] = useState<DraftKind>('email');
  const [mode, setMode] = useState<'manual' | 'agent'>('manual');
  const [values, setValues] = useState<ComposeValues>(initialValues);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<JsonRecord | null>(null);

  const set = <K extends keyof ComposeValues>(key: K, value: ComposeValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };
  const selectedKind = kinds.find((item) => item.id === kind)!;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setResult(null);
    const nextErrors = mode === 'manual'
      ? validateDraft(kind, values)
      : [
          ...(!values.title.trim() ? ['Draft title is required.'] : []),
          ...(!values.instructions.trim() ? ['Agent instructions are required.'] : []),
        ];
    setErrors(nextErrors);
    if (nextErrors.length) return;

    setBusy(true);
    try {
      const request = mode === 'manual'
        ? { path: '/drafts', body: buildDraftRequest(kind, values) }
        : {
            path: '/agent/proposals',
            body: {
              kind,
              title: values.title.trim(),
              context: values.context.trim(),
              instructions: values.instructions.trim(),
              account: values.account,
              destination: values.destination.trim(),
            },
          };
      const response = await apiFetch<unknown>(request.path, { method: 'POST', body: JSON.stringify(request.body) });
      const record = response && typeof response === 'object' ? response as JsonRecord : {};
      const unwrapped = record.draft && typeof record.draft === 'object' ? record.draft as JsonRecord : record;
      setResult(unwrapped);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'The request could not be completed.']);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setValues(initialValues);
    setErrors([]);
    setResult(null);
  };

  return (
    <div className="view compose-view">
      <PageHeader description="Prepare a reviewable draft manually, or ask the agent for a structured proposal." eyebrow="Operations / Compose" title="Compose a draft" />
      <div className="compose-layout">
        <form className="compose-form" onSubmit={submit}>
          <section className="form-section kind-section" aria-labelledby="kind-heading">
            <div className="section-heading"><div><p className="eyebrow">01 / Format</p><h2 id="kind-heading">What are you drafting?</h2></div></div>
            <div aria-label="Draft kind" className="kind-selector" role="group">
              {kinds.map((item) => <button aria-pressed={kind === item.id} className={kind === item.id ? 'selected' : ''} key={item.id} onClick={() => { setKind(item.id); setResult(null); setErrors([]); }} type="button">{item.label}</button>)}
            </div>
            <p className="section-support">{selectedKind.description}</p>
          </section>
          <section className="form-section" aria-labelledby="method-heading">
            <div className="section-heading"><div><p className="eyebrow">02 / Method</p><h2 id="method-heading">Choose how to prepare it</h2></div></div>
            <div aria-label="Composition method" className="method-switch" role="group">
              <button aria-pressed={mode === 'manual'} className={mode === 'manual' ? 'selected' : ''} onClick={() => { setMode('manual'); setErrors([]); setResult(null); }} type="button"><strong>Build manually</strong><span>Enter the exact payload yourself.</span></button>
              <button aria-pressed={mode === 'agent'} className={mode === 'agent' ? 'selected' : ''} onClick={() => { setMode('agent'); setErrors([]); setResult(null); }} type="button"><strong>Generate with agent</strong><span>Provide intent; review the returned proposal.</span></button>
            </div>
          </section>
          <section className="form-section" aria-labelledby="details-heading">
            <div className="section-heading"><div><p className="eyebrow">03 / Details</p><h2 id="details-heading">{mode === 'agent' ? 'Brief the agent' : `${selectedKind.label} draft`}</h2></div></div>
            {errors.length > 0 && <Notice tone="error"><strong>{errors.length === 1 ? 'The draft needs attention' : 'The draft needs a few changes'}</strong><ul className="error-list">{errors.map((error) => <li key={error}>{error}</li>)}</ul><span>Your entries have been preserved.</span></Notice>}
            {result && (
              <Notice tone="success">
                <div className="creation-result">
                  <div><strong>{mode === 'agent' ? 'Agent proposal returned' : 'Draft created for review'}</strong><p>No external message or native document was sent or published.</p></div>
                  {Object.entries(result).filter(([key, value]) => ['id', 'draft_id', 'status', 'version'].includes(key) && (typeof value === 'string' || typeof value === 'number')).map(([key, value]) => <span className="result-meta" key={key}>{key.replace('_', ' ')}: {String(value)}</span>)}
                  <div className="result-actions"><button className="button button-primary button-small" onClick={onCreated} type="button">Open inbox <Icon name="arrow" size={15} /></button><button className="button button-quiet button-small" onClick={reset} type="button">Create another</button></div>
                </div>
              </Notice>
            )}
            <label className="form-field"><span>Draft title <b aria-hidden="true">*</b></span><input disabled={busy} onChange={(event) => set('title', event.target.value)} placeholder="A clear name for the review queue" required value={values.title} /></label>
            <label className="form-field"><span>Context</span><textarea disabled={busy} onChange={(event) => set('context', event.target.value)} placeholder="Background the reviewer should know" rows={3} value={values.context} /></label>
            {mode === 'agent' ? (
              <>
                <label className="form-field"><span>Instructions <b aria-hidden="true">*</b></span><textarea disabled={busy} onChange={(event) => set('instructions', event.target.value)} placeholder="Describe the outcome, tone, constraints, and facts the agent should use" required rows={7} value={values.instructions} /></label>
                <div className="form-row"><label className="form-field"><span>Account</span><select disabled={busy} onChange={(event) => set('account', event.target.value as Account)} value={values.account}><option value="personal">Personal</option><option value="cisai">CISAI</option></select></label><label className="form-field"><span>Destination</span><input disabled={busy} onChange={(event) => set('destination', event.target.value)} placeholder="Recipient, channel, or record" value={values.destination} /></label></div>
              </>
            ) : (
              <div className="kind-fields">
                {kind === 'email' && (
                  <><label className="form-field"><span>Account</span><select disabled={busy} onChange={(event) => set('account', event.target.value as Account)} value={values.account}><option value="personal">Personal</option><option value="cisai">CISAI</option></select></label><div className="form-row"><label className="form-field"><span>To <b aria-hidden="true">*</b></span><input disabled={busy} onChange={(event) => set('to', event.target.value)} placeholder="name@example.com" required value={values.to} /></label><label className="form-field"><span>CC</span><input disabled={busy} onChange={(event) => set('cc', event.target.value)} placeholder="Optional, comma-separated" value={values.cc} /></label></div><label className="form-field"><span>Subject <b aria-hidden="true">*</b></span><input disabled={busy} onChange={(event) => set('subject', event.target.value)} required value={values.subject} /></label><label className="form-field"><span>Body <b aria-hidden="true">*</b></span><textarea disabled={busy} onChange={(event) => set('body', event.target.value)} required rows={9} value={values.body} /></label></>
                )}
                {kind === 'slack' && (
                  <><div className="form-row"><label className="form-field"><span>Workspace <b aria-hidden="true">*</b></span><input disabled={busy} onChange={(event) => set('workspace', event.target.value)} required value={values.workspace} /></label><label className="form-field"><span>Channel <b aria-hidden="true">*</b></span><input disabled={busy} onChange={(event) => set('channel', event.target.value)} placeholder="#operations" required value={values.channel} /></label></div><label className="form-field"><span>Message <b aria-hidden="true">*</b></span><textarea disabled={busy} onChange={(event) => set('body', event.target.value)} required rows={9} value={values.body} /></label></>
                )}
                {kind === 'whatsapp' && (
                  <><label className="form-field"><span>Recipient <b aria-hidden="true">*</b></span><input disabled={busy} onChange={(event) => set('recipient', event.target.value)} placeholder="Phone number or recipient ID" required value={values.recipient} /></label><label className="form-field"><span>Message <b aria-hidden="true">*</b></span><textarea disabled={busy} onChange={(event) => set('body', event.target.value)} required rows={9} value={values.body} /></label></>
                )}
                {kind === 'notion' && (
                  <><div className="form-row"><label className="form-field"><span>Database title <b aria-hidden="true">*</b></span><input disabled={busy} onChange={(event) => set('databaseTitle', event.target.value)} required value={values.databaseTitle} /></label><label className="form-field"><span>Page ID <b aria-hidden="true">*</b></span><input disabled={busy} onChange={(event) => set('pageId', event.target.value)} required value={values.pageId} /></label></div><ChangeList changes={values.changes} disabled={busy} onChange={(changes) => set('changes', changes)} /></>
                )}
                {kind === 'airtable' && (
                  <><div className="form-row form-row-three"><label className="form-field"><span>Base ID <b aria-hidden="true">*</b></span><input disabled={busy} onChange={(event) => set('baseId', event.target.value)} required value={values.baseId} /></label><label className="form-field"><span>Table <b aria-hidden="true">*</b></span><input disabled={busy} onChange={(event) => set('table', event.target.value)} required value={values.table} /></label><label className="form-field"><span>Record ID <b aria-hidden="true">*</b></span><input disabled={busy} onChange={(event) => set('recordId', event.target.value)} required value={values.recordId} /></label></div><ChangeList changes={values.changes} disabled={busy} onChange={(changes) => set('changes', changes)} /></>
                )}
                {kind === 'spreadsheet' && (
                  <><label className="form-field"><span>Spreadsheet title</span><input disabled={busy} onChange={(event) => set('spreadsheetTitle', event.target.value)} placeholder={values.title || 'Workbook name'} value={values.spreadsheetTitle} /></label><label className="form-field"><span>Sheet1 rows (CSV) <b aria-hidden="true">*</b></span><textarea className="code-input" disabled={busy} onChange={(event) => set('rows', event.target.value)} placeholder={'Name,Status\nExample,Pending'} required rows={10} spellCheck={false} value={values.rows} /><small>Quotes, escaped quotes, commas, and multiline CSV cells are supported.</small></label></>
                )}
                {(kind === 'email' || kind === 'spreadsheet') && (
                  <div className="native-target-block">
                    <label className="form-field"><span>Native target (optional)</span><select disabled={busy} onChange={(event) => set('nativeTarget', event.target.value as ComposeValues['nativeTarget'])} value={values.nativeTarget}><option value="">Local draft / artifact only</option>{kind === 'email' ? <option value="gmail">Gmail</option> : <option value="google_sheets">Google Sheets</option>}</select></label>
                    <Notice><strong>Native {kind === 'email' ? 'Gmail' : 'Google Sheets'} is unavailable until the required OAuth scopes are added.</strong> Selecting a native target records intent only. Creating or acknowledging this draft must not be interpreted as native delivery.</Notice>
                  </div>
                )}
              </div>
            )}
          </section>
          <div className="compose-submit"><div><strong>{mode === 'agent' ? 'Request a proposal' : 'Add to the inbox'}</strong><span>This action does not send, publish, or modify an external service.</span></div><button className="button button-primary" disabled={busy || !!result} type="submit">{busy ? 'Submitting…' : mode === 'agent' ? 'Generate with agent' : 'Create draft'}<Icon name="arrow" /></button></div>
        </form>
        <aside className="compose-summary" aria-label="Draft summary">
          <p className="eyebrow">Current brief</p><h2>{values.title || 'Untitled draft'}</h2>
          <dl><div><dt>Kind</dt><dd>{selectedKind.label}</dd></div><div><dt>Method</dt><dd>{mode === 'agent' ? 'Agent proposal' : 'Manual payload'}</dd></div><div><dt>Review</dt><dd>Required</dd></div><div><dt>Destination</dt><dd>{mode === 'agent' ? values.destination || 'Not specified' : values.nativeTarget || 'Local only'}</dd></div></dl>
          <div className="summary-rule"><Icon name="lock" size={16} /><p><strong>Approval boundary</strong><span>External actions are outside this console. Review decisions remain local and auditable.</span></p></div>
        </aside>
      </div>
    </div>
  );
}
