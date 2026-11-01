import { encodeCsvForImport } from "./csv";

type Cell = string | number | boolean | Date | null | undefined | unknown;

/** Normalises one spreadsheet cell to the text the CSV importer expects (dates as YYYY-MM-DD). */
export function cellToText(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? "" : c.toISOString().slice(0, 10);
  return String(c).trim();
}

/** Converts sheet rows to CSV for the existing import endpoint; trailing blank rows are dropped. */
export function sheetToCsv(rows: Cell[][]): string {
  const text = rows.map((r) => r.map(cellToText));
  while (text.length && text[text.length - 1].every((c) => c === "")) text.pop();
  return encodeCsvForImport(text);
}

/**
 * Reads the first sheet of an .xlsx file in the browser. The parser is loaded on demand,
 * so it costs nothing until someone imports a spreadsheet.
 */
export async function xlsxFileToCsv(file: Blob): Promise<string> {
  const { readSheet } = await import("read-excel-file/universal");
  return sheetToCsv(await readSheet(file));
}
