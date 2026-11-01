/** Minimal RFC 4180 CSV helpers. */

const CRLF = "\r\n";

/** Neutralizes spreadsheet formula injection (cells starting with = + - @ tab CR). */
function neutralize(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quoteRaw(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function quote(value: string): string {
  return quoteRaw(neutralize(value));
}

/**
 * Encodes rows without formula neutralisation. Only for data we send to our own importer
 * (e.g. an .xlsx converted in the browser), never for files users open in a spreadsheet.
 */
export function encodeCsvForImport(rows: string[][]): string {
  return rows.map((r) => r.map(quoteRaw).join(",")).join(CRLF) + CRLF;
}

export function toCsv(header: string[], rows: (string | number)[][]): string {
  return [header, ...rows].map((r) => r.map((c) => quote(String(c))).join(",")).join(CRLF) + CRLF;
}

/** Parses CSV text into rows of cells. Handles quoted fields, escaped quotes and CRLF. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}
