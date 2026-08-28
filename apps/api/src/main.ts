import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { loadEnv } from '@app-foundry/env';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Todas las rutas bajo /api/v1 salvo las de salud, que un orquestador espera
  // encontrar en la raíz.
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Un campo de más en el cuerpo es un error del cliente, no algo que
      // ignorar en silencio: casi siempre es una errata en el nombre.
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('App Foundry API')
      .setDescription('Un espacio para pensar, definir y traquear ideas de aplicaciones')
      .setVersion('1.0')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(env.PORT);
  new Logger('bootstrap').log(
    `API escuchando en http://localhost:${String(env.PORT)} · documentación en /api/docs`,
  );
}

await bootstrap();
