export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => {
    const value = String(cell);
    return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }).join(',')).join('\n');
}

export function parseCsv(input: string): string[][] {
  if (!input.trim()) return [];

  const rows: string[][] = [[]];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === ',' && !quoted) {
      rows[rows.length - 1].push(cell);
      cell = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      rows[rows.length - 1].push(cell);
      cell = '';
      rows.push([]);
      continue;
    }

    cell += character;
  }

  rows[rows.length - 1].push(cell);

  while (rows.length && rows[rows.length - 1].every((value) => value === '')) {
    rows.pop();
  }

  return rows;
}
