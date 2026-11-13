import type { View } from '../types';
import { Icon, type IconName } from './Icon';

const primary: { id: View; label: string; icon: IconName }[] = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
];

const tools: { id: View; label: string; icon: IconName }[] = [
  { id: 'compose', label: 'Compose', icon: 'compose' },
  { id: 'sources', label: 'Sources', icon: 'sources' },
  { id: 'connections', label: 'Connections', icon: 'connections' },
];

export function Navigation({ active, onNavigate, health, healthDetail, onRefreshHealth }: {
  active: View;
  onNavigate: (view: View) => void;
  health: 'loading' | 'up' | 'down';
  healthDetail: string;
  onRefreshHealth: () => void;
}) {
  const button = (item: { id: View; label: string; icon: IconName }) => (
    <button
      aria-current={active === item.id ? 'page' : undefined}
      className={`nav-item ${active === item.id ? 'nav-item-active' : ''} ${item.id === 'inbox' ? 'nav-item-primary' : ''}`}
      key={item.id}
      onClick={() => onNavigate(item.id)}
      type="button"
    >
      <Icon name={item.icon} size={19} />
      <span>{item.label}</span>
    </button>
  );
  return (
    <aside className="navigation-rail">
      <div className="brand">
        <span aria-hidden="true" className="brand-mark">VO</span>
        <span className="brand-copy"><strong>Virtual Operator</strong><small>Private workspace</small></span>
      </div>
      <nav aria-label="Primary navigation" className="primary-navigation">
        {primary.map(button)}
        <p className="nav-section-label">Tools</p>
        {tools.map(button)}
      </nav>
      <div className="rail-footer">
        <div className="privacy-note"><Icon name="lock" size={15} /><span>Nothing is sent from here</span></div>
        <button className="health-button" onClick={onRefreshHealth} title={`API health: ${healthDetail}`} type="button">
          <span aria-hidden="true" className={`health-dot health-${health}`} />
          <span><strong>{health === 'up' ? 'API available' : health === 'down' ? 'API unavailable' : 'Checking API'}</strong><small>{healthDetail}</small></span>
          <Icon name="refresh" size={14} />
        </button>
      </div>
    </aside>
  );
}
