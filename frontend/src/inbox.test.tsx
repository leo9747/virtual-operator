// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessagePreview } from './components/MessagePreview';
import { draftUpdate, formFromDraft, validateForm } from './draftEditing';
import { dayGroup, documentItem, draftItem, filterItems, plainPreview, relativeTime, sortItems } from './inbox';
import type { Draft, SavedEntry } from './types';

function render(element: ReactElement) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(element);
  return { container };
}

function draft(overrides: Partial<Draft>): Draft {
  return {
    id: 'drf_1', kind: 'email', title: 'Email', context: '', status: 'draft', version: 1,
    payload: { account: 'personal', to: 'a@example.org', cc: '', subject: 'Hi', body: 'Body' },
    created_at: '2026-11-11T10:00:00+00:00', updated_at: '2026-11-11T10:00:00+00:00', ...overrides,
  };
}

const entry: SavedEntry = {
  id: 'alpha.md', title: 'Alpha [Priority: P0]', sourceUrl: null, status: 'blocked', priority: 'P0', due: null,
  blocker: 'Need the **final** figure', files: [{ id: 'alpha.md', name: 'alpha.md', kind: 'markdown' }],
  modifiedAt: '2026-11-11T12:00:00+00:00',
};

describe('inbox items', () => {
  it('groups kinds into messages, documents, and updates', () => {
    expect(draftItem(draft({ kind: 'slack', payload: { channel: '#ops', body: 'x' } })).group).toBe('message');
    expect(draftItem(draft({ kind: 'whatsapp', payload: { body: 'x' } })).group).toBe('message');
    expect(draftItem(draft({ kind: 'notion', payload: { changes: [] } })).group).toBe('update');
    expect(draftItem(draft({ kind: 'airtable', payload: { changes: [] } })).group).toBe('update');
    expect(draftItem(draft({ kind: 'spreadsheet', payload: { sheets: [] } })).group).toBe('document');
    expect(documentItem(entry).group).toBe('document');
  });

  it('builds readable labels and previews, including array recipients', () => {
    const item = draftItem(draft({ payload: { to: ['a@example.org', 'b@example.org'], subject: 'Plan', body: '**Bold** [link](https://x.y)' } }));
    expect(item.label).toBe('Email · to a@example.org, b@example.org');
    expect(item.preview).toBe('Plan — Bold link');
    const doc = documentItem(entry);
    expect(doc.title).toBe('Alpha');
    expect(doc.preview).toBe('Need the final figure');
    expect(doc.open).toBe(true);
    expect(documentItem({ ...entry, status: 'skipped' }).open).toBe(false);
  });

  it('sorts newest first and keeps undated items last', () => {
    const items = sortItems([
      draftItem(draft({ id: 'old', created_at: '2026-11-01T00:00:00Z' })),
      draftItem(draft({ id: 'undated', created_at: 'not a date' })),
      documentItem(entry),
      draftItem(draft({ id: 'new', created_at: '2026-11-11T13:00:00Z' })),
    ]);
    expect(items.map((item) => item.key)).toEqual(['draft:new', 'document:alpha.md', 'draft:old', 'draft:undated']);
  });

  it('filters by group, closed state, and search text', () => {
    const items = [
      draftItem(draft({ id: 'a', status: 'acknowledged' })),
      draftItem(draft({ id: 'b', kind: 'notion', title: 'Status change', payload: { changes: [] } })),
      documentItem(entry),
    ];
    expect(filterItems(items, 'all', false, '').map((item) => item.key)).toEqual(['draft:b', 'document:alpha.md']);
    expect(filterItems(items, 'all', true, '').length).toBe(3);
    expect(filterItems(items, 'update', false, '').map((item) => item.key)).toEqual(['draft:b']);
    expect(filterItems(items, 'all', true, 'FINAL figure').map((item) => item.key)).toEqual(['document:alpha.md']);
    // The reviewed item stays listed while it is open in the reader.
    expect(filterItems(items, 'all', false, '', 'draft:a').map((item) => item.key)).toEqual(['draft:a', 'draft:b', 'document:alpha.md']);
  });

  it('formats relative times and day groups', () => {
    const now = new Date('2026-11-11T12:00:00');
    expect(relativeTime(new Date('2026-11-11T11:59:40').toISOString(), now)).toBe('just now');
    expect(relativeTime(new Date('2026-11-11T11:15:00').toISOString(), now)).toBe('45 min ago');
    expect(relativeTime('garbage', now)).toBe('');
    expect(dayGroup(new Date('2026-11-11T01:00:00').toISOString(), now)).toBe('Today');
    expect(dayGroup(new Date('2026-11-10T23:00:00').toISOString(), now)).toBe('Yesterday');
    expect(dayGroup(new Date('2026-11-07T10:00:00').toISOString(), now)).toBe('This week');
    expect(dayGroup(new Date('2026-10-01T10:00:00').toISOString(), now)).toBe('Earlier');
    expect(plainPreview('x'.repeat(200), 10)).toBe('xxxxxxxxx…');
  });
});

