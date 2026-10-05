import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getInvoice } from "@/server/services/invoices";
import { orNotFound } from "@/server/page-helpers";
import { DocumentPrint } from "@/components/document-print";

export const metadata: Metadata = { title: "Fatura yazdır" };

export default async function Page(props: PageProps<"/satislar/[id]/yazdir">) {
  const user = await requireUser("sales.read");
  const inv = await orNotFound(getInvoice(user, (await props.params).id));
  if (inv.direction !== "SALE") notFound();
  const wh = inv.withholdingTotal.greaterThan(0);
  return (
    <DocumentPrint
      doc={{
        title: inv.kind === "RETURN" ? "İade Faturası" : "Fatura",
        docNo: inv.invoiceNo,
        issueDate: inv.issueDate,
        secondDate: { label: "Vade", value: inv.dueDate },
        currency: inv.currency,
        notes: inv.notes,
        contact: inv.contact,
        contactId: inv.contactId,
        amountForWords: inv.payableTotal,
        lines: inv.lines,
        totals: [
          ["Ara toplam", inv.grossTotal],
          ["İndirim", inv.discountTotal.negated(), inv.discountTotal.greaterThan(0)],
          ["ÖTV", inv.otvTotal, inv.otvTotal.greaterThan(0)],
          ["KDV", inv.vatTotal],
          ["Genel toplam", inv.grandTotal],
          ["Tevkifat", inv.withholdingTotal.negated(), wh],
          ["Ödenecek", inv.payableTotal, wh],
        ],
      }}
    />
  );
}