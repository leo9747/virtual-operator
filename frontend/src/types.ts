export type DraftKind = 'email' | 'notion' | 'slack' | 'whatsapp' | 'spreadsheet' | 'airtable';
export type View = 'review' | 'saved' | 'compose' | 'sources' | 'connections';
export type Account = 'personal' | 'cisai';

export interface ChangeEntry {
  field: string;
  before: string;
  after: string;
}

export interface ComposeValues {
  title: string;
  context: string;
  account: Account;
  instructions: string;
  destination: string;
  nativeTarget: '' | 'gmail' | 'google_sheets';
  to: string;
  cc: string;
  subject: string;
  body: string;
  workspace: string;
  channel: string;
  recipient: string;
  databaseTitle: string;
  pageId: string;
  baseId: string;
  table: string;
  recordId: string;
  changes: ChangeEntry[];
  spreadsheetTitle: string;
  rows: string;
}

export interface AuditEvent {
  id?: string | number;
  action?: string;
  event?: string;
  type?: string;
  timestamp?: string;
  created_at?: string;
  actor?: string;
  detail?: string;
  message?: string;
  [key: string]: unknown;
}

export interface Draft {
  id: string;
  kind: DraftKind;
  title: string;
  context: string;
  status: string;
  version: string | number;
  content_hash?: string;
  contentHash?: string;
  payload: Record<string, unknown>;
  native_target?: string | null;
  nativeTarget?: string | null;
  created_at?: string;
  updated_at?: string;
  audit_events?: AuditEvent[];
  audit?: AuditEvent[];
  events?: AuditEvent[];
  [key: string]: unknown;
}

export interface DraftRequest {
  kind: DraftKind;
  title: string;
  context: string;
  payload: Record<string, unknown>;
  native_target?: string | null;
}

export interface AgentRequest {
  kind: DraftKind;
  title: string;
  context: string;
  instructions: string;
  account: Account;
  destination: string;
}

export type JsonRecord = Record<string, unknown>;

export type SavedStatus = 'completed' | 'blocked' | 'skipped';
export type SavedFileKind = 'markdown' | 'csv' | 'xlsx';

export interface SavedFile {
  id: string;
  name: string;
  kind: SavedFileKind;
}

export interface SavedEntry {
  id: string;
  title: string;
  sourceUrl: string | null;
  status: SavedStatus;
  priority: string | null;
  due: string | null;
  blocker: string;
  files: SavedFile[];
}

export interface SavedCatalog {
  items: SavedEntry[];
  itemCount: number;
  fileCount: number;
  statusCounts: Partial<Record<SavedStatus, number>>;
  readOnly: boolean;
  externalWritesEnabled: boolean;
  source: string;
}

export type SavedContent =
  | { id: string; name: string; kind: 'markdown'; text: string }
  | { id: string; name: string; kind: 'csv'; headers: string[]; rows: string[][]; rowCount: number; hasMoreRows: boolean }
  | { id: string; name: string; kind: 'xlsx'; sheets: { name: string; rows: string[][]; hasMoreRows: boolean; hasMoreColumns: boolean }[]; formulasEvaluated: boolean; rowLimit: number; columnLimit: number; sheetPreviewLimit: number };
