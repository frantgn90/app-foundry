import { useEffect, useRef, useState } from 'react';

import {
  chooseIdea,
  type IdeaConstraints,
  type IdeaProposal,
  type IdeaSource,
  MONETISATION_LABELS,
  MONETISATIONS,
  streamIdeas,
} from '../lib/ideas.js';
import { cn } from '../lib/utils.js';
import { Badge } from './ui/badge.js';
import { Logo } from './logo.js';
import { Button } from './ui/button.js';
import { Card } from './ui/card.js';
import { Input } from './ui/input.js';

/**
 * El botón que abre y cierra la vía «no sé qué construir» (RF-1301).
 *
 * Va en la misma fila que crear a mano, a su derecha: son las dos formas de
 * empezar y ninguna es un rincón de la otra. Es su propio componente porque el
 * botón y el panel viven en sitios distintos de la pantalla —uno en la fila,
 * otro debajo— y un solo componente no puede pintarse en dos padres.
 *
 * Y **no desaparece al pulsarlo**: es un conmutador, así que cerrar las ideas se
 * hace donde se abrieron. Un botón que se esfuma deja a quien lo pulsó buscando
 * por dónde volver, y obligaba a un «Close» aparte que decía lo mismo dos veces.
 */
export function IdeaTrigger({ abierto, onToggle }: { abierto: boolean; onToggle: () => void }) {
  return (
    <button
      /* Vive dentro del formulario de crear a mano: sin esto sería otro botón de
         envío, y abrir las ideas intentaría crear una app sin nombre. */
      type="button"
      aria-pressed={abierto}
      onClick={onToggle}
      className="boton-inspirar shrink-0"
    >
      {/*
        La caja de fuera lleva el degradado; esta lleva la superficie opaca y deja
        asomar el píxel y medio de aquella por todo el contorno. El radio interior
        es el de fuera menos el relleno, o el borde se vería más grueso en las
        esquinas que en los lados.
      */}
      <span className="flex h-full items-center gap-2 rounded-[calc(0.6rem-1.5px)] bg-[var(--color-superficie)] px-3 text-sm font-medium">
        <Logo className="size-4" />
        Get inspired
      </span>
    </button>
  );
}

/**
 * La vía «no sé qué construir» (RF-1301..1309).
 *
 * Vive en el mismo panel que crear a mano y no en otra pantalla: son las dos
 * formas de empezar lo mismo, y quien llega sin idea no tiene por qué saber que
 * hay un sitio aparte donde se le ayuda.
 */
