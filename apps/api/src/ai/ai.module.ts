import { Logger, Module } from '@nestjs/common';

import {
  AnthropicProvider,
  CredentialCipher,
  createProviderRegistry,
  FakeProvider,
  GroqProvider,
  type ProviderRegistry,
  parseKeyRing,
} from '@app-foundry/ai';
import { AiProvider } from '@app-foundry/core';
import type { Env } from '@app-foundry/env';

import { ENV } from '../infrastructure/tokens.js';
import { AI_CIPHER, AI_REGISTRY } from './ai.tokens.js';
import { AiProvidersController } from './providers.controller.js';
import { AiProvidersService } from './providers.service.js';

@Module({
  controllers: [AiProvidersController],
  providers: [
    AiProvidersService,
    {
      provide: AI_REGISTRY,
      inject: [ENV],
      useFactory: (env: Env): ProviderRegistry => {
        /*
         * El proveedor de mentira entra por aquí y por ningún otro sitio (T-36):
         * suplanta a los reales bajo su propio identificador, de modo que la
         * base de datos, la API y la interfaz recorren el mismo camino que en
         * producción. Nunca en producción, pase lo que pase en el entorno.
         */
        if (env.AI_USE_FAKE_PROVIDER && env.NODE_ENV !== 'production') {
          return createProviderRegistry([
            new FakeProvider({ id: AiProvider.ANTHROPIC }),
            new FakeProvider({ id: AiProvider.GROQ }),
          ]);
        }
        return createProviderRegistry([new AnthropicProvider(), new GroqProvider()]);
      },
    },
    {
      provide: AI_CIPHER,
      inject: [ENV],
      useFactory: (env: Env): CredentialCipher | null => {
        /*
         * Sin llavero no hay cifrado y, por tanto, no se pueden guardar
         * credenciales. No es un fallo: la IA es opcional y el resto del
         * producto funciona igual (RD-12). Se registra al arrancar para que la
         * ausencia sea una decisión visible y no una sorpresa.
         */
        if (!env.AI_CREDENTIAL_KEYS) {
          new Logger('AiModule').log(
            'Sin AI_CREDENTIAL_KEYS: no se podrán guardar credenciales de proveedor',
          );
          return null;
        }
        return new CredentialCipher(parseKeyRing(env.AI_CREDENTIAL_KEYS));
      },
    },
  ],
  exports: [AiProvidersService, AI_REGISTRY, AI_CIPHER],
})
export class AiModule {}
