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
  // El reverse proxy /api se hace en producción.
  // En dev usamos rewrite a localhost:4000 para evitar CORS.
  // /agent/:path* NO se reescribe acá: lo maneja
  // `src/app/agent/[...path]/route.ts`, que inyecta X-Internal-Key del lado
  // del servidor (un rewrite plano no puede agregar headers salientes).
  async rewrites() {
    const apiBase = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
    return [{ source: "/api/v1/:path*", destination: `${apiBase}/api/v1/:path*` }];
  },
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
