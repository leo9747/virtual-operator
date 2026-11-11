import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './format';

describe('parseCsv', () => {
  it('parses quoted cells, escaped quotes, and multiline values', () => {
    expect(parseCsv('name,notes\nAda,"said ""hello"""\nGrace,"line one\nline two"')).toEqual([
      ['name', 'notes'],
      ['Ada', 'said "hello"'],
      ['Grace', 'line one\nline two'],
    ]);
  });
});

describe('toCsv', () => {
  it('round-trips cells containing separators, quotes, and newlines', () => {
    const rows = [['Name', 'Notes'], ['Ada', 'a,b'], ['Grace', 'said "hello"\nnext']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
