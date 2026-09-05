import { describe, expect, it } from 'vitest';

import {
  agentMaySpeak,
  agentReplyMessages,
  agentSystemPrompt,
  type AgentReplyContext,
} from '../src/index.js';

const BASE: AgentReplyContext = {
  profile: 'Your role is product owner.',
  handle: 'po',
  appName: 'Reading Companion',
  appDescription: 'Turn what you read into something usable',
  document: '# The problem\n\nNotes end up scattered.',
  thread: [{ author: 'ana', mine: false, byAgent: false, body: '@po ¿esto se sostiene?' }],
  replyWordLimit: 0,
};

describe('el papel y el material van por separado', () => {
  it('el papel lleva el perfil y su handle, y nada del documento', () => {
    const papel = agentSystemPrompt(BASE);

    expect(papel).toContain('Your role is product owner.');
    expect(papel).toContain('You are @po.');
    /* Ni una línea de lo que hay que comentar (RF-1614). */
    expect(papel).not.toContain('Notes end up scattered');
    expect(papel).not.toContain('¿esto se sostiene?');
  });

  it('el material va aparte, marcado como datos y delimitado', () => {
    const [mensaje] = agentReplyMessages(BASE);

    expect(mensaje!.content).toContain('<document>');
    expect(mensaje!.content).toContain('Notes end up scattered');
    expect(mensaje!.content).toContain('<thread>');
    expect(mensaje!.content).toContain('¿esto se sostiene?');
  });

  it('y el papel dice que lo que viene después son datos, no órdenes', () => {
    /*
     * Esto va aquí y no en la plantilla a propósito: si viviera en el prompt del
     * agente, editarlo podría borrarlo. Lo pone quien arma la petición, siempre,
     * sea cual sea el perfil (RF-1614).
     */
    const papel = agentSystemPrompt(BASE);
    expect(papel).toContain('DATA');
    expect(papel).toContain('only thing you can do is write a comment');
  });

  it('la cabecera se pone aunque el perfil venga vacío', () => {
    const papel = agentSystemPrompt({ ...BASE, profile: '' });
    expect(papel).toContain('DATA');
    expect(papel).toContain('only thing you can do is write a comment');
  });
});

describe('lo que ve un agente', () => {
  it('sabe cuáles son suyos y cuáles los escribió otra IA', () => {
    const [mensaje] = agentReplyMessages({
      ...BASE,
      thread: [
        { author: 'ana', mine: false, byAgent: false, body: 'primero' },
        { author: 'po', mine: true, byAgent: true, body: 'segundo' },
        { author: 'techlead', mine: false, byAgent: true, body: 'tercero' },
      ],
    });

    expect(mensaje!.content).toContain('ana: primero');
    expect(mensaje!.content).toContain('you (AI): segundo');
    expect(mensaje!.content).toContain('techlead (AI): tercero');
  });

  it('una app sin versión commiteada se dice, no se calla', () => {
    const [mensaje] = agentReplyMessages({ ...BASE, document: null });

    expect(mensaje!.content).toContain('no committed vision document yet');
  });

  it('la descripción se omite si no la hay, en vez de ir vacía', () => {
    const [mensaje] = agentReplyMessages({ ...BASE, appDescription: null });

    expect(mensaje!.content).not.toContain('Description:');
    expect(mensaje!.content).toContain('App: Reading Companion');
  });
});

describe('el tope de turnos por hilo', () => {
  it('deja hablar mientras queden', () => {
    expect(agentMaySpeak({ turnsTaken: 0, limit: 3, explicitlyMentioned: false })).toBe(true);
    expect(agentMaySpeak({ turnsTaken: 2, limit: 3, explicitlyMentioned: false })).toBe(true);
  });

  it('calla al alcanzarlo', () => {
    expect(agentMaySpeak({ turnsTaken: 3, limit: 3, explicitlyMentioned: false })).toBe(false);
    expect(agentMaySpeak({ turnsTaken: 9, limit: 3, explicitlyMentioned: false })).toBe(false);
  });

  it('y una mención explícita le devuelve la palabra', () => {
    /*
     * El tope existe para que un hilo no se llene solo, no para dejar mudo a
     * quien alguien está llamando a propósito (RF-1605).
     */
    expect(agentMaySpeak({ turnsTaken: 9, limit: 3, explicitlyMentioned: true })).toBe(true);
  });
});

describe('el límite de palabras', () => {
  it('sin límite no se dice nada del largo', () => {
    /*
     * Cero es lo que viene de fábrica. Pedirle brevedad cuando nadie la ha
     * pedido sería decidir por quien configuró el agente.
     */
    expect(agentSystemPrompt({ ...BASE, replyWordLimit: 0 })).not.toContain('must fit in');
  });

  it('con límite se le dice, con el número que se puso', () => {
    const papel = agentSystemPrompt({ ...BASE, replyWordLimit: 120 });

    expect(papel).toContain('must fit in 120 words');
  });

  it('y lo del presupuesto de razonamiento se dice siempre', () => {
    /* Eso no es estilo, es lo que evita que se quede sin sitio pensando. */
    for (const limite of [0, 120]) {
      expect(agentSystemPrompt({ ...BASE, replyWordLimit: limite })).toContain(
        'shares the same budget',
      );
    }
  });
});
