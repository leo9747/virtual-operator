import type { View } from '../types';
import { Icon } from './Icon';

const items: { id: View; label: string; icon: 'review' | 'file' | 'compose' | 'sources' | 'connections'; shortcut: string }[] = [
  { id: 'review', label: 'Review', icon: 'review', shortcut: '01' },
  { id: 'saved', label: 'Saved drafts', icon: 'file', shortcut: '02' },
  { id: 'compose', label: 'Compose', icon: 'compose', shortcut: '03' },
  { id: 'sources', label: 'Sources', icon: 'sources', shortcut: '04' },
  { id: 'connections', label: 'Connections', icon: 'connections', shortcut: '05' },
];

export function Navigation({ active, onNavigate, health, healthDetail, onRefreshHealth }: {
  active: View;
  onNavigate: (view: View) => void;
  health: 'loading' | 'up' | 'down';
  healthDetail: string;
  onRefreshHealth: () => void;
}) {
  return (
    <aside className="navigation-rail">
      <div className="brand">
        <span aria-hidden="true" className="brand-mark">VO</span>
        <span className="brand-copy"><strong>Virtual Operator</strong><small>Private workspace</small></span>
      </div>
      <nav aria-label="Primary navigation" className="primary-navigation">
        <p className="nav-section-label">Workspace</p>
        {items.map((item) => (
          <button
            aria-current={active === item.id ? 'page' : undefined}
            className={`nav-item ${active === item.id ? 'nav-item-active' : ''}`}
            key={item.id}
            onClick={() => onNavigate(item.id)}
            type="button"
          >
            <Icon name={item.icon} size={19} />
            <span>{item.label}</span>
            <span aria-hidden="true" className="nav-shortcut">{item.shortcut}</span>
          </button>
        ))}
      </nav>
      <div className="rail-footer">
        <div className="privacy-note"><Icon name="lock" size={15} /><span>Review before action</span></div>
        <button className="health-button" onClick={onRefreshHealth} title={`API health: ${healthDetail}`} type="button">
          <span aria-hidden="true" className={`health-dot health-${health}`} />
          <span><strong>{health === 'up' ? 'API available' : health === 'down' ? 'API unavailable' : 'Checking API'}</strong><small>{healthDetail}</small></span>
          <Icon name="refresh" size={14} />
        </button>
      </div>
    </aside>
  );
}
