import { useEffect, useRef } from 'react';

/**
 * Las lenguas del fuego, repartidas a lo ancho.
 *
 * Los colores son los de «Dawn» —ámbar, naranja y rosa—, con el ámbar en el
 * centro y el rosa hacia los extremos, que es como se enfría una llama al
 * separarse del foco.
 *
 * Cada una tiene su altura de reposo y sus dos periodos de oscilación, elegidos
 * de forma que no sean múltiplos entre sí: así el conjunto tarda muchísimo en
 * repetirse y el oleaje no se percibe como un bucle.
 */
const TOTAL = 19;

const LENGUAS = Array.from({ length: TOTAL }, (_, i) => {
  const centro = Math.abs(i / (TOTAL - 1) - 0.5) * 2; // 0 en el medio, 1 en los bordes.
  return {
    x: (i / (TOTAL - 1)) * 100,
    /*
     * Bajas en reposo y más altas por el centro. Que empiecen bajas es lo que
     * deja sitio para el estirón: con una base alta, la lengua llega al tope en
     * cuanto se acerca el puntero y el montículo se convierte en una meseta.
     */
    alturaBase: 0.2 + (1 - centro) * 0.3,
    /*
     * El ancho decide si esto parece fuego o no. Demasiado estrechas quedan
     * separadas y se leen como barras de un ecualizador; demasiado anchas se
     * funden en una niebla de colores. Con este solape la base es continua y las
     * puntas siguen distinguiéndose.
     */
    ancho: 17 + (i % 4) * 4,
    color: centro < 0.35 ? '250 190 80' : centro < 0.7 ? '251 146 60' : '244 63 94',
    opacidad: 0.46 - centro * 0.12,
    periodoA: 2.6 + (i % 5) * 0.63,
    periodoB: 4.7 + (i % 4) * 1.07,
    fase: i * 1.7,
  };
});

/** Hasta dónde puede llegar el fuego, en proporción de la altura de la ventana. */
const ALTURA_MAXIMA = 0.42;
/** Cuánto puede estirarse una lengua por encima de su reposo al ser atraída. */
const ESTIRON = 0.55;
/**
 * A qué distancia horizontal deja de notarse el puntero, en anchos de ventana.
 *
 * Corto a propósito: con un alcance largo se levanta medio fuego a la vez y se
 * pierde la sensación de que una llama concreta va a por el ratón.
 */
const ALCANCE = 0.12;

/**
 * El fuego de la forja, al pie de la pantalla de entrada.
 *
 * Las llamas se estiran hacia el puntero cuando pasa cerca, como si trataran de
 * alcanzarlo, pero con un tope: por mucho que se acerque el ratón, el fuego
 * nunca sube más allá de una fracción de la pantalla. Sin ese límite, pasear el
 * ratón por arriba llenaría la página de color y taparía lo único que hay que
 * hacer aquí, que es entrar.
 *
 * Se anima con `transform`, que el navegador resuelve en la tarjeta gráfica sin
 * rehacer la maquetación en cada fotograma.
 */
