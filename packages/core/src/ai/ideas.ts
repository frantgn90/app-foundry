import type { JsonSchema, PromptMessage, WebSource } from './provider.js';

/**
 * Generación de ideas de app (RF-1301..1312, TRD v2 §12.1).
 *
 * Vive en el dominio por lo mismo que el asistente: qué se le pide a un modelo y
 * qué se le manda son decisiones de producto. La ruta HTTP solo lo conecta con
 * un proveedor, y la interfaz solo lo enseña.
 */

/** Cuántas propuestas se piden. Entre tres y cinco (RF-1303). */
export const IDEAS_MIN = 3;
export const IDEAS_MAX = 5;

/** Cómo se piensa cobrar por ella, si es que se cobra. */
export const Monetisation = {
  FREE: 'FREE',
  ONE_OFF: 'ONE_OFF',
  SUBSCRIPTION: 'SUBSCRIPTION',
  FREEMIUM: 'FREEMIUM',
} as const;
export type Monetisation = (typeof Monetisation)[keyof typeof Monetisation];

export const MONETISATIONS: readonly Monetisation[] = Object.values(Monetisation);

/**
 * Lo que alguien puede acotar antes de pedir ideas (RF-1302).
 *
 * **Todo es opcional, y eso es el requisito, no una comodidad.** Quien llega sin
 * saber qué construir tampoco sabe para quién ni con qué modelo de negocio; un
 * formulario obligatorio le pediría precisamente lo que ha venido a buscar.
 */
export interface IdeaConstraints {
  readonly topic?: string;
  /** Tiempo del que se dispone, tal como lo diría una persona: «un fin de semana». */
  readonly timeAvailable?: string;
  readonly monetisation?: Monetisation;
  readonly audience?: string;
  readonly platform?: string;
  readonly notes?: string;
}

/**
 * Una propuesta, con lo justo para poder compararla con las demás (RF-1303).
 *
 * Los campos son los mismos para todas a propósito: comparables entre sí es lo
 * que las hace útiles. Cinco descripciones libres serían cinco cosas que hay que
 * leer enteras para saber cuál interesa.
 */
export interface IdeaProposal {
  readonly name: string;
  readonly problem: string;
  readonly audience: string;
  readonly valueProposition: string;
  readonly monetisation: Monetisation;
  /** Esfuerzo, en las palabras del modelo: «un fin de semana», «dos meses». */
  readonly effort: string;
  readonly mainRisk: string;
  readonly tags: readonly string[];
  /** Descripción de una línea, que es la que hereda la app al crearla. */
  readonly shortDescription: string;
}

export interface IdeaBatch {
  readonly proposals: readonly IdeaProposal[];
}

/**
 * El esquema, escrito en el subconjunto estricto (T-24).
 *
 * Todos los campos obligatorios y sin propiedades extra, que es lo único que
 * acepta la decodificación restringida de Groq y que Anthropic admite sin
 * problema. Escribirlo así desde el principio evita una traducción por
 * proveedor que fallaría en la primera llamada real.
 *
 * `monetisation` va como enumerado y no como texto libre porque es el campo por
 * el que se compara: cinco propuestas que digan «suscripción», «de pago» y
 * «freemium con extras» no se comparan, se leen.
 */
export const IDEA_BATCH_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      minItems: IDEAS_MIN,
      maxItems: IDEAS_MAX,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name',
          'problem',
          'audience',
          'valueProposition',
          'monetisation',
          'effort',
          'mainRisk',
          'tags',
          'shortDescription',
        ],
        properties: {
          name: { type: 'string' },
          problem: { type: 'string' },
          audience: { type: 'string' },
          valueProposition: { type: 'string' },
          monetisation: { type: 'string', enum: [...MONETISATIONS] },
          effort: { type: 'string' },
          mainRisk: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          shortDescription: { type: 'string' },
        },
      },
    },
  },
};

/**
 * Lo que se le pide al modelo que investigue, antes de dar forma a nada (T-25).
 *
 * Va en dos llamadas y no en una porque combinar búsqueda de servidor con salida
 * forzada a esquema no está garantizado en ninguno de los dos proveedores.
 * Separarlo es determinista y, de paso, deja la fase cara —la de búsqueda— sola
 * y por tanto interrumpible.
 */
export function researchSystemPrompt(): string {
  return [
    'You research the current state of a software niche so someone can decide what to build.',
    '',
    'Search for what exists today, what people complain about, and where the gaps are.',
    'Report findings, not ideas: what you found, and where you found it.',
    'Prefer recent, specific and checkable facts over general impressions.',
    'If you find little, say so plainly. An honest "not much out there" is useful; padding is not.',
  ].join('\n');
}

