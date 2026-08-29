import { describe, expect, it } from 'vitest';

import {
  APP_COLORS,
  APP_EMOJIS,
  defaultIcon,
  isValidIcon,
  slugify,
  uniqueSlug,
  VISION_TEMPLATE,
} from '../src/index.js';

describe('icono por defecto', () => {
  it('es siempre el mismo para la misma app', () => {
    const id = '01a04ad8-040b-75e2-a686-50481dc30781';
    expect(defaultIcon(id)).toEqual(defaultIcon(id));
  });

  it('sale del catálogo curado', () => {
    const icono = defaultIcon('cualquier-identificador');
    expect(isValidIcon(icono)).toBe(true);
  });

  it('reparte bien: veinte apps seguidas no salen todas iguales', () => {
    const iconos = Array.from({ length: 20 }, (_, i) =>
      defaultIcon(`01a04ad8-040b-75e2-a686-50481dc307${String(i).padStart(2, '0')}`),
    );
    const distintos = new Set(iconos.map((i) => `${i.emoji}${i.color}`));
    // Con 40 emojis y 10 colores, veinte apps deberían dar bastante variedad.
    expect(distintos.size).toBeGreaterThan(12);
  });

  it('rechaza un emoji que no está en el catálogo', () => {
    expect(isValidIcon({ emoji: '🦄', color: 'amber' })).toBe(false);
    expect(isValidIcon({ emoji: APP_EMOJIS[0], color: 'fucsia' })).toBe(false);
    expect(isValidIcon({ emoji: APP_EMOJIS[0], color: APP_COLORS[0] })).toBe(true);
  });
});

describe('slug', () => {
  it('convierte un nombre normal', () => {
    expect(slugify('Mi Nueva App')).toBe('mi-nueva-app');
  });

  it('quita los acentos en lugar de comerse las letras', () => {
    expect(slugify('Visión Estratégica')).toBe('vision-estrategica');
  });

  it('no deja guiones sueltos en los extremos', () => {
    expect(slugify('  ¿Y esto? ')).toBe('y-esto');
    expect(slugify('App!!!')).toBe('app');
  });

  it('un nombre sin caracteres convertibles no produce una URL vacía', () => {
    expect(slugify('🚀🚀🚀')).toBe('app');
    expect(slugify('')).toBe('app');
  });

  it('busca hueco cuando el slug ya está cogido', () => {
    expect(uniqueSlug('Mi App', [])).toBe('mi-app');
    expect(uniqueSlug('Mi App', ['mi-app'])).toBe('mi-app-2');
    expect(uniqueSlug('Mi App', ['mi-app', 'mi-app-2'])).toBe('mi-app-3');
  });
});

describe('plantilla de visión', () => {
  it('propone secciones como preguntas, no como epígrafes vacíos', () => {
    expect(VISION_TEMPLATE).toContain('# The problem');
    expect(VISION_TEMPLATE).toContain('# Who it');
    expect(VISION_TEMPLATE).toContain('# Risks and open questions');
    // Cada sección lleva una pregunta debajo: una plantilla de títulos sueltos
    // se rellena por compromiso.
    expect(VISION_TEMPLATE).toContain('?');
  });
});
