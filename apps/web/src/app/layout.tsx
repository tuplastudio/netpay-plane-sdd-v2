import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
/**
 * Fuente pesada para h1/h2 (`font-display`). Cuerpo, tablas y controles se
 * quedan en Inter: la densidad operativa del panel necesita una sans neutra,
 * no una display; el salto 700→400 entre título y cuerpo es la voz del
 * sistema (ver DESIGN-SYSTEM.md), no algo para usar en párrafos.
 */
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Easy Sell",
  description: "Catálogo, cotizaciones y pedidos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable}`}
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
