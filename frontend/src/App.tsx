import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';
import { AccessGate } from './components/AccessGate';
import { Navigation } from './components/Navigation';
import { ComposeView } from './components/ComposeView';
import { ConnectionsView } from './components/ConnectionsView';
import { ReviewView } from './components/ReviewView';
import { SavedDraftsView } from './components/SavedDraftsView';
import { SourcesView } from './components/SourcesView';
import type { JsonRecord, View } from './types';

const views: View[] = ['review', 'saved', 'compose', 'sources', 'connections'];

function initialView(): View {
  const hash = window.location.hash.slice(1) as View;
  return views.includes(hash) ? hash : 'review';
}

export default function App() {
  const [view, setView] = useState<View>(initialView);
  const [authenticated, setAuthenticated] = useState(false);
  const [health, setHealth] = useState<'loading' | 'up' | 'down'>('loading');
  const [healthDetail, setHealthDetail] = useState('Same-origin /api');
  const [reviewRefresh, setReviewRefresh] = useState(0);

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
    const onHashChange = () => setView(initialView());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (next: View) => {
    setView(next);
    window.history.replaceState(null, '', `#${next}`);
  };

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
        {view === 'review' && <ReviewView key={reviewRefresh} />}
        {view === 'saved' && <SavedDraftsView />}
        {view === 'compose' && <ComposeView onCreated={() => { setReviewRefresh((value) => value + 1); navigate('review'); }} />}
        {view === 'sources' && <SourcesView />}
        {view === 'connections' && <ConnectionsView />}
      </main>
    </div>
  );
}
