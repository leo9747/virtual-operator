export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status: number, detail: unknown = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
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

  if (!response.ok) throw new ApiError(errorMessage(text, response.status), response.status, errorDetail(text));
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
    throw new ApiError(errorMessage(text, response.status), response.status, errorDetail(text));
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get('Content-Disposition') ?? '') ?? fallbackFilename,
  };
}

/** Prefer the RFC 5987 `filename*` form, then the quoted or bare `filename` form. */
export function filenameFromDisposition(disposition: string): string | null {
  const extended = disposition.match(/filename\*\s*=\s*utf-8''([^;]+)/i);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Fall through to the plain parameter.
    }
  }
  const plain = disposition.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^";]+)/i);
  return plain ? (plain[1] ?? plain[2]).trim() : null;
}

/** Download an authenticated file through a short-lived object URL. */
export async function downloadFile(path: string, fallbackFilename: string): Promise<void> {
  const result = await apiBlob(path, fallbackFilename);
  const href = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = result.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function apiPath(path: string): string {
  return path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;
}

function errorDetail(text: string): unknown {
  try {
    return (JSON.parse(text) as { detail?: unknown }).detail;
  } catch {
    return undefined;
  }
}

function errorMessage(text: string, status: number): string {
  try {
    const body = JSON.parse(text) as { detail?: unknown; message?: unknown; error?: unknown };
    const detail = body.detail ?? body.message ?? body.error;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') {
      return detail.message;
    }
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
