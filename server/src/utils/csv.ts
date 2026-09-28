/** Cells starting with these are read as formulas by spreadsheet apps, so they get a leading quote. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
  // Player names and reasons are typed by players and staff; don't let a spreadsheet run them.
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV with a header row and a UTF-8 byte order mark, so Excel reads names correctly. */
export function toCsv<T>(rows: readonly T[], columns: ReadonlyArray<{ header: string; value: (row: T) => unknown }>): string {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
