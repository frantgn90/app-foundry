# Imagen de la interfaz.
#
# El resultado es un puñado de ficheros estáticos, así que la imagen final no
# lleva Node: solo un servidor web y los ficheros. Es más pequeña y tiene menos
# superficie que mantener.
FROM node:22.20-alpine AS build

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/env/package.json packages/env/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @app-foundry/web... build

FROM nginx:1.29-alpine AS runtime

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
