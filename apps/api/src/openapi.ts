/**
 * Exporta la especificación OpenAPI a un fichero, sin levantar el servidor.
 *
 * El contrato queda versionado en el repositorio, de modo que CI puede
 * comprobar que no se ha quedado atrás respecto al código: un cambio en un DTO
 * que nadie regenere se convierte en un diff, no en un cliente roto meses
 * después.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';

const destino = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/contracts/openapi.json',
);

const app = await NestFactory.create(AppModule, { logger: false });
app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });

const document = SwaggerModule.createDocument(
  app,
  new DocumentBuilder()
    .setTitle('App Foundry API')
    .setDescription('Un espacio para pensar, definir y traquear ideas de aplicaciones')
    .setVersion('1.0')
    .build(),
);

writeFileSync(destino, `${JSON.stringify(document, null, 2)}\n`);
console.log(`OpenAPI escrito en ${destino}`);
// Salida inmediata: el contrato ya está en disco y no hay razón para esperar a
// que se cierren conexiones que este script no llegó a usar.
process.exit(0);
