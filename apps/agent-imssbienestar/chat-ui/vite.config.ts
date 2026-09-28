import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// El navegador habla con /agent/* (mismo origen) y Vite lo reenvía al agente.
// Así no hay CORS y la X-Internal-Key nunca llega al bundle del navegador.
//   AGENT_URL           por defecto http://localhost:8011
//   AGENT_INTERNAL_KEY  solo si el agente corre con AGENT_INTERNAL_KEY
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.AGENT_URL || "http://localhost:8011";
  const key = env.AGENT_INTERNAL_KEY || "";
  return {
    plugins: [react()],
    server: {
      port: 5175,
      // Permite abrirlo por localtunnel (*.loca.lt, *.trycloudflare.com) en pruebas.
      allowedHosts: [".loca.lt", ".trycloudflare.com", ".lhr.life"],
      proxy: {
        "/agent": {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/agent/, ""),
          headers: key ? { "X-Internal-Key": key } : {},
        },
      },
    },
  };
});
