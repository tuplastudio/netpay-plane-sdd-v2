import type { Metadata, Viewport } from "next";
import { Geist, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { themeScript } from "@/components/theme-provider";
import { PwaRegister } from "@/components/app/pwa-register";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
/**
 * Titulares (`font-display`): Geist 500/600 con tracking muy negativo —
 * sustituto libre de una grotesca geométrica de display. Cuerpo, tablas y
 * controles se quedan en Inter con sus variantes OpenType (ver globals.css).
 */
const geist = Geist({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Atiende ya",
  description: "Catálogo, cotizaciones y pedidos",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Atiende ya",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover: deja que el contenido llegue bajo el notch/home
  // indicator en iOS; el padding para no chocar con esas zonas lo ponen los
  // componentes con `env(safe-area-inset-*)` donde haga falta.
  viewportFit: "cover",
  themeColor: "#0b0a09",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      // suppressHydrationWarning: el <head> tiene un script que muta
      // documentElement.className y .style.colorScheme ANTES del primer
      // render. React no debería quejarse por esa mutación de pre-hidratación.
      suppressHydrationWarning
      className={`${inter.variable} ${geist.variable}`}
    >
      <head>
        {/* Anti-flash: aplica la clase light/dark a <html> antes del primer
            paint. Ver theme-provider.tsx para el detalle. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <PwaRegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
