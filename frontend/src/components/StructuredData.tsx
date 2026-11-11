import type { ReactNode } from 'react';

export function StructuredData({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="data-empty">Not provided</span>;
  if (typeof value === 'boolean') return <span className={`data-boolean ${value ? 'is-true' : 'is-false'}`}>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'string' || typeof value === 'number') return <span className="data-primitive">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="data-empty">None returned</span>;
    if (value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      return <ul className="data-list">{value.map((item, index) => <li key={index}>{String(item ?? 'Not provided')}</li>)}</ul>;
    }
    return <div className="data-array">{value.map((item, index) => <div className="data-array-item" key={index}><span className="data-index">Item {index + 1}</span><StructuredData depth={depth + 1} value={item} /></div>)}</div>;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return <span className="data-empty">No details returned</span>;
    return (
      <dl className={`data-record ${depth > 0 ? 'data-record-nested' : ''}`}>
        {entries.map(([key, child]): ReactNode => (
          <div className="data-property" key={key}>
            <dt>{key.replaceAll('_', ' ')}</dt>
            <dd><StructuredData depth={depth + 1} value={child} /></dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span>{String(value)}</span>;
}
