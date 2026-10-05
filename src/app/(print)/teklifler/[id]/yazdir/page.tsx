import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { getQuote } from "@/server/services/quotes";
import { orNotFound } from "@/server/page-helpers";
import { DocumentPrint } from "@/components/document-print";

export const metadata: Metadata = { title: "Teklif yazdır" };

export default async function Page(props: PageProps<"/teklifler/[id]/yazdir">) {
  const user = await requireUser("sales.read");
  const q = await orNotFound(getQuote(user, (await props.params).id));
  return (
    <DocumentPrint
      doc={{
        title: "Fiyat Teklifi",
        docNo: q.quoteNo,
        issueDate: q.issueDate,
        secondDate: q.validUntil ? { label: "Geçerlilik", value: q.validUntil } : null,
        currency: q.currency,
        notes: q.notes,
        contact: q.contact,
        amountForWords: q.payableTotal,
        lines: q.lines,
        totals: [
          ["Ara toplam", q.grossTotal],
          ["İndirim", q.discountTotal.negated(), q.discountTotal.greaterThan(0)],
          ["KDV", q.vatTotal],
          ["Genel toplam", q.payableTotal],
        ],
      }}
    />
  );
}