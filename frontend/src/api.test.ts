// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiBlob, apiFetch, setAccessKey } from './api';

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessKey('');
  });

  it('uses an explicitly supplied key without persistent browser storage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    setAccessKey('runtime-test-key');

    await expect(apiFetch<{ ok: boolean }>('/health')).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/health');
    expect(new Headers(init.headers).get('X-VO-Key')).toBe('runtime-test-key');
    expect(init.credentials).toBe('same-origin');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('surfaces backend error detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Write access is locked' }), {
      status: 423,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(apiFetch('/drafts/draft-1/acknowledge', { method: 'POST' })).rejects.toThrow('Write access is locked');
  });

  it('downloads protected artifacts as blobs with the explicitly supplied key', async () => {
    setAccessKey('artifact-key');
    const response = new Response('xlsx', {
      status: 200,
      headers: { 'Content-Disposition': 'attachment; filename="renewals.xlsx"' },
    });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    const artifact = await apiBlob('/drafts/1/artifact');
    expect(artifact.filename).toBe('renewals.xlsx');
    expect(artifact.blob.size).toBe(4);
    expect(new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers).get('X-VO-Key')).toBe('artifact-key');
  });
});
