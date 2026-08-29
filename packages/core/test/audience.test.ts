import { describe, expect, it } from 'vitest';

import { audiencia } from '../src/notifications/audience.js';

const ana = 'usuario-ana';
const bruno = 'usuario-bruno';
const carla = 'usuario-carla';

describe('nadie se entera de lo suyo', () => {
  it('comentar en tu propia app no te avisa', () => {
    // RF-905. Es el caso más frecuente —el precursor comenta su propia idea— y
    // el más molesto si se escapa.
    expect(audiencia('APP_COMMENTED', { actor: ana, precursor: ana })).toEqual([]);
  });

  it('ni siquiera mencionándote a ti mismo', () => {
    expect(audiencia('APP_COMMENTED', { actor: ana, precursor: ana, mencionados: [ana] })).toEqual(
      [],
    );
  });
});

describe('un hilo nuevo', () => {
  it('avisa al precursor y a quien ya se implicó', () => {
    const avisos = audiencia('APP_COMMENTED', {
      actor: carla,
      precursor: ana,
      participantes: [bruno],
    });

    expect(avisos).toEqual([
      { userId: ana, type: 'APP_COMMENTED' },
      { userId: bruno, type: 'APP_COMMENTED' },
    ]);
  });

  it('no repite a quien es precursor y participante a la vez', () => {
    const avisos = audiencia('APP_COMMENTED', {
      actor: carla,
      precursor: ana,
      participantes: [ana, bruno],
    });

    expect(avisos.filter((a) => a.userId === ana)).toHaveLength(1);
  });
});

describe('una respuesta', () => {
  it('se queda en la conversación y no salpica a toda la app', () => {
    // Quien participó en otro hilo de la misma app no tiene por qué enterarse:
    // si no, un hilo largo acaba notificando a quien lo dejó hace tiempo.
    const avisos = audiencia('THREAD_REPLIED', {
      actor: carla,
      precursor: 'usuario-daniela',
      participantes: ['usuario-elena'],
      autorDelHilo: ana,
      participantesDelHilo: [ana, bruno],
    });

    expect(avisos.map((a) => a.userId).sort()).toEqual([ana, bruno].sort());
  });
});

describe('resolver un hilo', () => {
  it('avisa a quien lo abrió', () => {
    expect(audiencia('THREAD_RESOLVED', { actor: bruno, autorDelHilo: ana })).toEqual([
      { userId: ana, type: 'THREAD_RESOLVED' },
    ]);
  });

  it('y a nadie si lo cierra quien lo abrió', () => {
    expect(audiencia('THREAD_RESOLVED', { actor: ana, autorDelHilo: ana })).toEqual([]);
  });
});

describe('menciones', () => {
  it('alcanzan a quien no participa', () => {
    // RF-908: te mencionan para traerte a la conversación, así que no puede
    // exigir estar ya en ella.
    const avisos = audiencia('THREAD_REPLIED', {
      actor: ana,
      autorDelHilo: ana,
      participantesDelHilo: [ana],
      mencionados: [carla],
    });

    expect(avisos).toEqual([{ userId: carla, type: 'MENTIONED' }]);
  });

  it('ganan al aviso genérico cuando coinciden', () => {
    // Bruno está en el hilo y además le mencionan: recibe una sola cosa, y es la
    // mención, que es la que de verdad le reclama.
    const avisos = audiencia('THREAD_REPLIED', {
      actor: ana,
      autorDelHilo: bruno,
      participantesDelHilo: [bruno],
      mencionados: [bruno],
    });

    expect(avisos).toEqual([{ userId: bruno, type: 'MENTIONED' }]);
  });

  it('no duplican si el texto repite el mismo handle', () => {
    const avisos = audiencia('APP_COMMENTED', {
      actor: ana,
      mencionados: [bruno, bruno, bruno],
    });

    expect(avisos).toHaveLength(1);
  });
});

describe('acciones dirigidas a alguien', () => {
  it('la invitación llega solo al invitado', () => {
    expect(audiencia('WORKSPACE_INVITED', { actor: ana, destinatario: bruno })).toEqual([
      { userId: bruno, type: 'WORKSPACE_INVITED' },
    ]);
  });

  it('el traspaso de precursor llega a quien lo recibe', () => {
    expect(
      audiencia('PRECURSOR_TRANSFERRED', { actor: ana, destinatario: bruno, precursor: ana }),
    ).toEqual([{ userId: bruno, type: 'PRECURSOR_TRANSFERRED' }]);
  });

  it('heredar apps al marcharse alguien avisa a quien las hereda', () => {
    expect(audiencia('APPS_INHERITED', { actor: bruno, destinatario: ana })).toEqual([
      { userId: ana, type: 'APPS_INHERITED' },
    ]);
  });
});

describe('guardar una versión', () => {
  it('avisa a quien sostiene la app', () => {
    const avisos = audiencia('DOCUMENT_VERSION_SAVED', {
      actor: bruno,
      precursor: ana,
      participantes: [carla],
    });

    expect(avisos.map((a) => a.userId).sort()).toEqual([ana, carla].sort());
  });
});
