/**
 * A CSV file from rows. Cells that a spreadsheet would run as a formula (starting =, +, -, @) get a
 * leading apostrophe, so an exported company name can never run anything when opened.
 */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Pence as pounds for a spreadsheet: 1250 → "12.50". */
export function poundsCell(pence: number): string {
  return (pence / 100).toFixed(2);
}
