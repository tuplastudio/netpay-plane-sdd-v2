import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { themeScript } from "@/components/theme-provider";
import { PwaRegister } from "@/components/app/pwa-register";

/** Inter: cuerpo, UI y titulares (peso 600). `font-display` es alias de esta misma fuente. */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
/** Geist Mono (`font-mono`): código, ids, SKUs, firmas. Nunca prosa. */
const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Easy Sell",
  description: "Catálogo, cotizaciones y pedidos",
  manifest: "/manifest.webmanifest",
  // Para LLM crawlers y agentes de IA: el estándar llmstxt.org propone
  // exponer dos archivos en la raíz del sitio — un índice navegable
  // (`llm.txt`) y el contenido completo en un solo markdown
  // (`llms-full.txt`). Así, un crawler que sigue un `<link rel="alternate">`
  // los descubre sin tener que rastrear el sitio entero.
  alternates: {
    types: {
      "text/plain": [
        { url: "/llm.txt", title: "Easy Sell MCP — índice navegable" },
        { url: "/llms-full.txt", title: "Easy Sell MCP — documentación completa" },
      ],
    },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Easy Sell",
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
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0e0d" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      // suppressHydrationWarning: el <head> tiene un script que muta
      // documentElement.className y .style.colorScheme ANTES del primer
      // render. React no debería quejarse por esa mutación de pre-hidratación.
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable}`}
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
