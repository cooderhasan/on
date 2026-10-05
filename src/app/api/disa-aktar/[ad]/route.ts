import { getCurrentUser } from "@/server/auth/session";
import { EXPORTS } from "@/server/exports";
import { buildXlsx } from "@/server/xlsx";
import { isAppError } from "@/lib/errors";

/** Liste / rapor Excel çıktısı: /api/disa-aktar/<ad>?<ekrandaki filtreler> */
export async function GET(req: Request, ctx: RouteContext<"/api/disa-aktar/[ad]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Oturum gerekli", { status: 401 });
  const { ad } = await ctx.params;
  const build = Object.hasOwn(EXPORTS, ad) ? EXPORTS[ad] : undefined;
  if (!build) return new Response("Bulunamadı", { status: 404 });
  try {
    const { file, sheets } = await build(user, new URL(req.url).searchParams);
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
    const body = await buildXlsx(sheets);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${file}-${day}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (isAppError(err)) return new Response(err.message, { status: err.code === "FORBIDDEN" ? 403 : 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    console.error("[export]", err);
    return new Response("Dışa aktarma başarısız.", { status: 500 });
  }
}