/**
 * El papel al dar forma a las propuestas.
 *
 * La regla que sostiene todo lo demás es la de no fingir fundamento (RF-1305):
 * con hallazgos delante se citan, y sin ellos se dice que esto sale de lo que el
 * modelo sabe. Una propuesta que aparenta estar respaldada por datos es peor que
 * ninguna, porque se decide sobre ella creyendo que los hay.
 */
export function ideasSystemPrompt(grounded: boolean): string {
  return [
    'You propose app ideas that someone could actually build, and you make them comparable.',
    '',
    'Rules:',
    `1. Propose between ${String(IDEAS_MIN)} and ${String(IDEAS_MAX)} ideas. Each one must be a different bet, not the same idea with another name.`,
    '2. Fill every field for every idea. Same fields, same depth: they are meant to be compared side by side.',
    '3. Be concrete. "A tool for teams" is not a problem; "standups eat 20 minutes because nobody remembers what they did" is.',
    '4. Effort is a rough calendar estimate for one person, in plain words.',
    '5. The main risk is what would sink the idea, not a generic caveat.',
    grounded
      ? '6. Ground each idea in the research you were given, and do not invent findings that are not there.'
      : '6. You have no research to work from, so propose from what you know and do not claim that any of this reflects current market data.',
  ].join('\n');
}

/** El material: las restricciones, y los hallazgos si los hubo. */
export function ideasMessages(input: {
  readonly constraints: IdeaConstraints;
  readonly research?: string;
  /** Nombres ya propuestos que no deben repetirse (RF-1307). */
  readonly exclude?: readonly string[];
}): PromptMessage[] {
  const partes: string[] = [];

  if (input.research) {
    partes.push('<research>', input.research, '</research>', '');
  }

  partes.push('<constraints>', describeConstraints(input.constraints), '</constraints>');

  if (input.exclude && input.exclude.length > 0) {
    /*
     * Las ya vistas viajan como exclusiones y no como «dame otras»: el modelo no
     * recuerda la tanda anterior, así que pedirle variedad sin decirle de qué
     * produce las mismas ideas con otras palabras.
     */
    partes.push(
      '',
      '<already-proposed>',
      input.exclude.join('\n'),
      '</already-proposed>',
      '',
      '<instruction>Propose different ideas from the ones already proposed. Not variations of them: different bets.</instruction>',
    );
  }

  return [{ role: 'user', content: partes.join('\n') }];
}

/** Lo que se manda a investigar, que es el tema y poco más. */
export function researchMessages(constraints: IdeaConstraints): PromptMessage[] {
  return [
    {
      role: 'user',
      content: ['<constraints>', describeConstraints(constraints), '</constraints>'].join('\n'),
    },
  ];
}

/**
 * Las restricciones, en palabras.
 *
 * Sin ninguna se dice **que no hay ninguna**, en vez de mandar una lista vacía:
 * un hueco en el prompt invita a rellenarlo con suposiciones, y decir «campo
 * abierto» es una instrucción y no un descuido.
 */
export function describeConstraints(constraints: IdeaConstraints): string {
  const lineas = [
    ['Topic or domain', constraints.topic],
    ['Time available to build it', constraints.timeAvailable],
    ['Preferred monetisation', constraints.monetisation],
    ['Who it should be for', constraints.audience],
    ['Platform', constraints.platform],
    ['Other notes', constraints.notes],
  ]
    .filter(([, valor]) => typeof valor === 'string' && valor.trim() !== '')
    .map(([etiqueta, valor]) => `- ${String(etiqueta)}: ${String(valor).trim()}`);

  if (lineas.length === 0) {
    return 'No constraints given. Anything goes, so pick niches worth caring about rather than playing safe.';
  }
  return lineas.join('\n');
}

/**
 * La visión sembrada a partir de una propuesta (RF-1308).
 *
 * Sigue la estructura de la plantilla de la v1: mismos títulos, en el mismo
 * orden. No es respeto por la plantilla, es que quien edite esto después va a
 * encontrarse el documento que ya conoce, con parte de las preguntas
 * contestadas en lugar de un texto ajeno con otra forma.
 *
 * Lo que la propuesta no cubre se queda **como pregunta**, no relleno con algo
 * plausible: la diferencia entre un borrador y un documento inventado es
 * justamente que el borrador se nota que está a medias.
 */
