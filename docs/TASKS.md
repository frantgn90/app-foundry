# App Foundry — Tareas

- **Documentos origen:** [REQUIREMENTS.md](./REQUIREMENTS.md) · [TRD.md](./TRD.md)
- **Método:** una tarea es la unidad más pequeña que se puede **verificar por separado**. Cada una lleva su
  criterio de verificación y termina en un commit propio.
- **Refinamiento progresivo:** solo se desglosa en detalle el hito en curso. Los siguientes se mantienen a
  grano grueso y se detallan al cerrar el anterior, porque lo que aprendamos en un hito cambia el siguiente.

**Leyenda:** ⬜ pendiente · 🔄 en curso · ✅ hecha y verificada

---

## H0 — Andamiaje

> Objetivo: que exista el esqueleto sobre el que se apoya todo lo demás, con observabilidad y CI desde el
> primer día (TRD §20). Al terminar H0 no hay producto usable, pero sí un `pnpm dev` que arranca, una base de
> datos con migraciones, una traza visible en Grafana y un CI en verde.

### Bloque A — Monorepo

| #   | Tarea                                                                                    | Verificación                                              | Traza          | Estado |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------- | ------ |
| A1  | Repositorio git, `.gitignore`, `.editorconfig`, `.nvmrc` y commit de los documentos      | `git log` muestra el commit inicial                       | —              | ✅     |
| A2  | Este documento de tareas                                                                 | Existe y refleja el plan del TRD §20                      | TRD §20        | ✅     |
| A3  | Raíz del monorepo: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `README.md`      | `pnpm install` termina sin errores                        | T-11           | ✅     |
| A4  | `packages/config`: tsconfig base, ESLint plano y Prettier compartidos                    | `pnpm lint` y `pnpm typecheck` corren en vacío sin fallar | RNF-403        | ✅     |
| A5  | `packages/core`: entidades, enums de dominio y funciones puras de permisos con sus tests | `pnpm test:unit` pasa con tests reales de autorización    | RD-1, §4, §6.3 | ✅     |

### Bloque B — Infraestructura local

| #   | Tarea                                                                                          | Verificación                                                                               | Traza                | Estado |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------- | ------ |
| B1  | `infra/docker-compose.yml` con PostgreSQL 18.6 y Redis, con healthchecks y volúmenes           | `docker compose up -d` deja ambos servicios _healthy_                                      | T-15, T-6            | ✅     |
| B2  | Stack de observabilidad (OTel Collector, Tempo, Loki, Prometheus, Grafana) en un perfil aparte | `docker compose --profile obs up -d` levanta Grafana con sus fuentes de datos configuradas | T-4, §13, riesgo §18 | ✅     |
| B3  | `.env.example` y módulo de configuración validada al arrancar                                  | Arrancar sin una variable obligatoria falla con un mensaje claro                           | RNF-304, RNF-106     | ✅     |

### Bloque C — Base de datos

| #   | Tarea                                                                                              | Verificación                                                               | Traza        | Estado |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------ | ------ |
| C1  | `packages/db`: Drizzle, `drizzle-kit`, conexión y separación de roles `app_user` / migraciones     | `pnpm db:migrate` aplica sobre una base limpia                             | T-3, §6.1    | ✅     |
| C2  | Migración base: extensiones, enums, funciones `current_app_user()` y `user_workspaces()`, `GRANT`s | El esquema aplica en limpio y las funciones existen con `search_path` fijo | §6.1         | ✅     |
| C3  | Tablas `users` y `sessions` con sus índices                                                        | El esquema declarado en Drizzle coincide con el aplicado                   | §5.1         | ✅     |
| C4  | Testcontainers y **test canario de RLS**: `app_user` no ve lo que no debe                          | El test falla si se ejecuta como superusuario, y pasa como `app_user`      | RNF-401, §14 | ✅     |

### Bloque D — Aplicaciones

| #   | Tarea                                                                                         | Verificación                                                                     | Traza        | Estado |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------ | ------ |
| D1  | `apps/api`: NestJS mínimo con `/health/live`, `/health/ready` y OpenAPI                       | `curl /health/ready` responde comprobando Postgres y Redis                       | §8, §13      | ⬜     |
| D2  | OpenTelemetry inicializado antes de Nest, `pino` con `trace_id`, redacción de datos sensibles | Una petición aparece en Tempo con su span de SQL, y su log enlaza con la traza   | T-4, RNF-112 | ⬜     |
| D3  | `apps/web`: Vite, React, Tailwind, shadcn/ui, tema claro y oscuro                             | `pnpm dev` sirve una página que consulta `/health` y respeta el tema del sistema | T-9, RF-609  | ⬜     |
| D4  | `packages/contracts`: generación del cliente tipado desde el OpenAPI                          | El cliente generado compila y la SPA lo usa para llamar a `/health`              | T-8          | ⬜     |

### Bloque E — Integración continua

| #   | Tarea                                                                                   | Verificación                                     | Traza       | Estado |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------- | ------ |
| E1  | GitHub Actions: lint, typecheck, unit, integración, build y verificación de migraciones | El workflow pasa en verde sobre este repositorio | T-16, §15.1 | ⬜     |

---

## Hitos siguientes (a grano grueso)

Se desglosarán al cerrar el hito anterior.

| Hito   | Contenido                                                                                  | Deja usable                   |
| ------ | ------------------------------------------------------------------------------------------ | ----------------------------- |
| **H1** | Login de GitHub, sesiones, workspace personal, invitaciones, RLS completa sobre workspaces | Entrar y tener espacio propio |
| **H2** | Apps, documento de visión, versiones, historial, diff, restaurar, editor CodeMirror        | **Pensar solo**               |
| **H3** | Niveles de acceso, miembros, permisos completos y suite de tests negativos                 | **Pensar en equipo**          |
| **H4** | Comentarios: hilo general, inline con anclaje y reanclaje, resolver y reabrir, menciones   | Conversar sobre el texto      |
| **H5** | Notificaciones, SSE, purga                                                                 | Que nada se quede sin leer    |
| **H6** | Búsqueda, filtros, iconos, tema, estados vacíos, atajos                                    | La UI atractiva de O7         |
| **H7** | Admin, auditoría, Playwright, paneles de Grafana, Dockerfiles                              | v1 completa                   |
