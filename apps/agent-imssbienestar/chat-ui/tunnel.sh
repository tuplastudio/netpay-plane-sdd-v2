#!/usr/bin/env bash
# Expone el chat de prueba (Vite en :5175) por localhost.run (SSH) y lo relanza si se cae.
# Uso: ./tunnel.sh      La URL https://<id>.lhr.life aparece en el log (cambia en cada reinicio).
# Sin contraseña ni página intermedia. Requiere salida SSH (puerto 22) hacia localhost.run.
while true; do
  ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
      -R 80:127.0.0.1:5175 nokey@localhost.run || true
  echo "tunnel caído, reintentando en 3 s…" >&2
  sleep 3
done
