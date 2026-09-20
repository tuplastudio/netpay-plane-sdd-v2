# CapRover vhost para api-easysell.tupla.dev

Este vhost permite HTTPS con cert real de Let's Encrypt para el backend
del proyecto, sin tocar los apps existentes de CapRover (formsbackend,
evo, logs, etc.).

## Setup (manual, ya ejecutado)

1. **Generar cert vía certbot ACME HTTP-01:**

   ```bash
   docker run --rm \
     -v /captain/data/letencrypt/etc:/out:rw \
     -v /captain/generated/static/domains/api-easysell.tupla.dev:/var/www/html:rw \
     certbot/certbot certonly \
     --webroot -w /var/www/html \
     -d api-easysell.tupla.dev \
     --non-interactive --agree-tos --email admin@tupla.dev \
     --config-dir /out/config --work-dir /out/work --logs-dir /out/logs
   ```

2. **Mover certs del path de certbot (`/out/config/live/...`) al path
   de captain (`/captain/data/letencrypt/etc/live/api-easysell.tupla.dev/`):**

   ```bash
   cp /captain/data/letencrypt/etc/config/live/api-easysell.tupla.dev/*.pem \
      /captain/data/letencrypt/etc/live/api-easysell.tupla.dev/
   ```

3. **Conectar captain-nginx al Docker network del backend (commerce-api
   no es visible desde captain-overlay-network):**

   ```bash
   docker network connect infra_netpay_internal captain-nginx
   ```

4. **Agregar server block en
   `/captain/generated/nginx/conf.d/captain.conf`:**

   ```nginx
   server {
       listen 80;
       listen 443 ssl;
       http2 on;
       server_name api-easysell.tupla.dev;
       client_max_body_size 500m;
       resolver 127.0.0.11 valid=10s;
       ssl_certificate     /letencrypt/etc/live/api-easysell.tupla.dev/fullchain.pem;
       ssl_certificate_key /letencrypt/etc/live/api-easysell.tupla.dev/privkey.pem;

       location /.well-known/acme-challenge/ {
           alias /usr/share/nginx/domains/api-easysell.tupla.dev/.well-known/acme-challenge/;
       }

       set $upstream http://commerce-api:4000;
       location / {
           proxy_pass $upstream;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

   ⚠️ **Trampa importante**: `root` en una location con prefijo le quita
   el prefijo al URI antes de agregar el filename — usar `alias` con el
   path completo para mantener `/.well-known/acme-challenge/`.

5. **Reload nginx (sin reiniciar el container):**

   ```bash
   docker kill -s HUP $(docker ps --format '{{.Names}}' | grep captain-nginx | head -1)
   ```

## Renovación automática del cert

Programar en cron del droplet:

```
0 3 * * * /usr/local/bin/certbot-renew-api-easysell.sh
```

Con el script:

```bash
#!/bin/bash
docker run --rm \
  -v /captain/data/letencrypt/etc:/out:rw \
  -v /captain/generated/static/domains/api-easysell.tupla.dev:/var/www/html:rw \
  certbot/certbot renew --webroot -w /var/www/html -d api-easysell.tupla.dev \
  --config-dir /out/config --work-dir /out/work --logs-dir /out/logs
# Si renovó, mover y reload nginx
if [ -f /out/config/live/api-easysell.tupla.dev/fullchain.pem ]; then
  cp /out/config/live/api-easysell.tupla.dev/fullchain.pem \
     /captain/data/letencrypt/etc/live/api-easysell.tupla.dev/
  cp /out/config/live/api-easysell.tupla.dev/privkey.pem \
     /captain/data/letencrypt/etc/live/api-easysell.tupla.dev/
  docker kill -s HUP $(docker ps --format "{{.Names}}" | grep captain-nginx | head -1)
fi
```

## Incidente 2026-09-20 y esquema actual (leer antes de tocar nginx)

El server block agregado a mano en `captain.conf` **desapareció**: CapRover
regenera ese archivo (quedaron `captain.conf` y `captain-*.conf` con fecha
nueva y un `.bak` del día anterior). Resultado: 443 servía el cert
self-signed de CapRover y 80 daba 404 → Vercel respondía
`502 BACKEND_UNREACHABLE` en todo `/api/v1/*` (login imposible) y Evolution
no podía entregar los webhooks (el bot no respondía). Los contenedores del
compose estaban sanos: el frente fue lo que cayó.

Esquema que quedó:

- El vhost vive en **su propio archivo**
  `/captain/generated/nginx/conf.d/api-easysell.conf` (nginx incluye
  `conf.d/*.conf`; CapRover regenera `captain.conf`, no borra archivos
  ajenos). Mismo contenido que el bloque de arriba, upstream por nombre de
  servicio con `resolver 127.0.0.11` y variable `$upstream` (un
  `upstream {}` con hostname rompería TODO nginx si el nombre no resolviera
  al recargar; el hairpin al IP público `:14000` desde el contenedor de
  nginx se queda colgado, no sirve como upstream).
- `docker network connect infra_netpay_internal captain-nginx` sigue siendo
  necesario y se pierde si CapRover recrea el contenedor.
- **`deploy-backend.yml` (paso "Asegurar vhost del API en captain-nginx")
  restaura ambas cosas en cada deploy**: conecta la red si falta, escribe el
  archivo si falta, `nginx -t` y `HUP`. Si el API vuelve a caer de frente
  sin deploy de por medio, basta con relanzar ese workflow
  (`workflow_dispatch`) o correr ese paso a mano.
- Cert vigente hasta 2026-12-10 (Let's Encrypt). Verificar que el cron de
  renovación de arriba exista en el droplet; el vhost sirve
  `/.well-known/acme-challenge/` para que `certbot renew --webroot` funcione.
