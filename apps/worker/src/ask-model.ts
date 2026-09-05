import { Inject, Injectable } from '@nestjs/common';

import { AiTask, ProviderError, ReasoningSplitter } from '@app-foundry/core';
import type { ProviderRegistry } from '@app-foundry/ai';
import { AiInvocationService, AI_REGISTRY } from '@app-foundry/ai-runtime';

/**
 * Lo que el worker le pide a un modelo, por el paso común (RD-10).
 *
 * No hay atajo: pasa por `begin` y `finish` igual que el asistente de escritura
 * y la generación de ideas, así que la respuesta de un agente reserva cupo, se
 * liquida y deja su fila en el registro de invocaciones con el mismo formato.
 * Es la razón por la que este paso vive en un paquete y no dentro de la API.
 *
 * El texto se pide entero y no en streaming: nadie está mirando la pantalla
 * mientras un agente contesta, y un comentario a medias no sirve de nada. Lo
 * que se guarda es el comentario cerrado.
 */
@Injectable()
export class AskModel {
  constructor(
    private readonly invocations: AiInvocationService,
    @Inject(AI_REGISTRY) private readonly registry: ProviderRegistry,
  ) {}

  async ask(peticion: {
    workspaceId: string;
    appId: string;
    actorUserId: string;
    agentId: string;
    system: string;
    messages: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[];
    maxOutputTokens: number;
  }): Promise<{ texto: string; provider: string; modelId: string }> {
    const context = {
      workspaceId: peticion.workspaceId,
      appId: peticion.appId,
      task: AiTask.AGENT_REPLY,
      userId: peticion.actorUserId,
      agentId: peticion.agentId,
    };

    /*
     * Una sola variante: aquí no hay nada que recortar. El asistente manda el
     * documento entero o solo el entorno del fragmento según lo que quepa
     * (RF-1409); un hilo con su documento cabe o no cabe, y si no cabe lo
     * honesto es decirlo en vez de contestar habiendo leído la mitad.
     */
    const empezada = await this.invocations.begin(context, [
      {
        label: 'agent-reply',
        request: {
          system: peticion.system,
          messages: peticion.messages,
          maxOutputTokens: peticion.maxOutputTokens,
        },
      },
    ]);

    const inicio = Date.now();
    try {
      /*
       * El puerto solo sabe transmitir, así que se transmite y se acumula. No
       * es un rodeo: es lo mismo que hace el asistente, salvo que aquí nadie
       * mira la pantalla y lo que se guarda es el comentario cerrado.
       *
       * Y se separa el razonamiento por el camino (RF-1403, RD-9). Los modelos
       * que piensan en voz alta —`qwen3.6` en Groq, sin ir más lejos— escriben
       * su deliberación en el mismo flujo, envuelta en `<think>…</think>`. Sin
       * esto, un agente publicaba como comentario su propio monólogo interior
       * antes de contestar. Se descubrió usándolo, no probándolo: la suite del
       * worker inyecta la respuesta ya limpia.
       *
       * Lo pensado se descarta aquí en vez de guardarse, al revés que en el
       * asistente: allí se enseña plegado porque quien lo pidió está mirando y
       * puede querer entender la propuesta, y un comentario no tiene dónde
       * plegar nada ni a quién enseñárselo.
       */
      const separador = new ReasoningSplitter();
      let texto = '';
      let usage = { inputTokens: empezada.estimatedTokens, outputTokens: 0 };
      let ttftMs: number | undefined;

      for await (const evento of this.registry
        .get(empezada.plan.provider)
        .streamText(empezada.request, empezada.credential)) {
        if (evento.type === 'delta') {
          ttftMs ??= Date.now() - inicio;
          texto += separador.push(evento.text).text;
        } else if (evento.type === 'usage') {
          usage = evento.usage;
        }
      }
      texto += separador.flush().text;

      await this.invocations.finish(context, empezada, usage, {
        outcome: 'COMPLETED',
        ...(ttftMs !== undefined && { ttftMs }),
      });
      /*
       * Se devuelve con qué se generó, no solo el texto: el modelo que atiende
       * una tarea cambia, así que preguntarlo después daría el de entonces y no
       * el de esta respuesta (RF-1704).
       */
      return { texto, provider: empezada.plan.provider, modelId: empezada.plan.modelId };
    } catch (error: unknown) {
      /*
       * Se liquida igual al fallar. Sin esto, un fallo dejaría el cupo apartado
       * hasta que caducara: cada error robaría tokens que nadie llegó a gastar.
       */
      await this.invocations.finish(
        context,
        empezada,
        { inputTokens: empezada.estimatedTokens, outputTokens: 0 },
        {
          outcome: 'FAILED',
          ...(error instanceof ProviderError && { errorKind: error.kind }),
        },
      );
      throw error;
    }
  }
}
