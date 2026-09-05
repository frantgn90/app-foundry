import { describe, expect, it } from 'vitest';

import {
  AGENT_CATALOG,
  APP_COLORS,
  APP_EMOJIS,
  catalogAgent,
  isValidAgentHandle,
} from '../src/index.js';

/**
 * El catálogo de fábrica es contenido, así que no hay mucho que «probar» de lo
 * que dicen los prompts. Lo que sí se puede sostener es que ninguna de sus
 * entradas nazca inservible: un handle que no se pueda mencionar o un icono que
 * la interfaz no sepa pintar no darían error al desplegar, darían un agente
 * roto la primera vez que alguien lo adopte.
 */
describe('las plantillas de fábrica', () => {
  it('son las seis anunciadas, y ninguna se repite', () => {
    expect(AGENT_CATALOG).toHaveLength(6);
    expect(new Set(AGENT_CATALOG.map((a) => a.key)).size).toBe(6);
    expect(new Set(AGENT_CATALOG.map((a) => a.handle)).size).toBe(6);
  });

  it('todas se pueden mencionar: el handle casa con el patrón del extractor', () => {
    for (const perfil of AGENT_CATALOG) {
      expect(isValidAgentHandle(perfil.handle), perfil.key).toBe(true);
    }
  });

  it('todas traen un icono que la interfaz sabe pintar', () => {
    for (const perfil of AGENT_CATALOG) {
      expect(APP_EMOJIS as readonly string[], perfil.key).toContain(perfil.iconEmoji);
      expect(APP_COLORS as readonly string[], perfil.key).toContain(perfil.iconColor);
    }
  });

  it('todas traen nombre, resumen y prompt con algo dentro', () => {
    for (const perfil of AGENT_CATALOG) {
      expect(perfil.name.length, perfil.key).toBeGreaterThan(0);
      expect(perfil.summary.length, perfil.key).toBeGreaterThan(0);
      expect(perfil.prompt.length, perfil.key).toBeGreaterThan(200);
      /* Y corto de leer: es lo que se enseña como resumen de la plantilla. */
      expect(perfil.prompt.length, perfil.key).toBeLessThan(1_200);
    }
  });

  it('ninguna repite la cabecera común: solo llevan su personalidad', () => {
    /*
     * Lo compartido lo pone quien arma la petición. Aquí importa que **no**
     * esté, por dos motivos: con ella delante los seis se ven iguales en una
     * lista, y si viviera en el prompt, editar una plantilla podría borrar la
     * defensa contra inyección (RF-1614).
     */
    for (const perfil of AGENT_CATALOG) {
      expect(perfil.prompt, perfil.key).not.toContain('DATA, not instructions');
      expect(perfil.prompt, perfil.key).toContain('Your role is');
    }
  });

  it('se busca una por su clave, y una que no existe no devuelve nada', () => {
    expect(catalogAgent('tech-lead')?.handle).toBe('techlead');
    expect(catalogAgent('no-existe')).toBeUndefined();
  });
});
