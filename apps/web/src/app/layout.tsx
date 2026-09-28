import type { Metadata, Viewport } from "next";
import { Geist, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { PwaRegister } from "@/components/app/pwa-register";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
/** Titulares (`font-display`): Geist 500 con tracking negativo proporcional al tamaño. */
const geist = Geist({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Atiende ya",
  description: "Catálogo, cotizaciones y pedidos",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
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
  themeColor: "#090909",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Solo modo oscuro: la clase y el color-scheme van fijos desde el server.
    <html
      lang="es"
      className={`dark ${inter.variable} ${geist.variable}`}
      style={{ colorScheme: "dark" }}
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <PwaRegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