describe('draft editing', () => {
  it('leaves untouched payload values exactly as they were', () => {
    const original = draft({ payload: { account: 'personal', to: ['a@example.org'], subject: 'Hi', body: 'Body', extra: { keep: true } } });
    const form = formFromDraft(original);
    const request = draftUpdate(original, { ...form, subject: 'Changed' }, form, null);
    expect(request.payload).toEqual({ account: 'personal', to: ['a@example.org'], subject: 'Changed', body: 'Body', extra: { keep: true } });
    expect(request.native_target).toBeNull();
  });

  it('only replaces the email body when the editor changed it', () => {
    const original = draft({});
    const form = formFromDraft(original);
    expect(draftUpdate(original, form, form, null).payload.body).toBe('Body');
    expect(draftUpdate(original, form, form, 'New **body**').payload.body).toBe('New **body**');
  });

  it('keeps every sheet and only re-parses the edited one', () => {
    const sheets = [{ name: 'Budget', rows: [['Item', 'Cost'], ['Venue', 12000]] }, { name: 'Notes', rows: [['n']] }];
    const original = draft({ kind: 'spreadsheet', payload: { title: 'Q4', sheets } });
    const form = formFromDraft(original);
    const edited = { ...form, sheets: form.sheets.map((sheet, index) => index === 1 ? { ...sheet, csv: 'n\nsecond' } : sheet) };
    const request = draftUpdate(original, edited, form, null);
    expect(request.payload.sheets).toEqual([sheets[0], { name: 'Notes', rows: [['n'], ['second']] }]);
  });

  it('validates required fields per kind', () => {
    const email = formFromDraft(draft({}));
    expect(validateForm('email', { ...email, to: ' ' }, 'Body')).toEqual(['Recipient is required.']);
    expect(validateForm('email', email, '')).toEqual(['Message is required.']);
    expect(validateForm('email', { ...email, account: 'other' }, 'Body')).toEqual(['Choose the personal or CISAI account.']);
    const slack = formFromDraft(draft({ kind: 'slack', payload: { workspace: 'W', channel: '', body: 'x' } }));
    expect(validateForm('slack', slack, null)).toEqual(['Channel is required.']);
  });
});

describe('chat preview', () => {
  it('renders Slack formatting as elements, never as HTML', () => {
    const { container } = render(<MessagePreview flavor="slack" text={'*Kickoff* is _Monday_ ~old~ `code`\n> quoted\n<https://example.org/x|the page> <javascript:alert(1)|bad>\n<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('strong')?.textContent).toBe('Kickoff');
    expect(container.querySelector('em')?.textContent).toBe('Monday');
    expect(container.querySelector('s')?.textContent).toBe('old');
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.querySelector('blockquote')?.textContent).toBe('quoted');
    const links = [...container.querySelectorAll('a')];
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([['the page', 'https://example.org/x']]);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('renders WhatsApp monospace blocks and auto-links bare URLs without trailing punctuation', () => {
    const { container } = render(<MessagePreview flavor="whatsapp" text={'See https://example.org/agenda.\n```\nline one\nline two\n```'} />);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.org/agenda');
    expect(container.querySelector('pre')?.textContent).toBe('line one\nline two');
  });
});
