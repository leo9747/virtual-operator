import type { ReactNode } from 'react';
import { isSafeHref } from '../markdown';

export type ChatFlavor = 'slack' | 'whatsapp';

// Order matters: code first so its contents are never formatted.
const patterns: Record<ChatFlavor, RegExp> = {
  slack: /(`[^`\n]+`|<(?:https?:\/\/|mailto:)[^|>\s]+(?:\|[^>\n]+)?>|(?<![\w*])\*(?!\s)[^*\n]+?(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)[^_\n]+?(?<!\s)_(?![\w_])|(?<![\w~])~(?!\s)[^~\n]+?(?<!\s)~(?![\w~])|https?:\/\/[^\s<>]+)/g,
  whatsapp: /(`[^`\n]+`|(?<![\w*])\*(?!\s)[^*\n]+?(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)[^_\n]+?(?<!\s)_(?![\w_])|(?<![\w~])~(?!\s)[^~\n]+?(?<!\s)~(?![\w~])|https?:\/\/[^\s<>]+)/g,
};

function ChatLink({ href, children }: { href: string; children: ReactNode }) {
  if (!isSafeHref(href)) return <>{children}</>;
  return <a className="artifact-link" href={href} rel="noopener noreferrer nofollow" target="_blank">{children}</a>;
}

function Inline({ text, flavor }: { text: string; flavor: ChatFlavor }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(patterns[flavor])) {
    const index = match.index ?? 0;
    const token = match[0];
    if (index > cursor) parts.push(text.slice(cursor, index));
    const key = `${index}-${token.length}`;
    const inner = token.slice(1, -1);
    if (token.startsWith('`')) parts.push(<code key={key}>{inner}</code>);
    else if (token.startsWith('<')) {
      const [href, label] = inner.split('|');
      parts.push(<ChatLink href={href} key={key}>{label || href}</ChatLink>);
    } else if (token.startsWith('*')) parts.push(<strong key={key}><Inline flavor={flavor} text={inner} /></strong>);
    else if (token.startsWith('_')) parts.push(<em key={key}><Inline flavor={flavor} text={inner} /></em>);
    else if (token.startsWith('~')) parts.push(<s key={key}><Inline flavor={flavor} text={inner} /></s>);
    else {
      const trimmed = token.replace(/[.,;:!?)]+$/, '');
      parts.push(<ChatLink href={trimmed} key={key}>{trimmed}</ChatLink>);
      if (trimmed.length < token.length) parts.push(token.slice(trimmed.length));
    }
    cursor = index + token.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/** A faithful-enough preview of how Slack mrkdwn or WhatsApp formatting will read. Never HTML. */
export function MessagePreview({ text, flavor }: { text: string; flavor: ChatFlavor }) {
  if (!text.trim()) return <p className="chat-empty">Nothing to preview yet.</p>;
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let paragraph: string[] = [];
  const flush = () => {
    if (!paragraph.length) return;
    blocks.push(<p className="chat-line" key={`p-${blocks.length}`}><Inline flavor={flavor} text={paragraph.join('\n')} /></p>);
    paragraph = [];
  };
  while (index < lines.length) {
    const line = lines[index];
    if (line.trimStart().startsWith('```')) {
      flush();
      const opening = line.trimStart().slice(3);
      const code: string[] = [];
      const closesOnSameLine = opening.endsWith('```') && opening.length >= 3;
      if (closesOnSameLine) {
        blocks.push(<pre className="chat-code" key={`c-${blocks.length}`}>{opening.slice(0, -3)}</pre>);
        index += 1;
        continue;
      }
      if (opening) code.push(opening);
      index += 1;
      while (index < lines.length && !lines[index].includes('```')) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        const tail = lines[index].slice(0, lines[index].indexOf('```'));
        if (tail) code.push(tail);
        index += 1;
      }
      blocks.push(<pre className="chat-code" key={`c-${blocks.length}`}>{code.join('\n')}</pre>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      blocks.push(<blockquote className="chat-quote" key={`q-${blocks.length}`}><Inline flavor={flavor} text={line.replace(/^>\s?/, '')} /></blockquote>);
      index += 1;
      continue;
    }
    if (!line.trim()) {
      flush();
      index += 1;
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  flush();
  return <div className={`chat-preview chat-${flavor}`}>{blocks}</div>;
}
