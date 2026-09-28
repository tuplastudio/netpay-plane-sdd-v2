const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data: https:",
  // En dev Next usa eval (react-refresh) y websocket para HMR.
  process.env.NODE_ENV === "production"
    ? "connect-src 'self' https:"
    : "connect-src 'self' https: ws: wss:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Nota: `outputFileTracingRoot: import.meta.dirname` removido. Causaba que
  // Vercel no empaquetara `next/dist/server/node-environment.js` y el runtime
  // del serverless fallara con "Cannot find module './node-environment'"
  // cuando una página autenticada llamaba endpoints SSR. El middleware se
  // detectó igual porque Vercel resuelve este caso vía rootDirectory=apps/web.
  // Imagen Docker liviana: usa `output: "standalone"` solo cuando se hace
  // build con STANDALONE_BUILD=1 (Dockerfile lo setea). En Vercel queda
  // apagado para no chocar con su output tracing (rompía `vercel deploy
  // --prebuilt` con ENOENT en chunks de jest-worker).
  ...(process.env.STANDALONE_BUILD === "1" ? { output: "standalone" } : {}),
  poweredByHeader: false,
  // CSP compatible con la app actual: `layout.tsx` lleva un script inline de
  // tema y Next inyecta scripts inline de hidratación, así que script-src
  // conserva 'unsafe-inline' hasta implementar nonces. La página hosted de
  // `/pay/*` trae su propio CSP (mismo 'self' + 'unsafe-inline'); ambos se
  // aplican y la intersección sigue permitiéndola. No hay iframes propios.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
        ],
      },
    ];
  },
};

export default nextConfig;
