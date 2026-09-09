/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Imagen Docker liviana: copia solo lo necesario para `node server.js`.
  output: "standalone",
  // El reverse proxy /api se hace en producción.
  // En dev usamos rewrite a localhost:4000 para evitar CORS.
  // /agent/:path* NO se reescribe acá: lo maneja
  // `src/app/agent/[...path]/route.ts`, que inyecta X-Internal-Key del lado
  // del servidor (un rewrite plano no puede agregar headers salientes).
  async rewrites() {
    const apiBase = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
    return [{ source: "/api/v1/:path*", destination: `${apiBase}/api/v1/:path*` }];
  },
};

export default nextConfig;
