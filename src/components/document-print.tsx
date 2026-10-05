import type { ReactNode } from "react";
import { getCompany } from "@/server/company";
import { Money } from "./money";
import { unitLabel } from "@/lib/units";
import { PrintButton } from "./print-button";
import Decimal from "decimal.js";
import { getPrintSettings, printBankAccounts } from "@/server/services/print-settings";
import { contactBalance } from "@/server/services/ledger";
import { amountInWords } from "@/lib/ubl";
import { formatIban } from "@/lib/iban";

const fmt = (d: Date) => d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

interface PrintDoc {
  title: string;
  docNo: string | null;
  issueDate: Date;
  secondDate?: { label: string; value: Date } | null;
  currency: string;
  notes: string | null;
  contact: { title: string; address: string | null; district: string | null; city: string | null; taxOffice: string | null; taxNumber: string | null; email: string | null; phone: string | null };
  lines: Array<{ id: string; name: string; description: string | null; quantity: { toString(): string }; unit: string; unitPrice: { toString(): string }; vatRate: number; discountAmount: { toString(): string; greaterThan(n: number): boolean }; totalAmount: { toString(): string } }>;
  totals: Array<[string, { toString(): string }, boolean?]>;
  /** "YALNIZ …" satırı için (ödenecek tutar) */
  amountForWords?: { toString(): string };
  /** Faturada müşteri bakiyesi gösterilecekse */
  contactId?: string;
  footer?: ReactNode;
}

/** A4 yazdırma görünümü (kağıt fatura, proforma, teklif). e-Belgeler NES'in resmi görüntüsüyle yazdırılır (Faz 3). */
export async function DocumentPrint({ doc }: { doc: PrintDoc }) {
  const [company, settings] = await Promise.all([getCompany(), getPrintSettings()]);
  const [banks, balance] = await Promise.all([
    printBankAccounts(settings.bankAccountIds),
    settings.showContactBalance && doc.contactId ? contactBalance(doc.contactId) : Promise.resolve(null),
  ]);
  const c = doc.contact;
  return (
    <div className="min-h-dvh bg-[#e4e4e4] py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] justify-end gap-2 px-4 print:hidden"><PrintButton /></div>
      <article className="mx-auto max-w-[210mm] bg-white p-[14mm] text-[12px] leading-relaxed text-black shadow print:shadow-none">
        <header className="flex justify-between gap-8 border-b-2 border-black pb-4">
          <div>
            <p className="text-base font-bold uppercase">{company?.title ?? "Firma bilgisi girilmedi"}</p>
            {company && (
              <>
                <p>{[company.address, [company.district, company.city].filter(Boolean).join(" / ")].filter(Boolean).join(" ")}</p>
                <p>{company.taxOffice && `${company.taxOffice} V.D. `}{company.taxNumber && `${company.taxNumber.length === 11 ? "TCKN" : "VKN"}: ${company.taxNumber}`}</p>
                <p>{[company.phone, company.email].filter(Boolean).join(" · ")}</p>
              </>
            )}
          </div>
          <div className="text-right">
            <p className="text-xl font-bold uppercase">{doc.title}</p>
            {doc.docNo && <p>No: {doc.docNo}</p>}
            <p>Tarih: {fmt(doc.issueDate)}</p>
            {doc.secondDate && <p>{doc.secondDate.label}: {fmt(doc.secondDate.value)}</p>}
          </div>
        </header>
        <section className="my-4">
          <p className="text-[10px] font-bold uppercase text-gray-500">Sayın</p>
          <p className="font-bold uppercase">{c.title}</p>
          <p>{[c.address, [c.district, c.city].filter(Boolean).join(" / ")].filter(Boolean).join(" ")}</p>
          <p>{c.taxOffice && `${c.taxOffice} V.D. `}{c.taxNumber && `${c.taxNumber.length === 11 ? "TCKN" : "VKN"}: ${c.taxNumber}`}</p>
        </section>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-y border-black text-left text-[10px] uppercase">
              <th className="py-1.5">#</th><th>Hizmet / ürün</th><th className="text-right">Miktar</th><th className="text-right">Birim fiyat</th><th className="text-right">KDV</th><th className="text-right">Tutar</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={l.id} className="border-b border-gray-300 align-top">
                <td className="py-1.5 pr-2">{i + 1}</td>
                <td className="pr-2">{l.name}{l.description && <span className="block text-[10px] text-gray-600">{l.description}</span>}{l.discountAmount.greaterThan(0) && <span className="block text-[10px] text-gray-600">İndirim: −<Money value={l.discountAmount} currency={doc.currency} /></span>}</td>
                <td className="whitespace-nowrap text-right">{l.quantity.toString().replace(".", ",")} {unitLabel(l.unit)}</td>
                <td className="text-right"><Money value={l.unitPrice} currency={doc.currency} unitPrice /></td>
                <td className="text-right">%{l.vatRate}</td>
                <td className="text-right"><Money value={l.totalAmount} currency={doc.currency} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex justify-end">
          <dl className="w-64">
            {doc.totals.filter((t) => t[2] !== false).map(([label, v]) => (
              <div key={label} className="flex justify-between border-b border-gray-300 py-1"><dt className="font-semibold">{label}</dt><dd><Money value={v} currency={doc.currency} /></dd></div>
            ))}
          </dl>
        </div>
        {settings.showAmountInWords && doc.amountForWords && (
          <p className="mt-3 text-right text-[11px] font-semibold">YALNIZ: {amountInWords(new Decimal(doc.amountForWords.toString()), doc.currency)}</p>
        )}
        {balance && <p className="mt-2 text-right text-[11px]">Güncel bakiyeniz: <Money value={balance} currency={doc.currency} /> {balance.isNegative() ? "(alacaklısınız)" : "(borçlusunuz)"}</p>}
        {doc.notes && <p className="mt-6 whitespace-pre-line border-t border-gray-300 pt-2">{doc.notes}</p>}
        {banks.length > 0 && (
          <section className="mt-6 border-t border-gray-300 pt-2 text-[11px]">
            <p className="text-[10px] font-bold uppercase text-gray-500">Banka bilgileri</p>
            {banks.map((b) => <p key={b.id}>{[b.bankName ?? b.name, b.branch].filter(Boolean).join(" / ")} · {b.currency} · <span className="font-mono">{formatIban(b.iban!)}</span></p>)}
          </section>
        )}
        {settings.footerNote && <p className="mt-4 whitespace-pre-line text-[11px] text-gray-700">{settings.footerNote}</p>}
        {settings.showSignature && (
          <div className="mt-16 grid grid-cols-2 gap-12 text-center text-[11px]">
            <div className="border-t border-black pt-1">Teslim eden</div>
            <div className="border-t border-black pt-1">Teslim alan</div>
          </div>
        )}
        {doc.footer}
      </article>
    </div>
  );
}
