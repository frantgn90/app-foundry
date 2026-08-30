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
