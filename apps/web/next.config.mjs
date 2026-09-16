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
        ],
      },
    ];
  },
};

export default nextConfig;
