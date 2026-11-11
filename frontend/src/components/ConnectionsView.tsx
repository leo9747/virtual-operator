import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { JsonRecord } from '../types';
import { EmptyState, ErrorState, LoadingState, PageHeader } from './Ui';
import { Icon } from './Icon';
import { StructuredData } from './StructuredData';

type RemoteState = { loading: boolean; error: string; data: unknown };
const initialRemote = { loading: true, error: '', data: null };

function connectionList(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is JsonRecord => !!item && typeof item === 'object');
  if (value && typeof value === 'object') {
    const list = (value as JsonRecord).connections ?? (value as JsonRecord).items;
    if (Array.isArray(list)) return list.filter((item): item is JsonRecord => !!item && typeof item === 'object');
  }
  return [];
}

export function ConnectionsView() {
  const [capabilities, setCapabilities] = useState<RemoteState>(initialRemote);
  const [connections, setConnections] = useState<RemoteState>(initialRemote);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    setCapabilities({ ...initialRemote });
    setConnections({ ...initialRemote });
    const [capabilityResult, connectionResult] = await Promise.allSettled([
      apiFetch<unknown>('/capabilities', { signal }),
      apiFetch<unknown>('/connections', { signal }),
    ]);
    if (signal.aborted) return;
    setCapabilities(capabilityResult.status === 'fulfilled'
      ? { loading: false, error: '', data: capabilityResult.value }
      : { loading: false, error: capabilityResult.reason instanceof Error ? capabilityResult.reason.message : 'Could not load capabilities.', data: null });
    setConnections(connectionResult.status === 'fulfilled'
      ? { loading: false, error: '', data: connectionResult.value }
      : { loading: false, error: connectionResult.reason instanceof Error ? connectionResult.reason.message : 'Could not load connections.', data: null });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [attempt, load]);

  const list = connectionList(connections.data);
  const hasStructuredConnectionResponse = !!(connections.data && typeof connections.data === 'object' && !list.length);

  return (
    <div className="view connections-view">
      <PageHeader actions={<button className="button button-secondary" onClick={() => setAttempt((value) => value + 1)} type="button"><Icon name="refresh" />Refresh status</button>} description="Read the backend’s current readiness and write-lock state. Status is never inferred from a successful login." eyebrow="Workspace / Connections" title="Connections & readiness" />
      <div className="connection-boundary"><Icon name="lock" size={18} /><div><strong>Write access is controlled by the backend.</strong><p>Capabilities below describe the latest API response. Unreported capabilities are not assumed to be available.</p></div></div>
      <section className="connections-section" aria-labelledby="capabilities-heading">
        <div className="section-heading"><div><p className="eyebrow">Current policy</p><h2 id="capabilities-heading">Capabilities & write locks</h2></div></div>
        {capabilities.loading && <LoadingState label="Reading backend capabilities" />}
        {!capabilities.loading && capabilities.error && <ErrorState message={capabilities.error} onRetry={() => setAttempt((value) => value + 1)} title="Capabilities are unavailable" />}
        {!capabilities.loading && !capabilities.error && <div className="capability-data"><StructuredData value={capabilities.data} /></div>}
      </section>
      <section className="connections-section" aria-labelledby="connections-heading">
        <div className="section-heading"><div><p className="eyebrow">Configured services</p><h2 id="connections-heading">Connection status</h2></div>{!connections.loading && !connections.error && list.length > 0 && <span>{list.length} connections returned</span>}</div>
        {connections.loading && <LoadingState label="Reading connection status" />}
        {!connections.loading && connections.error && <ErrorState message={connections.error} onRetry={() => setAttempt((value) => value + 1)} title="Connections are unavailable" />}
        {!connections.loading && !connections.error && !hasStructuredConnectionResponse && list.length === 0 && <EmptyState title="No connections returned"><p>The API returned no configured connections. Review the backend configuration rather than assuming a service is ready.</p></EmptyState>}
        {!connections.loading && !connections.error && list.length > 0 && (
          <div className="connection-list">
            {list.map((connection, index) => <article className="connection-record" key={String(connection.id ?? connection.name ?? index)}><div className="connection-record-heading"><h3>{String(connection.name ?? connection.service ?? connection.kind ?? `Connection ${index + 1}`)}</h3>{typeof connection.status === 'string' && <span>{connection.status.replaceAll('_', ' ')}</span>}</div><StructuredData value={connection} /></article>)}
          </div>
        )}
        {!connections.loading && !connections.error && hasStructuredConnectionResponse && <div className="capability-data"><StructuredData value={connections.data} /></div>}
      </section>
    </div>
  );
}
