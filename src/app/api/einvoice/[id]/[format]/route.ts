import { getCurrentUser } from "@/server/auth/session";
import { eDocDocument } from "@/server/services/einvoice";
import { isAppError } from "@/lib/errors";

/** e-Belgenin NES'teki resmi görüntüsü (PDF indir / HTML göster). Oturum ve yetki kontrolü burada. */
export async function GET(_req: Request, ctx: RouteContext<"/api/einvoice/[id]/[format]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Oturum gerekli", { status: 401 });
  const { id, format } = await ctx.params;
  if (format !== "pdf" && format !== "html") return new Response("Geçersiz biçim", { status: 400 });
  try {
    const { res, fileName } = await eDocDocument(user, id, format);
    return new Response(res.body, {
      headers: {
        "Content-Type": format === "pdf" ? "application/pdf" : "text/html; charset=utf-8",
        "Content-Disposition": `${format === "pdf" ? "attachment" : "inline"}; filename="${encodeURIComponent(fileName)}"`,
        "Cache-Control": "private, no-store",
        // NES HTML'i kendi XSLT çıktısı: betik çalıştırmasına izin verme
        ...(format === "html" ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:" } : {}),
      },
    });
  } catch (err) {
    const msg = isAppError(err) ? err.message : "Belge alınamadı.";
    return new Response(msg, { status: isAppError(err) && err.code === "NOT_FOUND" ? 404 : 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
