import { Global, Injectable, Module } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

/**
 * Métricas que dicen si el producto se está usando (TRD §13).
 *
 * Las de infraestructura —peticiones, latencia, consultas— ya las produce la
 * instrumentación automática. Estas son las otras: las que responden a «¿esto le
 * sirve a alguien?» y, sobre todo, a «¿se está rompiendo algo en silencio?».
 *
 * Ninguna lleva identificadores como etiqueta. Una métrica con `user.id` o
 * `workspace.id` multiplica las series por cada persona y cada espacio, y
 * además convierte el sistema de métricas en un sitio donde acaban datos que no
 * deberían salir de la base (RNF-112).
 */
@Injectable()
export class MetricsService {
  private readonly meter = metrics.getMeter('app-foundry');

  private readonly appsCreadas = this.meter.createCounter('foundry.apps.created', {
    description: 'Apps creadas',
  });

  private readonly versiones = this.meter.createCounter('foundry.document.versions', {
    description: 'Versiones de documento guardadas',
  });

  private readonly comentarios = this.meter.createCounter('foundry.comments.created', {
    description: 'Comentarios escritos',
  });

  /**
   * La que de verdad hay que mirar.
   *
   * Un ancla huérfana es un comentario que ha perdido su sitio en el texto. Que
   * aparezca alguna es normal —el documento cambia—, pero un pico significa que
   * el reanclaje está fallando, y eso no se nota por ningún otro lado: nadie
   * abre una incidencia porque sus comentarios se hayan quedado sin sitio, se
   * limita a dejar de fiarse de la herramienta.
   */
  private readonly huerfanas = this.meter.createCounter('foundry.anchors.orphaned', {
    description: 'Anclas que se han quedado sin sitio al reanclar',
  });

  private readonly avisos = this.meter.createCounter('foundry.notifications.emitted', {
    description: 'Avisos emitidos',
  });

  /**
   * Conexiones de avisos abiertas ahora mismo.
   *
   * Es un contador que sube y baja, no una cuenta acumulada: lo que interesa es
   * cuántas hay, y si crece sin parar es que alguna no se está cerrando.
   */
  private readonly conexiones = this.meter.createUpDownCounter('foundry.sse.connections', {
    description: 'Conexiones de avisos abiertas',
  });

  /* ---------------------------------------------------------------------- */
  /* Inteligencia artificial (v2)                                            */
  /* ---------------------------------------------------------------------- */

  private readonly invocaciones = this.meter.createCounter('foundry.ai.invocations', {
    description: 'Invocaciones a un modelo, por proveedor, modelo, tarea y desenlace',
  });

  /**
   * Tokens consumidos, con la dirección como etiqueta.
   *
   * Entrada y salida en el mismo contador y no en dos: así una consulta puede
   * sumarlos o separarlos según le convenga, y no hay forma de que uno se
   * actualice y el otro no.
   */
  private readonly tokens = this.meter.createCounter('foundry.ai.tokens', {
    description: 'Tokens consumidos, separando entrada de salida',
  });

  private readonly latenciaIa = this.meter.createHistogram('foundry.ai.latency', {
    description: 'Duración de una invocación, de principio a fin',
    unit: 'ms',
  });

  /**
   * Hasta la primera palabra.
   *
   * Va aparte de la latencia total porque es lo que de verdad se nota al usarlo
   * (RNF-706): una respuesta larga que empieza enseguida se percibe rápida, y
   * una corta que tarda en arrancar, lenta.
   */
  private readonly primeraPalabra = this.meter.createHistogram('foundry.ai.ttft', {
    description: 'Tiempo hasta la primera palabra',
    unit: 'ms',
  });

  /**
   * Un cupo agotado no es un error del sistema, pero sí algo que hay que ver.
   *
   * Si sube, alguien se ha quedado sin IA a mitad de mes y probablemente no
   * entiende por qué (RNF-804).
   */
  private readonly cuposAgotados = this.meter.createCounter('foundry.ai.quota_blocked', {
    description: 'Invocaciones cortadas por cupo agotado',
  });

  /** Lo que el contador de Redis se había quedado corto, al conciliar. */
  private readonly desfaseCupo = this.meter.createCounter('foundry.ai.quota_drift', {
    description: 'Tokens de desfase corregidos al conciliar el contador',
  });

  /**
   * Un proveedor al que se ha dejado de llamar por fallar sin parar (RNF-704).
   *
   * Sube y baja: lo que interesa es cuántos hay abiertos ahora, no cuántas veces
   * se abrieron.
   */
  private readonly cortacircuitos = this.meter.createUpDownCounter('foundry.ai.circuit_open', {
    description: 'Proveedores con el cortacircuitos abierto',
  });

  /**
   * Apunta una invocación terminada.
   *
   * Nunca lleva contenido ni identidad: proveedor, modelo, tarea y desenlace
   * bastan para responder «qué se está usando y cómo va», y cualquier cosa más
   * convertiría las métricas en un registro de lo que la gente escribe
   * (RNF-801, T-17).
   */
  invocacionIa(datos: {
    provider: string;
    model: string;
    task: string;
    outcome: string;
    errorKind?: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    ttftMs?: number;
  }): void {
    const etiquetas = {
      provider: datos.provider,
      model: datos.model,
      task: datos.task,
      outcome: datos.outcome,
      ...(datos.errorKind !== undefined && { error_kind: datos.errorKind }),
    };

    this.invocaciones.add(1, etiquetas);
    this.latenciaIa.record(datos.latencyMs, etiquetas);
    if (datos.ttftMs !== undefined) this.primeraPalabra.record(datos.ttftMs, etiquetas);

    const consumo = { provider: datos.provider, model: datos.model, task: datos.task };
    if (datos.inputTokens > 0) this.tokens.add(datos.inputTokens, { ...consumo, direction: 'in' });
    if (datos.outputTokens > 0) {
      this.tokens.add(datos.outputTokens, { ...consumo, direction: 'out' });
    }

    if (datos.outcome === 'QUOTA_BLOCKED') this.cuposAgotados.add(1, { provider: datos.provider });
  }

  desfaseDeCupoCorregido(tokens: number): void {
    if (tokens > 0) this.desfaseCupo.add(tokens);
  }

  cortacircuitosAbierto(provider: string): void {
    this.cortacircuitos.add(1, { provider });
  }

  cortacircuitosCerrado(provider: string): void {
    this.cortacircuitos.add(-1, { provider });
  }

  appCreada(): void {
    this.appsCreadas.add(1);
  }

  versionGuardada(): void {
    this.versiones.add(1);
  }

  comentarioEscrito(clase: 'thread' | 'reply'): void {
    this.comentarios.add(1, { kind: clase });
  }

  anclasHuerfanas(cuantas: number): void {
    if (cuantas > 0) this.huerfanas.add(cuantas);
  }

  avisosEmitidos(cuantos: number): void {
    if (cuantos > 0) this.avisos.add(cuantos);
  }

  conexionAbierta(): void {
    this.conexiones.add(1);
  }

  conexionCerrada(): void {
    this.conexiones.add(-1);
  }
}

@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
