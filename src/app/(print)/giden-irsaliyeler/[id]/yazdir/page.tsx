import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getWaybill } from "@/server/services/waybills";
import { getCompany } from "@/server/company";
import { orNotFound } from "@/server/page-helpers";
import { PrintButton } from "@/components/print-button";
import { qty } from "@/components/stock-views";
import { unitLabel } from "@/lib/units";

export const metadata: Metadata = { title: "İrsaliye yazdır" };

const fmt = (d: Date) => d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

/** Kağıt sevk irsaliyesi (fiyatsız). e-İrsaliye ileri fazda NES ile. */
export default async function Page(props: PageProps<"/giden-irsaliyeler/[id]/yazdir">) {
  const user = await requireUser("sales.read");
  const w = await orNotFound(getWaybill(user, (await props.params).id));
  if (w.direction !== "SALE") notFound();
  const company = await getCompany();
  const c = w.contact;
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
            <p className="text-xl font-bold uppercase">Sevk İrsaliyesi</p>
            {w.waybillNo && <p>No: {w.waybillNo}</p>}
            <p>Düzenleme: {fmt(w.issueDate)}</p>
            <p>Sevk: {fmt(w.dispatchDate)}</p>
          </div>
        </header>
        <section className="my-4 grid grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] font-bold uppercase text-gray-500">Alıcı</p>
            <p className="font-bold uppercase">{c.title}</p>
            <p>{[c.address, [c.district, c.city].filter(Boolean).join(" / ")].filter(Boolean).join(" ")}</p>
            <p>{c.taxOffice && `${c.taxOffice} V.D. `}{c.taxNumber && `${c.taxNumber.length === 11 ? "TCKN" : "VKN"}: ${c.taxNumber}`}</p>
          </div>
          {w.deliveryAddress && (
            <div>
              <p className="text-[10px] font-bold uppercase text-gray-500">Teslimat adresi</p>
              <p className="whitespace-pre-line">{w.deliveryAddress}</p>
            </div>
          )}
        </section>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-y border-black text-left text-[10px] uppercase"><th className="py-1.5">#</th><th>Hizmet / ürün</th><th className="text-right">Miktar</th></tr>
          </thead>
          <tbody>
            {w.lines.map((l, i) => (
              <tr key={l.id} className="border-b border-gray-300">
                <td className="py-1.5 pr-2">{i + 1}</td>
                <td className="pr-2">{l.name}</td>
                <td className="whitespace-nowrap text-right">{qty(l.quantity)} {unitLabel(l.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {w.notes && <p className="mt-6 whitespace-pre-line border-t border-gray-300 pt-2">{w.notes}</p>}
        <div className="mt-16 grid grid-cols-2 gap-12 text-center text-[11px]">
          <div className="border-t border-black pt-1">Teslim eden (ad soyad, imza)</div>
          <div className="border-t border-black pt-1">Teslim alan (ad soyad, imza)</div>
        </div>
      </article>
    </div>
  );
}
