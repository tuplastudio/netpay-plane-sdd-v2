# Chat de prueba (assistant-ui) para agent-imssbienestar. Build estático +
# nginx que sirve el SPA y reenvía /agent/* al backend (mismo patrón que
# vite.config.ts en dev), inyectando X-Internal-Key server-side para que el
# navegador nunca la vea.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
