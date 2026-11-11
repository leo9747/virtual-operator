import { createElement, useState } from 'react';
import type { ReactNode } from 'react';
import type { SavedContent } from '../types';

const inlinePattern = /(!?\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s<>]+|`[^`\n]+`|\*\*[^*\n]+\*\*)/g;

export function InlineText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    const token = match[0];
    if (index > cursor) parts.push(text.slice(cursor, index));
    const key = `${index}-${token.length}`;
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={key}><InlineText text={token.slice(2, -2)} /></strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[') || token.startsWith('![')) {
      const split = token.lastIndexOf('](');
      const label = token.slice(token.startsWith('![') ? 2 : 1, split);
      const href = token.slice(split + 2, -1);
      if (!/^https?:\/\//i.test(href)) {
        parts.push(token);
      } else if (token.startsWith('![')) {
        parts.push(<span key={key}>Image: {label} (<SafeLink href={href}>source</SafeLink>)</span>);
      } else {
        parts.push(<SafeLink href={href} key={key}>{label || 'Source link'}</SafeLink>);
      }
    } else {
      parts.push(<SafeLink href={token} key={key}>{token}</SafeLink>);
    }
    cursor = index + token.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function SafeLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="artifact-link" href={href} rel="noopener noreferrer" target="_blank">{children}</a>;
}

function rowCells(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
    return trimmed.slice(1, -1).split(/(?<!\\)\|/)
      .map(cell => cell.trim().replaceAll('\\|', '|'));
  }
  return [line];
}

export function MarkdownDocument({ text }: { text: string }) {
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let index = 0;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p className="artifact-paragraph" key={`p-${blocks.length}`}><InlineText text={paragraph.join('\n')} /></p>);
    paragraph = [];
  };
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }
    if (line.trimStart().startsWith('```')) {
      flushParagraph();
      const marker = line.trimStart().slice(0, 3);
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith(marker)) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre className="artifact-code" key={`code-${blocks.length}`}>{code.join('\n')}</pre>);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      blocks.push(createElement(`h${heading[1].length}`, {
        key: `h-${blocks.length}`, className: 'artifact-heading',
      }, <InlineText text={heading[2]} />));
      index += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushParagraph();
      blocks.push(<blockquote key={`quote-${blocks.length}`}><InlineText text={line.replace(/^\s*>\s?/, '')} /></blockquote>);
      index += 1;
      continue;
    }
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      flushParagraph();
      blocks.push(<hr key={`hr-${blocks.length}`} />);
      index += 1;
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      const items: ReactNode[] = [];
      const itemPattern = isOrdered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      while (index < lines.length) {
        const match = lines[index].match(itemPattern);
        if (!match) break;
        const checkbox = match[1].match(/^\[([ xX])\]\s+(.*)$/);
        items.push(<li className={checkbox ? 'artifact-check-item' : undefined} key={`item-${index}`}>
          {checkbox ? <span aria-hidden="true" className="artifact-checkbox">{checkbox[1].toLowerCase() === 'x' ? '☑' : '□'}</span> : null}
          <InlineText text={checkbox ? checkbox[2] : match[1]} />
        </li>);
        index += 1;
      }
      blocks.push(createElement(isOrdered ? 'ol' : 'ul', {
        key: `list-${blocks.length}`, className: 'artifact-list',
      }, items));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && index + 1 < lines.length && /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[index + 1])) {
      flushParagraph();
      const headers = rowCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        rows.push(rowCells(lines[index]));
        index += 1;
      }
      blocks.push(<TabularData caption="Markdown table" headers={headers} key={`table-${blocks.length}`} rows={rows} />);
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  flushParagraph();
  return <article className="artifact-markdown">{blocks}</article>;
}

export function TabularData({ caption, headers, rows }: {
  caption: string;
  headers: string[];
  rows: string[][];
}) {
  if (!headers.length && !rows.length) return <p className="inline-empty">This table contains no stored data.</p>;
  const columnCount = Math.max(headers.length, ...rows.map(row => row.length), 1);
  return <div aria-label={caption} className="artifact-table-scroll" role="region" tabIndex={0}>
    <table className="artifact-table">
      <caption className="sr-only">{caption}</caption>
      <thead><tr>{Array.from({ length: columnCount }, (_, i) =>
        <th aria-label={headers[i] || `Column ${i + 1}`} key={i} scope="col">{headers[i] ?? ''}</th>)}</tr></thead>
      <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>
        {Array.from({ length: columnCount }, (_, columnIndex) =>
          <td key={columnIndex}>{row[columnIndex] ?? ''}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

export function WorkbookDocument({ content }: { content: Extract<SavedContent, { kind: 'xlsx' }> }) {
  const [activeSheet, setActiveSheet] = useState(0);
  const sheet = content.sheets[activeSheet];
  return <div className="workbook-document">
    <div aria-label="Workbook sheets" className="sheet-tabs" role="tablist">
      {content.sheets.map((item, index) => <button
        aria-selected={index === activeSheet} className={index === activeSheet ? 'sheet-tab active' : 'sheet-tab'}
        key={item.name} onClick={() => setActiveSheet(index)} role="tab" type="button"
      >{item.name}</button>)}
    </div>
    <p className="artifact-format-note">Stored values only. Formulas are not executed, and workbook links are not fetched. Preview is limited to {content.rowLimit} rows and {content.columnLimit} columns per sheet.</p>
    {sheet && <>
      <TabularData caption={`${sheet.name} worksheet`} headers={sheet.rows[0] ?? []} rows={sheet.rows.slice(1)} />
      {(sheet.hasMoreRows || sheet.hasMoreColumns) && <p className="artifact-format-note">This sheet continues beyond the preview. Download the original workbook to inspect the rest.</p>}
    </>}
  </div>;
}

export function SavedDocument({ content }: { content: SavedContent }) {
  if (content.kind === 'markdown') return <MarkdownDocument text={content.text} />;
  if (content.kind === 'csv') {
    const rows = content.headers.length && !content.rows.length ? [] : content.rows;
    return <>
      <p className="artifact-format-note">{content.rowCount} data rows in the source CSV.</p>
      <TabularData caption={`${content.name} CSV data`} headers={content.headers} rows={rows} />
      {content.hasMoreRows && <p className="artifact-format-note">Only the first 200 rows are shown. Download the original CSV to inspect the remainder.</p>}
    </>;
  }
  return <WorkbookDocument content={content} />;
}
