import { describe, expect, it } from 'vitest';
import { buildDraftRequest, buildDraftUpdate, validateDraft } from './draftForms';
import type { ComposeValues } from './types';

const base: ComposeValues = {
  title: 'Follow up',
  context: 'Customer renewal',
  account: 'personal',
  instructions: '',
  destination: '',
  nativeTarget: '',
  to: 'ada@example.com',
  cc: 'grace@example.com',
  subject: 'Renewal',
  body: 'Hello Ada',
  workspace: 'operations',
  channel: '#renewals',
  recipient: '+15550001111',
  databaseTitle: 'Customers',
  pageId: 'page-123',
  baseId: 'base-123',
  table: 'Accounts',
  recordId: 'rec-123',
  changes: [{ field: 'Stage', before: 'New', after: 'Renewing' }],
  spreadsheetTitle: 'Renewal report',
  rows: 'Name,Stage\nAda,Renewing',
};

describe('buildDraftRequest', () => {
  it('maps every kind to its backend payload contract', () => {
    expect(buildDraftRequest('email', { ...base, nativeTarget: 'gmail' })).toEqual({
      kind: 'email', title: 'Follow up', context: 'Customer renewal', native_target: 'gmail',
      payload: { account: 'personal', to: 'ada@example.com', cc: 'grace@example.com', subject: 'Renewal', body: 'Hello Ada' },
    });
    expect(buildDraftRequest('slack', base).payload).toEqual({ workspace: 'operations', channel: '#renewals', body: 'Hello Ada' });
    expect(buildDraftRequest('whatsapp', base).payload).toEqual({ recipient: '+15550001111', body: 'Hello Ada' });
    expect(buildDraftRequest('notion', base).payload).toEqual({ database_title: 'Customers', page_id: 'page-123', changes: base.changes });
    expect(buildDraftRequest('airtable', base).payload).toEqual({ base_id: 'base-123', table: 'Accounts', record_id: 'rec-123', changes: base.changes });
    expect(buildDraftRequest('spreadsheet', { ...base, nativeTarget: 'google_sheets' })).toEqual({
      kind: 'spreadsheet', title: 'Follow up', context: 'Customer renewal', native_target: 'google_sheets',
      payload: { title: 'Renewal report', sheets: [{ name: 'Sheet1', rows: [['Name', 'Stage'], ['Ada', 'Renewing']] }] },
    });
  });
});


describe('buildDraftUpdate', () => {
  it('retains the draft kind and allows native targets to be cleared', () => {
    expect(buildDraftUpdate(
      { kind: 'email' },
      ' Updated title ',
      ' Revised context ',
      { account: 'cisai', to: 'ada@example.com', subject: 'Renewal', body: 'Hello' },
      '',
    )).toEqual({
      kind: 'email', title: 'Updated title', context: 'Revised context', native_target: null,
      payload: { account: 'cisai', to: 'ada@example.com', subject: 'Renewal', body: 'Hello' },
    });
  });
});

describe('validateDraft', () => {
  it('identifies missing kind-specific fields without mutating form values', () => {
    expect(validateDraft('email', { ...base, title: '', to: '' })).toEqual([
      'Draft title is required.',
      'Recipient is required.',
    ]);
    expect(validateDraft('spreadsheet', { ...base, rows: '', spreadsheetTitle: '' })).toEqual([
      'Spreadsheet rows are required.',
    ]);
    expect(validateDraft('airtable', { ...base, changes: [{ field: '', before: '', after: '' }] })).toEqual([
      'At least one change needs a field name.',
    ]);
    expect(base.to).toBe('ada@example.com');
  });
});
