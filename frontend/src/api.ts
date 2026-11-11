export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let accessKey = '';

export function setAccessKey(key: string): void {
  accessKey = key;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-VO-Key', accessKey);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(apiPath(path), {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  const text = await response.text();

  if (!response.ok) throw new ApiError(errorMessage(text, response.status), response.status);
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('The API returned an unreadable response.', response.status);
  }
}

export async function apiBlob(path: string, fallbackFilename = 'draft-artifact.xlsx') {
  const headers = new Headers({ 'X-VO-Key': accessKey });
  const response = await fetch(apiPath(path), { headers, credentials: 'same-origin' });
  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(errorMessage(text, response.status), response.status);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return {
    blob: await response.blob(),
    filename: match?.[1] ?? fallbackFilename,
  };
}

function apiPath(path: string): string {
  return path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;
}

function errorMessage(text: string, status: number): string {
  try {
    const body = JSON.parse(text) as { detail?: unknown; message?: unknown; error?: unknown };
    const detail = body.detail ?? body.message ?? body.error;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail.map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'msg' in item) return String(item.msg);
        return JSON.stringify(item);
      }).join('; ');
    }
    if (detail) return JSON.stringify(detail);
  } catch {
    if (text.trim()) return text.trim();
  }
  return `Request failed (${status}).`;
}
