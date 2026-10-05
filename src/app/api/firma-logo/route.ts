import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { COMPANY_ID } from "@/server/company";

/** Firma logosu (yalnızca oturum açmış kullanıcılar; yazdırma şablonu ve firma sayfası) */
export async function GET() {
  if (!(await getCurrentUser())) return new Response("Oturum gerekli", { status: 401 });
  const logo = await db.companyLogo.findUnique({ where: { id: COMPANY_ID } });
  if (!logo) return new Response("Logo yok", { status: 404 });
  return new Response(new Uint8Array(logo.data), {
    headers: { "Content-Type": logo.mime, "Cache-Control": "private, max-age=300", "Content-Security-Policy": "default-src 'none'" },
  });
}
