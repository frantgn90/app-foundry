import { describe, expect, it } from 'vitest';

import {
  checkStrictSchema,
  completeProposals,
  describeConstraints,
  IDEA_BATCH_SCHEMA,
  IDEAS_MAX,
  IDEAS_MIN,
  ideasMessages,
  ideasJsonSystemPrompt,
  ideasSystemPrompt,
  Monetisation,
  seedVision,
  VISION_TEMPLATE,
  type IdeaProposal,
} from '../src/index.js';

const propuesta: IdeaProposal = {
  name: 'Rutas',
  problem: 'Nadie sabe cuando pasa el autobus de verdad.',
  audience: 'Quien coge el autobus a diario en ciudades medianas.',
  valueProposition: 'Llegadas reales, no las teoricas del horario.',
  monetisation: Monetisation.FREEMIUM,
  effort: 'un par de meses',
  mainRisk: 'Que el ayuntamiento no publique datos en tiempo real.',
  tags: ['transporte', 'movilidad'],
  shortDescription: 'Llegadas de autobus de verdad.',
};

describe('el esquema de una tanda', () => {
  /*
   * Es lo único que impide que un esquema escrito para Anthropic falle en Groq
   * y solo se descubra en la primera llamada real, gastando cuota (T-24).
   */
  it('está en el subconjunto que aceptan los dos proveedores', () => {
    expect(checkStrictSchema(IDEA_BATCH_SCHEMA)).toEqual([]);
  });

  it('pide entre tres y cinco, que es lo que se puede comparar de un vistazo', () => {
    const lista = (
      IDEA_BATCH_SCHEMA as never as { properties: { proposals: Record<string, number> } }
    ).properties.proposals;

    expect(lista['minItems']).toBe(IDEAS_MIN);
    expect(lista['maxItems']).toBe(IDEAS_MAX);
  });

  /*
   * La monetización va como enumerado y no como texto libre porque es el campo
   * por el que se comparan: cinco propuestas que digan «suscripción», «de pago»
   * y «freemium con extras» no se comparan, se leen.
   */
  it('la monetización es cerrada', () => {
    const campos = (
      IDEA_BATCH_SCHEMA as never as {
        properties: { proposals: { items: { properties: Record<string, { enum?: string[] }> } } };
      }
    ).properties.proposals.items.properties;

    expect(campos['monetisation']?.enum).toContain('SUBSCRIPTION');
  });
});

describe('las restricciones', () => {
  /*
   * Todas opcionales, y eso es el requisito (RF-1302): quien llega sin saber qué
   * construir tampoco sabe para quién ni con qué modelo de negocio.
   */
  it('sin ninguna, se dice que no hay ninguna en vez de mandar un hueco', () => {
    const texto = describeConstraints({});

    expect(texto).toMatch(/no constraints/i);
    expect(texto.trim()).not.toBe('');
  });

  it('con algunas, solo salen las que hay', () => {
    const texto = describeConstraints({ topic: 'transporte', monetisation: Monetisation.FREE });

    expect(texto).toContain('transporte');
    expect(texto).toContain('FREE');
    expect(texto).not.toMatch(/platform/i);
  });

  it('lo que viene en blanco no cuenta como puesto', () => {
    expect(describeConstraints({ topic: '   ' })).toMatch(/no constraints/i);
  });
});

describe('el papel según haya o no búsqueda', () => {
  /*
   * La línea que no se cruza (RF-1305): lo que sale del conocimiento del modelo
   * no se presenta como si saliera del mercado.
   */
  it('sin hallazgos, se le prohíbe expresamente aparentar que los hay', () => {
    expect(ideasSystemPrompt(false)).toMatch(/do not claim/i);
  });

  it('con hallazgos, se le exige citarlos y no inventarlos', () => {
    const sistema = ideasSystemPrompt(true);

    expect(sistema).toMatch(/ground each idea/i);
    expect(sistema).toMatch(/do not invent/i);
  });
});

describe('pedir otra tanda', () => {
  /*
   * Las ya vistas viajan como exclusiones y no como «dame otras»: el modelo no
   * recuerda la tanda anterior, así que pedirle variedad sin decirle de qué
   * produce las mismas ideas con otras palabras (RF-1307).
   */
  it('los nombres vistos van dentro, y se pide que sean apuestas distintas', () => {
    const [mensaje] = ideasMessages({ constraints: {}, exclude: ['Rutas', 'Paradas'] });

    expect(mensaje?.content).toContain('Rutas');
    expect(mensaje?.content).toContain('<already-proposed>');
    expect(mensaje?.content).toMatch(/different bets/i);
  });

  it('en la primera tanda no se manda esa sección, ni vacía', () => {
    const [mensaje] = ideasMessages({ constraints: {} });

    expect(mensaje?.content).not.toContain('already-proposed');
  });

  it('los hallazgos van etiquetados aparte de lo que se pide', () => {
    const [mensaje] = ideasMessages({ constraints: {}, research: 'lo que encontre' });

    expect(mensaje?.content).toContain('<research>\nlo que encontre\n</research>');
  });
});

