import { parseCsv } from './format';
import type { ComposeValues, DraftKind, DraftRequest, JsonRecord } from './types';

export function buildDraftRequest(kind: DraftKind, values: ComposeValues): DraftRequest {
  let payload: JsonRecord;

  switch (kind) {
    case 'email':
      payload = {
        account: values.account,
        to: values.to.trim(),
        cc: values.cc.trim(),
        subject: values.subject.trim(),
        body: values.body,
      };
      break;
    case 'slack':
      payload = { workspace: values.workspace.trim(), channel: values.channel.trim(), body: values.body };
      break;
    case 'whatsapp':
      payload = { recipient: values.recipient.trim(), body: values.body };
      break;
    case 'notion':
      payload = {
        database_title: values.databaseTitle.trim(),
        page_id: values.pageId.trim(),
        changes: cleanChanges(values),
      };
      break;
    case 'airtable':
      payload = {
        base_id: values.baseId.trim(),
        table: values.table.trim(),
        record_id: values.recordId.trim(),
        changes: cleanChanges(values),
      };
      break;
    case 'spreadsheet':
      payload = {
        title: values.spreadsheetTitle.trim() || values.title.trim(),
        sheets: [{ name: 'Sheet1', rows: parseCsv(values.rows) }],
      };
      break;
  }

  const request: DraftRequest = {
    kind,
    title: values.title.trim(),
    context: values.context.trim(),
    payload,
  };

  if ((kind === 'email' && values.nativeTarget === 'gmail') ||
      (kind === 'spreadsheet' && values.nativeTarget === 'google_sheets')) {
    request.native_target = values.nativeTarget;
  }

  return request;
}

export function buildDraftUpdate(
  draft: { kind: DraftKind },
  title: string,
  context: string,
  payload: JsonRecord,
  nativeTarget: string,
): DraftRequest {
  return {
    kind: draft.kind,
    title: title.trim(),
    context: context.trim(),
    payload,
    native_target: nativeTarget || null,
  };
}

export function validateDraft(kind: DraftKind, values: ComposeValues): string[] {
  const errors: string[] = [];
  if (!values.title.trim()) errors.push('Draft title is required.');

  const required = (value: string, message: string) => {
    if (!value.trim()) errors.push(message);
  };

  switch (kind) {
    case 'email':
      required(values.to, 'Recipient is required.');
      required(values.subject, 'Subject is required.');
      required(values.body, 'Email body is required.');
      break;
    case 'slack':
      required(values.workspace, 'Slack workspace is required.');
      required(values.channel, 'Slack channel is required.');
      required(values.body, 'Message body is required.');
      break;
    case 'whatsapp':
      required(values.recipient, 'WhatsApp recipient is required.');
      required(values.body, 'Message body is required.');
      break;
    case 'notion':
      required(values.databaseTitle, 'Notion database title is required.');
      required(values.pageId, 'Notion page ID is required.');
      if (!values.changes.some((change) => change.field.trim())) {
        errors.push('At least one change needs a field name.');
      }
      break;
    case 'airtable':
      required(values.baseId, 'Airtable base ID is required.');
      required(values.table, 'Airtable table is required.');
      required(values.recordId, 'Airtable record ID is required.');
      if (!values.changes.some((change) => change.field.trim())) {
        errors.push('At least one change needs a field name.');
      }
      break;
    case 'spreadsheet':
      if (!parseCsv(values.rows).length) errors.push('Spreadsheet rows are required.');
      break;
  }

  return errors;
}

function cleanChanges(values: ComposeValues) {
  return values.changes
    .filter((change) => change.field.trim())
    .map((change) => ({
      field: change.field.trim(),
      before: change.before,
      after: change.after,
    }));
}