export function IdeaGenerator({
  workspaceId,
  temaInicial,
  onCreated,
}: {
  workspaceId: string;
  /**
   * Lo que hubiera escrito en el campo de crear a mano.
   *
   * Quien ha tecleado «gestión de rutas» y luego pide ideas ya ha dicho de qué
   * las quiere: volver a preguntárselo en otro campo sería no haber escuchado.
   */
  temaInicial: string;
  onCreated: (appId: string) => void;
}) {
  const [constraints, setConstraints] = useState<IdeaConstraints>(
    temaInicial.trim() === '' ? {} : { topic: temaInicial.trim() },
  );
  const [propuestas, setPropuestas] = useState<IdeaProposal[]>([]);
  const [sources, setSources] = useState<IdeaSource[]>([]);
  const [grounded, setGrounded] = useState<boolean | null>(null);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const [ajustando, setAjustando] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Pide una tanda. `mas` conserva las entradas y excluye lo ya enseñado.
   *
   * Las vistas se mandan como exclusiones porque el modelo no recuerda la tanda
   * anterior: pedirle variedad sin decirle de qué produce las mismas ideas con
   * otras palabras (RF-1307).
   */
  function generar(mas = false) {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    const vistas = mas ? propuestas.map((p) => p.name) : [];
    if (!mas) {
      setPropuestas([]);
      setSources([]);
      setGrounded(null);
    }
    setError(null);
    setGenerando(true);

    const vigente = () => abortRef.current === abort;

    void streamIdeas(
      workspaceId,
      { ...soloLoPuesto(constraints), ...(vistas.length > 0 && { exclude: vistas }) },
      {
        onMeta: (meta) => {
          if (vigente()) setGrounded(meta.grounded);
        },
        onSources: (fuentes) => {
          if (vigente()) setSources((previas) => [...previas, ...fuentes]);
        },
        onProposal: (propuesta) => {
          if (vigente()) setPropuestas((previas) => [...previas, propuesta]);
        },
        onDone: () => {
          if (vigente()) setGenerando(false);
        },
        onError: (mensaje) => {
          if (!vigente()) return;
          setGenerando(false);
          setError(mensaje);
        },
      },
      abort.signal,
    );
  }

  function elegir(propuesta: IdeaProposal) {
    setEligiendo(propuesta.name);
    setError(null);
    chooseIdea(workspaceId, propuesta, sources)
      .then((app) => {
        abortRef.current?.abort();
        onCreated(app.id);
      })
      .catch((fallo: unknown) => {
        setEligiendo(null);
        setError(fallo instanceof Error ? fallo.message : 'That idea could not be created.');
      });
  }

  /*
   * Se pide nada más abrir, sin botón por medio: pulsar «Get inspired» ya es
   * pedir ideas, y un segundo botón para confirmarlo solo añadía un paso a algo
   * que ya se había decidido.
   *
   * Y al cerrar se corta lo que estuviera generándose: cerrar el panel es
   * desmontarlo, así que la limpieza del efecto es el único sitio donde consta
   * que alguien se ha ido.
   */
  useEffect(() => {
    generar();
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
    /*
     * Sin dependencias y a propósito: esto es «al abrirse», no «cuando cambie
     * algo». Las tandas siguientes las pide quien las quiera.
     */
  }, []);

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--color-borde)] pt-3">
      {/*
        Una caja, no un formulario.
        
        Este panel vive **dentro** del formulario de crear a mano, y anidar
        formularios es HTML inválido: el navegador se lo toma como quiere y lo
        que se veía era el panel reiniciándose al pedir ideas. Los campos no
        necesitan un formulario propio; lo único que hacía falta era un botón.
      */}
      {/*
        Los ajustes van plegados.

        Quien pide ideas no ha venido a rellenar un formulario: ha venido a que
        le propongan algo. Delante va lo propuesto, y las restricciones esperan
        detrás para quien quiera afinar. Todas siguen siendo opcionales (RF-1302).
      */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={ajustando}
          onClick={() => {
            setAjustando((v) => !v);
          }}
          className="self-start text-xs text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]"
        >
          {ajustando ? '▾' : '▸'} Adjust ideas
        </button>

        <div className={cn('grid gap-2 sm:grid-cols-2', !ajustando && 'hidden')}>
          <Campo
            etiqueta="Topic or domain"
            valor={constraints.topic ?? ''}
            onChange={(topic) => {
              setConstraints((c) => ({ ...c, topic }));
            }}
          />
          <Campo
            etiqueta="Time you can give it"
            marcador="a weekend, a couple of months…"
            valor={constraints.timeAvailable ?? ''}
            onChange={(timeAvailable) => {
              setConstraints((c) => ({ ...c, timeAvailable }));
            }}
          />
          <Campo
            etiqueta="Who it's for"
            valor={constraints.audience ?? ''}
            onChange={(audience) => {
              setConstraints((c) => ({ ...c, audience }));
            }}
          />
          <Campo
            etiqueta="Platform"
            marcador="web, iOS, CLI…"
            valor={constraints.platform ?? ''}
            onChange={(platform) => {
              setConstraints((c) => ({ ...c, platform }));
            }}
          />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--color-texto-suave)]">How it should make money</span>
            <select
              value={constraints.monetisation ?? ''}
              onChange={(e) => {
                const valor = e.target.value;
                setConstraints((c) => {
                  /* Sin preferencia es no mandar el campo, no mandarlo vacío. */
                  const { monetisation: _, ...resto } = c;
                  return valor === ''
                    ? resto
                    : { ...resto, monetisation: valor as (typeof MONETISATIONS)[number] };
                });
              }}
              className="h-9 rounded-lg border border-[var(--color-borde)] bg-[var(--color-superficie)] px-2 text-sm"
            >
              <option value="">No preference</option>
              {MONETISATIONS.map((m) => (
                <option key={m} value={m}>
                  {MONETISATION_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <Campo
            etiqueta="Anything else"
            valor={constraints.notes ?? ''}
            onChange={(notes) => {
              setConstraints((c) => ({ ...c, notes }));
            }}
          />
        </div>

        {/*
          El único botón que queda, y solo con los ajustes abiertos: pedir ideas
          ya lo hizo «Get inspired», y cerrar se hace pulsándolo otra vez. Este
          existe porque cambiar una restricción no sirve de nada si no se puede
          volver a preguntar con ella.
        */}
        {ajustando && (
          <Button
            type="button"
            variant="secondary"
            className="self-start px-3 py-1.5 text-sm"
            disabled={generando}
            onClick={() => {
              generar();
            }}
          >
            {generando ? 'Thinking…' : 'Ask again with these'}
          </Button>
        )}
      </div>

      {error && (
        <p className="text-sm" style={{ color: 'var(--color-fallo)' }}>
          {error}
        </p>
      )}

      {/*
        De dónde salen las ideas, dicho antes de leerlas (RF-1304, RF-1305).
        Nunca se presenta como fundamentado lo que no lo está: una propuesta que
        aparenta tener datos detrás se decide creyendo que los hay.
      */}
      {grounded !== null && (
        <p className="text-xs text-[var(--color-texto-suave)]">
          {grounded
            ? 'Grounded in what was found on the web just now.'
            : 'This model did not search the web, so these come from its own memory — not from what the market looks like today.'}
        </p>
      )}

      {sources.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs">
          {sources.map((fuente) => (
            <li key={fuente.url}>
              <a
                href={fuente.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[var(--color-acento)] underline underline-offset-2"
              >
                {fuente.title}
              </a>
            </li>
          ))}
        </ul>
      )}

      {propuestas.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {propuestas.map((propuesta) => (
            <li key={propuesta.name}>
              <Ficha
                propuesta={propuesta}
                eligiendo={eligiendo === propuesta.name}
                bloqueada={eligiendo !== null}
                onElegir={() => {
                  elegir(propuesta);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {/*
        Mientras se busca, se dice; y cuando se puede pedir más, se ofrece. Nunca
        las dos cosas, y nunca ninguna: el botón desapareciendo sin nada en su
        lugar dejaba la pantalla quieta y sin explicación justo cuando más falta
        hace saber que algo está pasando.

        El barrido es el mismo que marca al modelo pensando en la ficha de una
        app. Mismo significado, misma señal: aprender dos lenguajes para lo mismo
        no le sirve a nadie.
      */}
      {generando ? (
        <p className="pensando self-start text-sm">
          {propuestas.length === 0
            ? 'Looking for something worth building…'
            : 'Looking for different ideas…'}
        </p>
      ) : (
        propuestas.length > 0 && (
          <Button
            type="button"
            variant="secondary"
            className="self-start px-3 py-1.5 text-sm"
            onClick={() => {
              generar(true);
            }}
          >
            More ideas, different ones
          </Button>
        )
      )}
    </div>
  );
}

/**
 * Las restricciones que de verdad se han puesto.
 *
 * Un campo que se escribió y se borró queda como cadena vacía, y mandarla no es
 * lo mismo que no mandar nada: el servidor la rechaza por longitud, y el modelo
 * la leería como una restricción en blanco. Aquí se van las dos cosas de golpe.
 */
function soloLoPuesto(constraints: IdeaConstraints): IdeaConstraints {
  const puestas: Record<string, string> = {};
  for (const [campo, valor] of Object.entries(constraints)) {
    if (typeof valor === 'string' && valor.trim() !== '') puestas[campo] = valor.trim();
  }
  return puestas;
}

function Campo({
  etiqueta,
  marcador,
  valor,
  onChange,
}: {
  etiqueta: string;
  marcador?: string;
  valor: string;
  onChange: (valor: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-[var(--color-texto-suave)]">{etiqueta}</span>
      <Input
        aria-label={etiqueta}
        {...(marcador === undefined ? {} : { placeholder: marcador })}
        value={valor}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </label>
  );
}

/**
 * Una propuesta, con los mismos campos que las demás.
 *
 * Mismos campos y en el mismo orden a propósito: son para compararlas, y cinco
 * fichas con forma distinta obligan a leerlas enteras para saber cuál interesa
 * (RF-1303).
 */
function Ficha({
  propuesta,
  eligiendo,
  bloqueada,
  onElegir,
}: {
  propuesta: IdeaProposal;
  eligiendo: boolean;
  bloqueada: boolean;
  onElegir: () => void;
}) {
  return (
    <Card className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{propuesta.name}</h3>
        <Badge>{MONETISATION_LABELS[propuesta.monetisation]}</Badge>
      </div>

      <Dato etiqueta="Problem">{propuesta.problem}</Dato>
      <Dato etiqueta="For">{propuesta.audience}</Dato>
      <Dato etiqueta="Why it matters">{propuesta.valueProposition}</Dato>
      <Dato etiqueta="Effort">{propuesta.effort}</Dato>
      <Dato etiqueta="Main risk">{propuesta.mainRisk}</Dato>

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="flex flex-wrap gap-1">
          {propuesta.tags.map((tag) => (
            <span key={tag} className="text-[10px] text-[var(--color-texto-suave)]">
              #{tag}
            </span>
          ))}
        </span>
        <Button
          type="button"
          className="px-2.5 py-1 text-xs"
          disabled={bloqueada}
          onClick={onElegir}
        >
          {eligiendo ? 'Creating…' : 'Build this one'}
        </Button>
      </div>
    </Card>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <p className="text-xs leading-relaxed">
      <span className="text-[var(--color-texto-suave)]">{etiqueta}: </span>
      {children}
    </p>
  );
}
