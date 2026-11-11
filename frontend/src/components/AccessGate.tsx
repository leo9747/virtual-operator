import { useState, type FormEvent } from 'react';
import { apiFetch, setAccessKey } from '../api';
import type { JsonRecord } from '../types';

interface AccessGateProps {
  onAuthenticated: () => void;
}

export function AccessGate({ onAuthenticated }: AccessGateProps) {
  const [accessKey, setKeyInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checking || !accessKey) return;
    setChecking(true);
    setError('');
    setAccessKey(accessKey);
    try {
      await apiFetch<JsonRecord>('/health');
      onAuthenticated();
    } catch (cause) {
      setAccessKey('');
      setError(cause instanceof Error ? cause.message : 'Unable to authenticate with the local service.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="access-shell">
      <section className="access-card" aria-labelledby="access-title">
        <div className="brand-mark" aria-hidden="true">VO</div>
        <p className="eyebrow">Local draft console</p>
        <h1 id="access-title">Virtual Operator</h1>
        <p className="access-description">
          Enter the key from the service's <code>data/api.key</code> file. Nothing is loaded from your drafts until access is confirmed.
        </p>
        <form className="access-form" onSubmit={(event) => { void authenticate(event); }}>
          <label htmlFor="local-access-key">Local access key</label>
          <input
            id="local-access-key"
            name="local-access-key"
            type="password"
            value={accessKey}
            onChange={(event) => setKeyInput(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            disabled={checking}
            autoFocus
          />
          <button className="button button-primary" type="submit" disabled={checking}>
            {checking ? 'Checking access…' : 'Open console'}
          </button>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
        </form>
        <p className="access-footnote">The key stays in memory for this page only. Reloading asks again. It is never placed in the URL or persistent browser storage.</p>
      </section>
    </main>
  );
}
