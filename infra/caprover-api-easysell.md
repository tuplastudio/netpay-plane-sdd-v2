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
