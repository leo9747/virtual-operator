import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import { AccessGate } from './components/AccessGate';
import { Navigation } from './components/Navigation';
import { ComposeView } from './components/ComposeView';
import { ConnectionsView } from './components/ConnectionsView';
import { InboxView } from './components/InboxView';
import { SourcesView } from './components/SourcesView';
import type { JsonRecord, View } from './types';

const views: View[] = ['inbox', 'compose', 'sources', 'connections'];

function initialView(): View {
  const hash = window.location.hash.slice(1) as View;
  // #review and #saved were the two separate queues before the unified inbox.
  return views.includes(hash) ? hash : 'inbox';
}

export default function App() {
  const [view, setView] = useState<View>(initialView);
  const [authenticated, setAuthenticated] = useState(false);
  const [health, setHealth] = useState<'loading' | 'up' | 'down'>('loading');
  const [healthDetail, setHealthDetail] = useState('Same-origin /api');
  const [inboxRefresh, setInboxRefresh] = useState(0);
  const unsaved = useRef(false);

  const checkHealth = useCallback(async (signal?: AbortSignal) => {
    setHealth('loading');
    try {
      const result = await apiFetch<JsonRecord>('/health', { signal });
      setHealth('up');
      setHealthDetail(typeof result?.status === 'string' ? result.status : 'Health check passed');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setHealth('down');
      setHealthDetail(error instanceof Error ? error.message : 'Health check failed');
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    void checkHealth(controller.signal);
    return () => controller.abort();
  }, [checkHealth, authenticated]);

  useEffect(() => {
    const onHashChange = () => {
      const next = initialView();
      if (unsaved.current && !window.confirm('You have unsaved changes. Discard them?')) {
        window.history.replaceState(null, '', `#${view}`);
        return;
      }
      unsaved.current = false;
      setView(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [view]);

  const navigate = (next: View) => {
    if (next !== view && unsaved.current && !window.confirm('You have unsaved changes. Discard them?')) return;
    if (next !== view) unsaved.current = false;
    setView(next);
    window.history.replaceState(null, '', `#${next}`);
  };
  const onDirtyChange = useCallback((dirty: boolean) => { unsaved.current = dirty; }, []);

  if (!authenticated) return <AccessGate onAuthenticated={() => setAuthenticated(true)} />;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Navigation
        active={view}
        health={health}
        healthDetail={healthDetail}
        onNavigate={navigate}
        onRefreshHealth={() => void checkHealth()}
      />
      <main className="workspace" id="main-content">
        {view === 'inbox' && <InboxView key={inboxRefresh} onCompose={() => navigate('compose')} onDirtyChange={onDirtyChange} />}
        {view === 'compose' && <ComposeView onCreated={() => { setInboxRefresh((value) => value + 1); navigate('inbox'); }} />}
        {view === 'sources' && <SourcesView />}
        {view === 'connections' && <ConnectionsView />}
      </main>
    </div>
  );
}
