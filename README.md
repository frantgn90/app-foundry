# App Foundry

Un espacio para pensar, definir y traquear ideas de aplicaciones.

Todo empieza cuando creas una **app**: escribes su **visión** en markdown y esa visión, versionada y
comentable, es el punto de partida de todo lo que venga después. El desarrollo del software ocurre fuera de
la plataforma; aquí vive la idea.

## Documentación

| Documento                                    | Contenido                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Qué hace la v1: requisitos funcionales y no funcionales, roles y criterios de aceptación |
| [docs/TRD.md](docs/TRD.md)                   | Cómo se construye: arquitectura, modelo de datos, seguridad y plan de implementación     |
| [docs/TASKS.md](docs/TASKS.md)               | Estado del trabajo, tarea a tarea                                                        |

## Requisitos previos

- Node.js >= 22.20
- pnpm 11
- Docker con Compose

## Puesta en marcha

```bash
pnpm install
pnpm infra:up      # PostgreSQL y Redis
pnpm dev           # API y aplicación web
```

## Estructura

```
apps/
  api/        API NestJS
  web/        Aplicación React
packages/
  core/       Dominio: entidades, permisos y casos de uso. Sin HTTP ni SQL.
  db/         Esquema Drizzle, migraciones y políticas RLS
  contracts/  Cliente tipado generado desde OpenAPI
  config/     Configuración compartida de TypeScript, ESLint y Prettier
infra/        Docker Compose y configuración de observabilidad
```

## Desarrollo

```bash
pnpm lint          # ESLint en todo el monorepo
pnpm typecheck     # Comprobación de tipos
pnpm test:unit     # Tests unitarios del dominio
pnpm format        # Formateo con Prettier
```
