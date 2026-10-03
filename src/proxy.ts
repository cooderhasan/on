import { NextResponse, type NextRequest } from "next/server";

/**
 * İyimser kontrol: oturum çerezi yoksa girişe yönlendirir. Asıl doğrulama (oturum geçerli mi, yetki var mı)
 * her sayfada / action'da sunucu tarafında requireUser() ile yapılır — proxy tek başına güvenlik değildir.
 */
const PUBLIC = ["/giris", "/kurulum"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!request.cookies.has("oturum")) return NextResponse.redirect(new URL("/giris", request.url));
  return NextResponse.next();
}

export const config = {
  // Statik dosyalar, Next iç yolları ve API (kendi doğrulamasını yapar) hariç
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