describe('la visión sembrada', () => {
  /*
   * Misma estructura que la plantilla de la v1 (RF-503): quien edite esto
   * después se encuentra el documento que ya conoce, con parte contestada, en
   * vez de un texto ajeno con otra forma.
   */
  it('conserva los títulos de la plantilla y contesta lo que la propuesta cubre', () => {
    const vision = seedVision(propuesta);

    for (const titulo of ['# The problem', "# Who it's for", '# The value proposition']) {
      expect(VISION_TEMPLATE).toContain(titulo);
      expect(vision).toContain(titulo);
    }
    expect(vision).toContain('Nadie sabe cuando pasa el autobus');
  });

  /*
   * Y lo que no cubre se queda como pregunta. Rellenarlo con algo plausible
   * convertiría un borrador en un documento inventado, que es mucho peor: uno se
   * nota que está a medias y el otro no.
   */
  it('lo que la propuesta no cubre queda por decidir, no relleno', () => {
    expect(seedVision(propuesta)).toMatch(/not decided yet/i);
  });

  it('las fuentes, si las hubo, quedan en el documento con su enlace', () => {
    const vision = seedVision(propuesta, [{ url: 'https://ejemplo.test/a', title: 'Un informe' }]);

    expect(vision).toContain('[Un informe](https://ejemplo.test/a)');
  });

  it('sin fuentes no aparece esa sección vacía', () => {
    expect(seedVision(propuesta)).not.toMatch(/where this came from/i);
  });
});

describe('las propuestas conforme llegan', () => {
  const json = (n: number) =>
    JSON.stringify({
      proposals: Array.from({ length: n }, (_, i) => ({ ...propuesta, name: `Idea ${String(i)}` })),
    });

  /*
   * El objeto final no existe hasta el último carácter, pero las propuestas se
   * cierran de una en una. Sin esto, quien pide ideas mira una pantalla en
   * blanco toda la generación y luego le aparecen cinco de golpe (RF-1306).
   */
  it('salen las que ya están cerradas, y la que va a medias no', () => {
    const entero = json(3);
    /* Justo detrás de la segunda llave que cierra: la tercera va a medias. */
    const cortado = entero.slice(0, entero.lastIndexOf('},{') + 1);

    expect(completeProposals(cortado)).toHaveLength(2);
    expect(completeProposals(entero)).toHaveLength(3);
  });

  it('crece conforme crece el texto, sin saltos ni repeticiones', () => {
    const entero = json(4);
    const vistas = new Set<string>();
    let ultimas = 0;

    for (let corte = 0; corte <= entero.length + 7; corte += 7) {
      const parciales = completeProposals(entero.slice(0, corte));
      expect(parciales.length).toBeGreaterThanOrEqual(ultimas);
      ultimas = parciales.length;
      for (const p of parciales) vistas.add(p.name);
    }

    expect(ultimas).toBe(4);
    expect(vistas.size).toBe(4);
  });

  /*
   * Una llave dentro de una cadena no abre nada, y una comilla escapada no
   * cierra la cadena: sin llevar ese estado, una propuesta que hable de «{}» o
   * lleve comillas partiría el recorrido por la mitad.
   */
  it('las llaves y las comillas dentro del texto no confunden el recorrido', () => {
    const rara = {
      ...propuesta,
      problem: 'Escribir { y } y una "cita" con \\ dentro',
      name: 'Con llaves',
    };
    const texto = JSON.stringify({ proposals: [rara, propuesta] });

    const sacadas = completeProposals(texto);
    expect(sacadas).toHaveLength(2);
    expect(sacadas[0]?.problem).toContain('{');
  });

  it('una propuesta a la que le falta un campo no se enseña', () => {
    const coja = JSON.stringify({ proposals: [{ name: 'Solo el nombre' }, propuesta] });

    expect(completeProposals(coja)).toHaveLength(1);
  });

  it('sin la lista todavía, no hay nada que enseñar', () => {
    expect(completeProposals('{"prop')).toEqual([]);
  });
});

describe('cuando el modelo no sabe ceñirse a un esquema', () => {
  /*
   * Groq garantiza la forma solo en algunos modelos y el resto rechaza el
   * formato de plano. Sin esta salida, «no sé qué construir» dejaba de existir
   * para quien tuviera asignado cualquiera de ellos.
   */
  it('la forma se describe en el encargo, con el esquema dentro', () => {
    const sistema = ideasJsonSystemPrompt(false);

    expect(sistema).toContain('valueProposition');
    expect(sistema).toContain('SUBSCRIPTION');
    expect(sistema).toMatch(/single JSON object and nothing else/i);
  });

  it('sigue siendo el mismo encargo: lo que cambia es dónde va la forma', () => {
    expect(ideasJsonSystemPrompt(true)).toContain(ideasSystemPrompt(true));
    /* Y la regla de no fingir fundamento viaja igual. */
    expect(ideasJsonSystemPrompt(false)).toMatch(/do not claim/i);
  });
});
