import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import "./globals.css";

const roboto = Roboto({ variable: "--font-roboto", subsets: ["latin", "latin-ext"], weight: ["300", "400", "500", "700"] });
const robotoMono = Roboto_Mono({ variable: "--font-roboto-mono", subsets: ["latin", "latin-ext"], weight: ["400", "700"] });

export const metadata: Metadata = {
  title: { default: "Ön Muhasebe", template: "%s · Ön Muhasebe" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr" className={`${roboto.variable} ${robotoMono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
