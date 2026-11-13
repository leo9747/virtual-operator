import type { Draft, DraftKind, InboxGroup, InboxItem, JsonRecord, SavedEntry, SavedStatus } from './types';

export const FINAL_STATUS = /acknowledged|rejected|sent|published|completed|approved/i;

export const kindLabels: Record<DraftKind, string> = {
  email: 'Email', slack: 'Slack', whatsapp: 'WhatsApp', notion: 'Notion update',
  airtable: 'Airtable update', spreadsheet: 'Spreadsheet',
};

export const documentStatusLabels: Record<SavedStatus, string> = {
  completed: 'Ready', blocked: 'Needs input', skipped: 'Skipped',
};

export function groupForKind(kind: DraftKind): InboxGroup {
  if (kind === 'email' || kind === 'slack' || kind === 'whatsapp') return 'message';
  if (kind === 'notion' || kind === 'airtable') return 'update';
  return 'document';
}

/** Render any payload value as display text; arrays become comma-separated lists. */
export function displayText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(displayText).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Collapse Markdown/chat formatting into a one-line plain preview. */
export function plainPreview(text: string, limit = 160): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\[[ xX]\]\s+/g, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1).trimEnd()}…` : plain;
}

export function taskName(entry: SavedEntry): string {
  return entry.title.replace(/\s*\[Priority:\s*[^\]]+\]\s*$/, '');
}

export function priorityLabel(entry: SavedEntry): string | null {
  return !entry.priority || entry.priority.toLowerCase() === 'unrated' ? null : entry.priority;
}

function changeCount(payload: JsonRecord): number {
  return Array.isArray(payload.changes) ? payload.changes.length : 0;
}

function draftLabel(draft: Draft): string {
  const p = draft.payload;
  switch (draft.kind) {
    case 'email': return `Email${displayText(p.to) ? ` · to ${displayText(p.to)}` : ''}`;
    case 'slack': return `Slack${displayText(p.channel) ? ` · ${displayText(p.channel)}` : ''}`;
    case 'whatsapp': return `WhatsApp${displayText(p.recipient) ? ` · ${displayText(p.recipient)}` : ''}`;
    case 'notion': return `Notion${displayText(p.database_title) ? ` · ${displayText(p.database_title)}` : ''}`;
    case 'airtable': return `Airtable${displayText(p.table) ? ` · ${displayText(p.table)}` : ''}`;
    case 'spreadsheet': return 'Spreadsheet';
  }
}

function draftPreview(draft: Draft): string {
  const p = draft.payload;
  switch (draft.kind) {
    case 'email': return plainPreview([displayText(p.subject), displayText(p.body)].filter(Boolean).join(' — '));
    case 'slack':
    case 'whatsapp': return plainPreview(displayText(p.body));
    case 'notion':
    case 'airtable': {
      const count = changeCount(p);
      const fields = Array.isArray(p.changes)
        ? p.changes.map((change) => displayText((change as JsonRecord)?.field)).filter(Boolean).join(', ')
        : '';
      return `${count} field ${count === 1 ? 'change' : 'changes'}${fields ? `: ${fields}` : ''}`;
    }
    case 'spreadsheet': {
      const sheets = Array.isArray(p.sheets) ? p.sheets : [];
      const rows = sheets.reduce((total: number, sheet) => total + (
        sheet && typeof sheet === 'object' && Array.isArray((sheet as JsonRecord).rows) ? ((sheet as JsonRecord).rows as unknown[]).length : 0
      ), 0);
      return `${displayText(p.title) || 'Workbook'} · ${rows} ${rows === 1 ? 'row' : 'rows'}`;
    }
  }
}

export function draftItem(draft: Draft): InboxItem {
  return {
    key: `draft:${draft.id}`,
    source: 'draft',
    group: groupForKind(draft.kind),
    label: draftLabel(draft),
    title: draft.title,
    preview: draftPreview(draft),
    time: String(draft.created_at ?? draft.updated_at ?? ''),
    open: !FINAL_STATUS.test(draft.status),
    status: draft.status,
    draft,
  };
}

export function documentItem(entry: SavedEntry): InboxItem {
  const files = entry.files.map((file) => file.name).join(', ');
  return {
    key: `document:${entry.id}`,
    source: 'document',
    group: 'document',
    label: `Document${entry.files.length > 1 ? ` · ${entry.files.length} files` : ''}`,
    title: taskName(entry),
    preview: entry.status === 'blocked' && entry.blocker ? plainPreview(entry.blocker) : files,
    time: entry.modifiedAt,
    open: entry.status !== 'skipped',
    status: entry.status,
    entry,
  };
}

/** Newest first; items without a usable timestamp sink to the end, in stable order. */
export function sortItems(items: InboxItem[]): InboxItem[] {
  const stamp = (item: InboxItem) => {
    const value = Date.parse(item.time);
    return Number.isNaN(value) ? -Infinity : value;
  };
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => stamp(b.item) - stamp(a.item) || a.index - b.index)
    .map(({ item }) => item);
}

export type InboxFilter = 'all' | InboxGroup;

/** `keepKey` keeps the open reader's item listed after it is reviewed, until the user moves on. */
export function filterItems(items: InboxItem[], filter: InboxFilter, showClosed: boolean, query: string, keepKey?: string): InboxItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => (showClosed || item.open || item.key === keepKey)
    && (filter === 'all' || item.group === filter)
    && (!needle || `${item.title} ${item.label} ${item.preview} ${item.status}`.toLowerCase().includes(needle)));
}

/** Calendar-day buckets in the viewer's local time zone. */
export function dayGroup(time: string, now = new Date()): string {
  const value = new Date(time);
  if (Number.isNaN(value.getTime())) return 'Undated';
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(value)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}

export function relativeTime(time: string, now = new Date()): string {
  const value = new Date(time);
  if (Number.isNaN(value.getTime())) return '';
  const seconds = Math.round((now.getTime() - value.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return value.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: value.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function absoluteTime(time: string): string {
  const value = new Date(time);
  return Number.isNaN(value.getTime()) ? 'Not recorded' : value.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
