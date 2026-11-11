/** Clipboard writes for drafts the user sends themselves. Rich HTML when available. */
export async function copyToClipboard(plain: string, html = ''): Promise<void> {
  const clipboard = navigator.clipboard;
  if (html && clipboard?.write && typeof ClipboardItem !== 'undefined') {
    await clipboard.write([new ClipboardItem({
      'text/plain': new Blob([plain], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    })]);
    return;
  }
  if (clipboard?.writeText) {
    await clipboard.writeText(plain);
    return;
  }
  throw new Error('Clipboard access is not available in this browser. Select the text and copy it instead.');
}

/** Tab-separated rows paste cleanly into spreadsheet cells. */
export function toTsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => cell.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
}