export function seedVision(proposal: IdeaProposal, sources: readonly WebSource[] = []): string {
  const bloques = [
    `# The problem\n\n${proposal.problem}`,
    `# Who it's for\n\n${proposal.audience}`,
    `# The value proposition\n\n${proposal.valueProposition}`,
    `# How it works, roughly\n\nNot decided yet. This is where the shape of the thing goes.`,
    `# What makes it different\n\nNot decided yet. Something like this probably exists — why is yours worth building anyway?`,
    `# How we'll know it works\n\nNot decided yet. What would you have to see to say this was a good idea?`,
    `# Risks and open questions\n\n${proposal.mainRisk}`,
    `# How it could pay for itself\n\n${monetisationLabel(proposal.monetisation)}. Estimated effort: ${proposal.effort}.`,
  ];

  if (sources.length > 0) {
    bloques.push(
      `# Where this came from\n\n${sources
        .map((fuente) => `- [${fuente.title}](${fuente.url})`)
        .join('\n')}`,
    );
  }

  return `${bloques.join('\n\n')}\n`;
}

export function monetisationLabel(monetisation: Monetisation): string {
  switch (monetisation) {
    case Monetisation.FREE:
      return 'Free';
    case Monetisation.ONE_OFF:
      return 'One-off payment';
    case Monetisation.SUBSCRIPTION:
      return 'Subscription';
    case Monetisation.FREEMIUM:
      return 'Freemium';
  }
}

/**
 * Las propuestas ya completas dentro de un JSON a medio llegar (RF-1306).
 *
 * El objeto final no existe hasta el último carácter, pero las propuestas se
 * cierran de una en una: en cuanto una llave se equilibra, esa idea ya se puede
 * enseñar. Sin esto, quien pide ideas mira una pantalla en blanco durante toda
 * la generación y luego le aparecen cinco de golpe.
 *
 * Se recorre a mano y no con un analizador tolerante porque lo que hace falta es
 * muy poco: saber dónde empieza y acaba cada objeto de la lista. Lo que obliga a
 * llevar estado es que una llave dentro de una cadena —«{» en un texto— no
 * cuenta, y una comilla escapada tampoco cierra la cadena.
 */
export function completeProposals(json: string): IdeaProposal[] {
  const lista = json.indexOf('"proposals"');
  if (lista === -1) return [];

  const corchete = json.indexOf('[', lista);
  if (corchete === -1) return [];

  const propuestas: IdeaProposal[] = [];
  let profundidad = 0;
  let inicio = -1;
  let enCadena = false;
  let escapado = false;

  for (let i = corchete + 1; i < json.length; i += 1) {
    const c = json[i]!;

    if (enCadena) {
      if (escapado) escapado = false;
      else if (c === '\\') escapado = true;
      else if (c === '"') enCadena = false;
      continue;
    }

    if (c === '"') {
      enCadena = true;
      continue;
    }
    if (c === '{') {
      if (profundidad === 0) inicio = i;
      profundidad += 1;
      continue;
    }
    if (c === '}') {
      profundidad -= 1;
      if (profundidad !== 0 || inicio === -1) continue;

      const candidata = parseProposal(json.slice(inicio, i + 1));
      if (candidata) propuestas.push(candidata);
      inicio = -1;
      continue;
    }
    /* El cierre de la lista: lo que venga después ya no son propuestas. */
    if (c === ']' && profundidad === 0) break;
  }

  return propuestas;
}

/**
 * Una propuesta, si lo que hay lo es de verdad.
 *
 * Se comprueba aunque la decodificación esté restringida por esquema: lo que
 * llega a mitad de un flujo no está garantizado por nada, y enseñar una ficha a
 * medias con campos vacíos es peor que enseñarla un segundo más tarde.
 */
export function parseProposal(json: string): IdeaProposal | null {
  let valor: unknown;
  try {
    valor = JSON.parse(json);
  } catch {
    return null;
  }
  return isIdeaProposal(valor) ? valor : null;
}

export function isIdeaProposal(value: unknown): value is IdeaProposal {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;

  const textos = [
    'name',
    'problem',
    'audience',
    'valueProposition',
    'effort',
    'mainRisk',
    'shortDescription',
  ];
  if (!textos.every((campo) => typeof v[campo] === 'string' && v[campo].trim() !== '')) {
    return false;
  }
  if (!MONETISATIONS.includes(v['monetisation'] as Monetisation)) return false;
  return Array.isArray(v['tags']) && v['tags'].every((t) => typeof t === 'string');
}
