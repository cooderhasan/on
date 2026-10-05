import "server-only";
import ExcelJS from "exceljs";

/** Excel (xlsx) dışa aktarma. Tutarlar Excel'de sayı hücresi olur (yalnızca gösterim; hesap Decimal ile yapılmıştır). */

export type CellValue = string | number | Date | { toString(): string } | null | undefined;
export interface XlsxColumn { header: string; width?: number; type?: "text" | "money" | "number" | "date" }
export interface XlsxSheet { name: string; title?: string; columns: XlsxColumn[]; rows: CellValue[][]; totals?: CellValue[] }

const MONEY_FMT = '#,##0.00;[Red]-#,##0.00';

function cell(v: CellValue, type: XlsxColumn["type"]) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (type === "money" || type === "number") {
    const n = Number(typeof v === "number" ? v : v.toString());
    return Number.isFinite(n) ? n : v.toString();
  }
  return typeof v === "string" ? v : v.toString();
}

export async function buildXlsx(sheets: XlsxSheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ön Muhasebe";
  wb.created = new Date();
  for (const s of sheets) {
    // Sayfa adı en fazla 31 karakter ve []:*?/\ içeremez
    const ws = wb.addWorksheet(s.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31));
    let r = 1;
    if (s.title) {
      ws.getCell(r, 1).value = s.title;
      ws.getCell(r, 1).font = { bold: true, size: 13 };
      r += 2;
    }
    const head = ws.getRow(r);
    s.columns.forEach((c, i) => {
      const h = head.getCell(i + 1);
      h.value = c.header;
      h.font = { bold: true, color: { argb: "FFFFFFFF" } };
      h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F3F4F" } };
      ws.getColumn(i + 1).width = c.width ?? (c.type === "money" ? 16 : c.type === "date" ? 12 : 24);
      if (c.type === "money") ws.getColumn(i + 1).numFmt = MONEY_FMT;
      if (c.type === "date") ws.getColumn(i + 1).numFmt = "dd.mm.yyyy";
    });
    ws.views = [{ state: "frozen", ySplit: r }];
    for (const row of s.rows) {
      r++;
      const xr = ws.getRow(r);
      row.forEach((v, i) => { xr.getCell(i + 1).value = cell(v, s.columns[i]?.type) as ExcelJS.CellValue; });
    }
    if (s.totals) {
      r++;
      const xr = ws.getRow(r);
      s.totals.forEach((v, i) => { xr.getCell(i + 1).value = cell(v, s.columns[i]?.type) as ExcelJS.CellValue; });
      xr.font = { bold: true };
      xr.border = { top: { style: "thin" } };
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
