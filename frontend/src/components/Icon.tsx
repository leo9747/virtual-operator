import type { ReactNode } from 'react';

export type IconName = 'review' | 'compose' | 'sources' | 'connections' | 'check' | 'close' | 'refresh' | 'back' | 'download' | 'plus' | 'trash' | 'lock' | 'file' | 'arrow' | 'menu'
  | 'inbox' | 'mail' | 'chat' | 'update' | 'table' | 'info' | 'copy' | 'external' | 'link' | 'list' | 'numbered'
  | 'checklist' | 'quote' | 'codeblock' | 'divider' | 'undo' | 'redo' | 'history' | 'alert';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    review: <><path d="M8 6h11M8 12h11M8 18h11" /><path d="m3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2" /></>,
    compose: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
    sources: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
    connections: <><path d="M8 12h8M12 8v8" /><path d="M7 7H5a4 4 0 0 0 0 8h2M17 7h2a4 4 0 0 1 0 8h-2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    refresh: <><path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M18.5 9A7 7 0 0 0 6 6.5L4 11M5.5 15A7 7 0 0 0 18 17.5l2-4.5" /></>,
    back: <path d="m15 18-6-6 6-6" />,
    download: <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M4 17v3h16v-3" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    file: <><path d="M6 2h8l4 4v16H6Z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></>,
    arrow: <path d="m9 18 6-6-6-6" />,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    inbox: <><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5.5 5h13L21 13v6H3v-6Z" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    chat: <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />,
    update: <><path d="M4 7h10M4 12h7M4 17h6" /><path d="m14 15 2 2 4-4" /></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
    link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
    list: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth="2.6" /></>,
    numbered: <><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 5h1v4M4 9h2M4 14h2l-2 3h2" /></>,
    checklist: <><path d="m4 7 1.5 1.5L8 6M4 15l1.5 1.5L8 14" /><path d="M11 7h9M11 15h9" /></>,
    quote: <><path d="M5 18v-5a5 5 0 0 1 5-5" /><path d="M14 18v-5a5 5 0 0 1 5-5" /></>,
    codeblock: <path d="m9 8-4 4 4 4M15 8l4 4-4 4" />,
    divider: <><path d="M4 12h16" /><path d="M8 7h8M8 17h8" opacity=".45" /></>,
    undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,
    redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
    alert: <><path d="M12 3 2 20h20Z" /><path d="M12 10v4M12 17h.01" /></>,
  };

  return (
    <svg aria-hidden="true" className="icon" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">{paths[name]}</g>
    </svg>
  );
}
