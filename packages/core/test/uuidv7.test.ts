import { describe, expect, it } from 'vitest';

import { uuidv7 } from '../src/uuidv7.js';

describe('uuidv7', () => {
  it('tiene la forma de un uuid', () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('declara versión 7 y variante RFC 4122', () => {
    // Postgres valida el tipo, pero no la versión: un v4 colado aquí pasaría
    // desapercibido hasta que el orden temporal dejara de cumplirse.
    const id = uuidv7();
    expect(id[14]).toBe('7');
    expect('89ab').toContain(id[19]);
  });

  it('ordena igual que el tiempo', () => {
    // Es la propiedad por la que se usa v7 y no v4: de ella dependen el índice
    // por fecha y la reanudación del canal en tiempo real.
    const antes = uuidv7(1_700_000_000_000);
    const despues = uuidv7(1_700_000_001_000);
    expect(antes < despues).toBe(true);
  });

  it('no repite dentro del mismo milisegundo', () => {
    const generados = new Set(Array.from({ length: 1000 }, () => uuidv7(1_700_000_000_000)));
    expect(generados.size).toBe(1000);
  });

  it('conserva la marca de tiempo', () => {
    const momento = 1_735_689_600_000;
    const ms = Number.parseInt(uuidv7(momento).replace(/-/g, '').slice(0, 12), 16);
    expect(ms).toBe(momento);
  });
});
