import { type DynamicModule, Module, type ModuleMetadata, type Provider } from '@nestjs/common';

import { AiCircuitService } from './circuit.service.js';
import { AiInvocationService } from './invocation.service.js';
import { AiProviderAccessService } from './provider-access.service.js';
import { AiQuotaService } from './quota.service.js';
import { AiTaskPlanService } from './task-plan.service.js';
import { AI_CIPHER, AI_METRICS, AI_NOTIFIER, AI_REGISTRY } from './tokens.js';
import { AiUsageRepository } from './usage.repository.js';

const SERVICIOS = [
  AiTaskPlanService,
  AiProviderAccessService,
  AiCircuitService,
  AiQuotaService,
  AiUsageRepository,
  AiInvocationService,
];

/**
 * El paso por el que pasa toda invocación a un modelo (RD-10).
 *
 * Existe como paquete y no como módulo de la API porque hay **dos** procesos
 * que invocan: la API, para las ideas y el asistente, y el worker, para lo que
 * escriben los agentes. Con esto dentro de `apps/api`, el worker tendría que
 * depender de la API entera —o reimplementar la reserva de cupo y el registro
 * de invocaciones—, y entonces habría dos sitios donde olvidarse de contar.
 *
 * Lo que **no** entra aquí: configurar proveedores, asignar modelos y consultar
 * el consumo. Eso son pantallas del dueño, con su auditoría y sus DTO, y se
 * quedan en la API.
 *
 * Es un módulo **dinámico** y no uno normal porque las cuatro piezas que
 * necesita las decide quien lo monta: el registro de adaptadores, el cifrador,
 * y los dos puertos de métricas y avisos. Un módulo de Nest solo resuelve lo
 * que declara o lo que importa, así que recibirlas como parámetro es la forma
 * de que la API enchufe sus servicios y el worker los suyos sin que este
 * paquete conozca a ninguno de los dos.
 */
@Module({})
export class AiRuntimeModule {
  static forRoot(opciones: {
    /** De dónde salen los proveedores de abajo, si vienen de otros módulos. */
    imports?: ModuleMetadata['imports'];
    /** `AI_REGISTRY`, `AI_CIPHER`, `AI_METRICS` y `AI_NOTIFIER`. */
    providers: Provider[];
  }): DynamicModule {
    return {
      module: AiRuntimeModule,
      imports: opciones.imports ?? [],
      providers: [...opciones.providers, ...SERVICIOS],
      /*
       * Se reexportan los dos tokens de IA además de los servicios: lo que se
       * queda en la API —el catálogo, la asignación por tarea, la
       * configuración de proveedores— también necesita el registro y el
       * cifrador, y declararlos dos veces daría dos instancias distintas del
       * registro, con dos cortacircuitos que no se enterarían el uno del otro.
       */
      exports: [...SERVICIOS, AI_REGISTRY, AI_CIPHER, AI_METRICS, AI_NOTIFIER],
    };
  }
}
