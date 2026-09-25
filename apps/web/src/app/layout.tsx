import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { themeScript } from "@/components/theme-provider";
import { PwaRegister } from "@/components/app/pwa-register";

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
  themeColor: "#5d52e0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      // suppressHydrationWarning: el <head> tiene un script que muta
      // documentElement.className y .style.colorScheme ANTES del primer
      // render. React no debería quejarse por esa mutación de pre-hidratación.
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable}`}
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
