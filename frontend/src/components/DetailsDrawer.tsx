import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

/** Supporting information (context, versions, hashes, audit) kept out of the way until asked for. */
export function DetailsDrawer({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<Element | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    heading.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div aria-hidden="true" className="drawer-backdrop" onClick={onClose} />
      <aside aria-labelledby="details-drawer-title" className="details-drawer">
        <header className="drawer-header">
          <div>
            <p className="eyebrow">Details</p>
            <h2 id="details-drawer-title" ref={heading} tabIndex={-1}>{title}</h2>
          </div>
          <button aria-label="Close details" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function DetailRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="detail-rows">
      {rows.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

export function Hash({ value }: { value: string }) {
  return <code className="hash" title={value}>{value ? `${value.slice(0, 12)}…${value.slice(-6)}` : 'Not recorded'}</code>;
}