export function ForgeFire() {
  const capa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nodo = capa.current;
    if (!nodo) return;

    const lenguas = [...nodo.querySelectorAll<HTMLElement>('[data-lengua]')];
    // Fuera de la pantalla mientras nadie mueva el ratón: el fuego arde solo.
    const puntero = { x: -9999, y: -9999 };
    const escalas = LENGUAS.map((l) => l.alturaBase);

    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (quieto.matches) {
      // Sin movimiento, pero con fuego: el color y la forma se quedan.
      lenguas.forEach((lengua, i) => {
        lengua.style.transform = `scaleY(${String(LENGUAS[i]!.alturaBase.toFixed(3))})`;
      });
      return;
    }

    const alMover = (e: PointerEvent) => {
      puntero.x = e.clientX;
      puntero.y = e.clientY;
    };
    const alSalir = () => {
      puntero.x = -9999;
      puntero.y = -9999;
    };
    window.addEventListener('pointermove', alMover, { passive: true });
    window.addEventListener('pointerleave', alSalir);

    let animacion = 0;
    const paso = (ahora: number) => {
      const t = ahora / 1000;
      const ancho = window.innerWidth;
      const alto = window.innerHeight;

      lenguas.forEach((lengua, i) => {
        const config = LENGUAS[i]!;

        // El oleaje: dos senos de distinto periodo sumados, que es lo que evita
        // que el movimiento se lea como una única onda.
        const oleaje =
          Math.sin((t / config.periodoA) * Math.PI * 2 + config.fase) * 0.09 +
          Math.sin((t / config.periodoB) * Math.PI * 2 + config.fase * 1.3) * 0.055;

        /*
         * La atracción cae con la distancia horizontal siguiendo una campana:
         * la lengua justo debajo del puntero se estira del todo y las vecinas
         * cada vez menos, de modo que el fuego se levanta en un montículo en vez
         * de en un escalón.
         */
        const distancia = Math.abs(puntero.x - (config.x / 100) * ancho) / ancho;
        const cercania = Math.exp(-((distancia / ALCANCE) ** 2));

        /*
         * Y también cuenta la altura del puntero: cuanto más arriba está, más
         * estira la llama para alcanzarlo. Se mide contra el tope y no contra la
         * pantalla entera, así que a partir de cierta altura ya no da más de sí,
         * que es justo la sensación de estar intentándolo.
         */
        const desdeAbajo = Math.max(0, Math.min(1, (alto - puntero.y) / (alto * ALTURA_MAXIMA)));
        const objetivo = Math.min(
          config.alturaBase + oleaje + cercania * ESTIRON * (0.35 + desdeAbajo * 0.65),
          1,
        );

        // Se persigue el objetivo en vez de saltar a él: el fuego tiene que
        // crecer y encogerse, no aparecer estirado de un fotograma al siguiente.
        escalas[i]! += (objetivo - escalas[i]!) * 0.09;
        lengua.style.transform = `scaleY(${escalas[i]!.toFixed(3)})`;
      });

      animacion = requestAnimationFrame(paso);
    };
    animacion = requestAnimationFrame(paso);

    return () => {
      window.removeEventListener('pointermove', alMover);
      window.removeEventListener('pointerleave', alSalir);
      cancelAnimationFrame(animacion);
    };
  }, []);

  return (
    <div
      ref={capa}
      // Al pie, a todo lo ancho y sin capturar el ratón: es decoración, y no
      // debe interponerse entre el puntero y el botón de entrar.
      className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 overflow-hidden"
      style={{ height: `${String(ALTURA_MAXIMA * 100)}vh` }}
      aria-hidden
    >
      {/* El rescoldo: un resplandor tendido en la base que no depende del
          puntero y que da fondo a las lenguas, para que no floten sobre nada. */}
      <div
        className="absolute inset-x-0 bottom-0 h-2/3"
        style={{
          background:
            'radial-gradient(120% 100% at 50% 100%, rgb(250 190 80 / 0.34) 0%, rgb(251 146 60 / 0.2) 32%, rgb(244 63 94 / 0.09) 58%, transparent 78%)',
        }}
      />

      {/* La brasa: una franja estrecha y más caliente justo en el suelo, que es
          donde un fuego real es más brillante. */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/5"
        style={{
          background:
            'linear-gradient(to top, rgb(253 210 120 / 0.4) 0%, rgb(251 146 60 / 0.18) 45%, transparent 100%)',
        }}
      />

      {LENGUAS.map((lengua, i) => (
        <div
          key={i}
          data-lengua
          className="absolute bottom-0 origin-bottom will-change-transform"
          style={{
            left: `${String(lengua.x)}%`,
            width: `${String(lengua.ancho)}vw`,
            height: '100%',
            marginLeft: `${String(-lengua.ancho / 2)}vw`,
            transform: `scaleY(${String(lengua.alturaBase)})`,
            background: `radial-gradient(ellipse 38% 100% at 50% 100%, rgb(${lengua.color} / ${String(lengua.opacidad)}) 0%, rgb(${lengua.color} / 0) 70%)`,
          }}
        />
      ))}
    </div>
  );
}
