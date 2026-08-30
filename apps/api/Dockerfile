# Imagen de la API.
#
# En dos etapas para que la imagen final no arrastre el compilador ni las
# dependencias de desarrollo: lo que se despliega es lo más pequeño que se pueda
# ejecutar, y cada dependencia que no viaja es una que no hay que parchear.
FROM node:22.20-alpine AS build

# `corepack` fija la versión de pnpm que declara el propio repositorio, para que
# la imagen no dependa de la que tenga instalada la máquina que la construye.
RUN corepack enable
WORKDIR /app

# Primero solo los manifiestos: mientras no cambien, la capa de dependencias se
# reutiliza y una compilación normal no vuelve a bajar nada.
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
RUN pnpm --filter @app-foundry/api... build

# El árbol de producción se resuelve aparte y se copia entero: `node_modules` de
# un monorepo con pnpm está lleno de enlaces simbólicos, y `deploy` lo convierte
# en un árbol plano que se puede copiar sin que se rompan.
RUN pnpm --filter @app-foundry/api deploy --prod --legacy /produccion

FROM node:22.20-alpine AS runtime

# Sin privilegios: si algún día se cuela una ejecución de código, que sea con las
# manos atadas.
RUN addgroup -S foundry && adduser -S foundry -G foundry
WORKDIR /app

COPY --from=build --chown=foundry:foundry /produccion/node_modules ./node_modules
COPY --from=build --chown=foundry:foundry /app/apps/api/dist ./dist
COPY --from=build --chown=foundry:foundry /app/packages/db/migrations ./migrations

USER foundry
ENV NODE_ENV=production
EXPOSE 3001

# El arranque carga la instrumentación **antes** que la aplicación: OpenTelemetry
# parchea los módulos al importarlos, y si Nest o `pg` se cargaran primero no
# habría trazas de nada.
CMD ["node", "--import", "./dist/observability/telemetry.js", "./dist/main.js"]
