import { Logger, Module, type OnModuleInit } from '@nestjs/common';

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
import { AiCatalogRefresh } from './catalog.refresh.js';
import { AiCatalogService } from './catalog.service.js';
import { AiProvidersController } from './providers.controller.js';
import { AiProvidersService } from './providers.service.js';
import { WorkspaceAiController } from './workspace-ai.controller.js';

@Module({
  controllers: [AiProvidersController, WorkspaceAiController],
  providers: [
    AiProvidersService,
    AiCatalogService,
    AiCatalogRefresh,
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
  exports: [AiProvidersService, AiCatalogService, AI_REGISTRY, AI_CIPHER],
})
export class AiModule implements OnModuleInit {
  constructor(
    private readonly providers: AiProvidersService,
    private readonly catalog: AiCatalogService,
  ) {}

  /**
   * Cierra el círculo entre los dos servicios sin que se inyecten mutuamente.
   *
   * El catálogo necesita al de proveedores para leer la credencial; el de
   * proveedores necesita avisar al catálogo cuando alguien configura uno. En
   * lugar de una dependencia circular, el módulo enchufa el enganche al
   * arrancar. Los fallos se tragan a propósito: configurar un proveedor no puede
   * fallar porque el catálogo no se dejara leer.
   */
  onModuleInit(): void {
    this.providers.onProviderConfigured = async (workspaceId, provider) => {
      await this.catalog.refresh(workspaceId, provider).catch(() => undefined);
    };
  }
}
