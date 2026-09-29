#!/bin/sh
# Corre automático: nginx:alpine ejecuta todo lo ejecutable en
# /docker-entrypoint.d/ (orden alfabético) antes de arrancar. Va después de
# 20-envsubst-on-templates.sh (que ya generó conf.d/default.conf).
set -eu

if [ -z "${WEBAUTH_USER:-}" ] || [ -z "${WEBAUTH_PASSWORD:-}" ]; then
    # nginx exige que auth_basic_user_file exista para poder arrancar.
    # Vacío = ninguna credencial matchea nunca (falla cerrado, nunca abierto).
    echo "WEBAUTH_USER/WEBAUTH_PASSWORD no configuradas; el chat queda bloqueado (fail closed)" >&2
    : > /etc/nginx/.htpasswd
    exit 0
fi

HASH=$(openssl passwd -apr1 "$WEBAUTH_PASSWORD")
if [ -z "$HASH" ]; then
    # openssl faltante/roto en la imagen: mejor bloqueado que un hash vacío
    # (que nginx trataría como "ninguna password calza", pero en silencio).
    echo "openssl no generó hash; el chat queda bloqueado (fail closed)" >&2
    : > /etc/nginx/.htpasswd
    exit 1
fi
printf '%s:%s\n' "$WEBAUTH_USER" "$HASH" > /etc/nginx/.htpasswd
