import { getCurrentUser } from "@/server/auth/session";
import { incomingDocument } from "@/server/services/incoming";
import { isAppError } from "@/lib/errors";

/** Gelen e-faturanın NES görüntüsü (HTML göster / PDF indir) */
export async function GET(req: Request, ctx: RouteContext<"/api/einvoice/incoming/[id]/[format]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Oturum gerekli", { status: 401 });
  const { id, format } = await ctx.params;
  if (format !== "pdf" && format !== "html") return new Response("Geçersiz biçim", { status: 400 });
  try {
    const { res, fileName } = await incomingDocument(user, id, format);
    return new Response(res.body, {
      headers: {
        "Content-Type": format === "pdf" ? "application/pdf" : "text/html; charset=utf-8",
        "Content-Disposition": `${format === "pdf" && new URL(req.url).searchParams.get("indir") ? "attachment" : "inline"}; filename="${encodeURIComponent(fileName)}"`,
        "Cache-Control": "private, no-store",
        ...(format === "html" ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:" } : {}),
      },
    });
  } catch (err) {
    return new Response(isAppError(err) ? err.message : "Belge alınamadı.", { status: isAppError(err) && err.code === "NOT_FOUND" ? 404 : 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
