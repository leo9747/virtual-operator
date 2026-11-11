import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="state-block loading-state" role="status">
      <span aria-hidden="true" className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state-block error-state" role="alert">
      <p className="state-title">{title}</p>
      <p>{message}</p>
      {onRetry && <button className="button button-secondary" onClick={onRetry} type="button"><Icon name="refresh" />Try again</button>}
    </div>
  );
}

export function EmptyState({ title, children, action }: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state-block empty-state">
      <span className="empty-mark"><Icon name="file" size={20} /></span>
      <p className="state-title">{title}</p>
      <div className="state-copy">{children}</div>
      {action}
    </div>
  );
}

export function Notice({ children, tone = 'neutral' }: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'error';
}) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase().replaceAll('_', ' ');
  const tone = /reject|fail|error|locked/.test(normalized)
    ? 'danger'
    : /ack|ready|connect|success|active/.test(normalized)
      ? 'success'
      : 'neutral';
  return <span className={`status-badge status-${tone}`}>{normalized}</span>;
}
