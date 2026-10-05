import { getCurrentUser } from "@/server/auth/session";
import { despatchDocument } from "@/server/services/edespatch";
import { isAppError } from "@/lib/errors";

/** e-İrsaliyenin NES görüntüsü (HTML göster / PDF indir) */
export async function GET(_req: Request, ctx: RouteContext<"/api/edespatch/incoming/[id]/[format]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Oturum gerekli", { status: 401 });
  const { id, format } = await ctx.params;
  if (format !== "pdf" && format !== "html") return new Response("Geçersiz biçim", { status: 400 });
  try {
    const { res, fileName } = await despatchDocument(user, id, format, "incoming");
    return new Response(res.body, {
      headers: {
        "Content-Type": format === "pdf" ? "application/pdf" : "text/html; charset=utf-8",
        "Content-Disposition": `${format === "pdf" ? "attachment" : "inline"}; filename="${encodeURIComponent(fileName)}"`,
        "Cache-Control": "private, no-store",
        ...(format === "html" ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:" } : {}),
      },
    });
  } catch (err) {
    return new Response(isAppError(err) ? err.message : "Belge alınamadı.", { status: isAppError(err) && err.code === "NOT_FOUND" ? 404 : isAppError(err) && err.code === "FORBIDDEN" ? 403 : 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
