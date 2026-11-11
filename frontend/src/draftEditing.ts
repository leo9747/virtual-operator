import { parseCsv, toCsv } from './format';
import { displayText } from './inbox';
import type { ChangeEntry, Draft, DraftRequest, JsonRecord } from './types';

export interface SheetForm {
  name: string;
  csv: string;
}

/** Every user-editable value of a queued draft, as strings, for dirty tracking. */
export interface DraftForm {
  title: string;
  context: string;
  account: string;
  to: string;
  cc: string;
  subject: string;
  workspace: string;
  channel: string;
  recipient: string;
  /** Slack and WhatsApp bodies. Email bodies live in the rich editor instead. */
  body: string;
  database_title: string;
  page_id: string;
  base_id: string;
  table: string;
  record_id: string;
  changes: ChangeEntry[];
  spreadsheetTitle: string;
  sheets: SheetForm[];
}

const STRING_FIELDS = [
  'account', 'to', 'cc', 'subject', 'workspace', 'channel', 'recipient', 'body',
  'database_title', 'page_id', 'base_id', 'table', 'record_id',
] as const;

export function changesFromPayload(value: unknown): ChangeEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is JsonRecord => !!item && typeof item === 'object').map((item) => ({
    field: displayText(item.field),
    before: displayText(item.before),
    after: displayText(item.after),
  }));
}

export function sheetsFromPayload(payload: JsonRecord): { name: string; rows: string[][] }[] {
  if (!Array.isArray(payload.sheets)) return [];
  return payload.sheets.map((sheet, index) => {
    const record = sheet && typeof sheet === 'object' ? sheet as JsonRecord : {};
    const rows = Array.isArray(record.rows)
      ? record.rows.map((row) => Array.isArray(row) ? row.map(displayText) : [])
      : [];
    return { name: displayText(record.name) || `Sheet${index + 1}`, rows };
  });
}

export function formFromDraft(draft: Draft): DraftForm {
  const p = draft.payload;
  return {
    title: draft.title,
    context: draft.context ?? '',
    account: displayText(p.account) || 'personal',
    to: displayText(p.to),
    cc: displayText(p.cc),
    subject: displayText(p.subject),
    workspace: displayText(p.workspace),
    channel: displayText(p.channel),
    recipient: displayText(p.recipient),
    body: displayText(p.body),
    database_title: displayText(p.database_title),
    page_id: displayText(p.page_id),
    base_id: displayText(p.base_id),
    table: displayText(p.table),
    record_id: displayText(p.record_id),
    changes: changesFromPayload(p.changes),
    spreadsheetTitle: displayText(p.title),
    sheets: sheetsFromPayload(p).map((sheet) => ({ name: sheet.name, csv: toCsv(sheet.rows) })),
  };
}

export function formsEqual(a: DraftForm, b: DraftForm): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Build the PATCH body. Fields the user did not touch keep their exact original JSON
 * value (arrays stay arrays, absent keys stay absent), so saving never reshapes data.
 */
export function draftUpdate(
  draft: Draft, form: DraftForm, baseline: DraftForm, emailBody: string | null,
): DraftRequest {
  const payload: JsonRecord = { ...draft.payload };
  for (const field of STRING_FIELDS) {
    if (field === 'body' && draft.kind === 'email') continue;
    if (form[field] !== baseline[field]) payload[field] = form[field];
  }
  if (draft.kind === 'email' && emailBody !== null) payload.body = emailBody;
  if ((draft.kind === 'notion' || draft.kind === 'airtable')
    && JSON.stringify(form.changes) !== JSON.stringify(baseline.changes)) {
    payload.changes = form.changes;
  }
  if (draft.kind === 'spreadsheet') {
    if (form.spreadsheetTitle !== baseline.spreadsheetTitle) payload.title = form.spreadsheetTitle;
    if (JSON.stringify(form.sheets) !== JSON.stringify(baseline.sheets)) {
      const original = Array.isArray(draft.payload.sheets) ? draft.payload.sheets : [];
      payload.sheets = form.sheets.map((sheet, index) => {
        const before = baseline.sheets[index];
        if (before && before.csv === sheet.csv && before.name === sheet.name && original[index]) return original[index];
        return { name: sheet.name, rows: parseCsv(sheet.csv) };
      });
    }
  }
  return {
    kind: draft.kind,
    title: form.title.trim(),
    context: form.context.trim(),
    payload,
    native_target: null,
  };
}

export function validateForm(kind: Draft['kind'], form: DraftForm, emailBody: string | null): string[] {
  const errors: string[] = [];
  const need = (value: string, label: string) => { if (!value.trim()) errors.push(`${label} is required.`); };
  need(form.title, 'Title');
  if (form.title.trim().length > 240) errors.push('Title must be 240 characters or fewer.');
  if (form.context.length > 50_000) errors.push('Context must be 50,000 characters or fewer.');
  switch (kind) {
    case 'email':
      need(form.to, 'Recipient');
      need(form.subject, 'Subject');
      if (emailBody !== null) need(emailBody, 'Message');
      if (form.account !== 'personal' && form.account !== 'cisai') errors.push('Choose the personal or CISAI account.');
      break;
    case 'slack':
      need(form.workspace, 'Workspace');
      need(form.channel, 'Channel');
      need(form.body, 'Message');
      break;
    case 'whatsapp':
      need(form.recipient, 'Recipient');
      need(form.body, 'Message');
      break;
    case 'notion':
      need(form.database_title, 'Database');
      need(form.page_id, 'Page ID');
      break;
    case 'airtable':
      need(form.base_id, 'Base ID');
      need(form.table, 'Table');
      need(form.record_id, 'Record ID');
      break;
    case 'spreadsheet':
      if (!form.sheets.length) errors.push('The workbook needs at least one sheet.');
      else if (form.sheets.every((sheet) => !parseCsv(sheet.csv).length)) errors.push('The workbook needs at least one row.');
      break;
  }
  return errors;
}
