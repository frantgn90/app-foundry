import base from '@app-foundry/config/eslint';

/**
 * El dominio no habla con nadie de fuera (RD-1, RD-8).
 *
 * `core` no declara dependencias, así que un `import` de un SDK ni siquiera
 * resolvería. La regla existe igualmente para que el fallo llegue como un error
 * de linter con su motivo, y no como un módulo que no se encuentra: quien lo
 * intente merece leer por qué no puede, no adivinarlo.
 *
 * Los nombres exactos van en `paths` y no en `patterns`: los patrones se
 * interpretan con la semántica de `.gitignore`, donde un `ai` suelto casa con
 * cualquier carpeta llamada así —incluida la nuestra—.
 */
const PROVEEDOR =
  'El dominio no habla con proveedores: declara aquí el puerto e impleméntalo en @app-foundry/ai (RD-8, T-23).';

export default [
  ...base,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'ai', message: PROVEEDOR },
            { name: 'groq-sdk', message: PROVEEDOR },
            { name: 'openai', message: PROVEEDOR },
            {
              name: 'ioredis',
              message: 'core no conoce infraestructura: eso vive en apps/api (RD-1).',
            },
            {
              name: 'drizzle-orm',
              message: 'core no conoce SQL: el acceso a datos vive en packages/db (RD-1).',
            },
          ],
          patterns: [
            { group: ['@anthropic-ai/**', '@ai-sdk/**'], message: PROVEEDOR },
            {
              group: ['node:**', '@nestjs/**'],
              message: 'core no conoce plataforma ni HTTP: eso vive en apps/api (RD-1).',
            },
          ],
        },
      ],
    },
  },
];
