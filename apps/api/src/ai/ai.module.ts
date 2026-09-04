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

import { DocumentsModule } from '../documents/documents.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ENV } from '../infrastructure/tokens.js';
import { AI_CIPHER, AI_REGISTRY } from './ai.tokens.js';
import { AiAssistController } from './assist.controller.js';
import { AiAssistService } from './assist.service.js';
import { AiCatalogRefresh } from './catalog.refresh.js';
import { AiCircuitService } from './circuit.service.js';
import { AiCatalogService } from './catalog.service.js';
import { AiProvidersController } from './providers.controller.js';
import { AiProvidersService } from './providers.service.js';
import { AiInvocationService } from './invocation.service.js';
import { AiQuotaReconcile } from './quota.reconcile.js';
import { AiQuotaService } from './quota.service.js';
import { AiUsageRepository } from './usage.repository.js';
import { AiUsageService } from './usage.service.js';
import { AiTasksService } from './tasks.service.js';
import { WorkspaceAiController } from './workspace-ai.controller.js';

@Module({
  imports: [NotificationsModule, DocumentsModule],
  controllers: [AiProvidersController, WorkspaceAiController, AiAssistController],
  providers: [
    AiProvidersService,
    AiCatalogService,
    AiCatalogRefresh,
    AiTasksService,
    AiAssistService,
    AiCircuitService,
    AiQuotaService,
    AiQuotaReconcile,
    AiInvocationService,
    AiUsageRepository,
    AiUsageService,
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
          /*
           * Y se dice al arrancar, en alto.
           *
           * Suplantar es justo lo que lo hace útil: la credencial se guarda, el
           * catálogo es el de verdad y el modelo asignado es el de verdad, así
           * que por pantalla no se distingue **nada** hasta que llega la
           * respuesta y dice «texto de mentira». Sin esta línea, una instancia
           * arrancada así se diagnostica leyendo código; con ella, mirando el
           * primer renglón del arranque.
           */
          new Logger('AiModule').warn(
            'AI_USE_FAKE_PROVIDER activo: ningún modelo real será invocado, ' +
              'las respuestas son de mentira',
          );
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
  exports: [
    AiProvidersService,
    AiCatalogService,
    AiTasksService,
    AiAssistService,
    AiCircuitService,
    AiQuotaService,
    AiQuotaReconcile,
    AiInvocationService,
    AiUsageRepository,
    AiUsageService,
    AI_REGISTRY,
    AI_CIPHER,
  ],
})
export class AiModule implements OnModuleInit {
  constructor(
    private readonly providers: AiProvidersService,
    private readonly catalog: AiCatalogService,
    private readonly tasks: AiTasksService,
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
      /*
       * Y con el catálogo ya en casa, se propone qué modelo atiende cada tarea
       * (RF-1103): sin esto, configurar un proveedor deja la IA encendida pero
       * sin nada asignado, que es como no haberla configurado.
       */
      await this.tasks.proposeDefaults(workspaceId, provider).catch(() => undefined);
    };
  }
}
