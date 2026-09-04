import { expect, test } from '@playwright/test';

import { crearSesion } from '../helpers/sesion.js';

/**
 * Saltar de una app a otra sin recargar deja la pantalla limpia.
 *
 * La pantalla de una app se llevaba consigo el estado de la anterior al cambiar
 * de app —solo cambiaba una prop, no se remontaba—, y con él el borrador. El
 * resultado era desconcertante y difícil de contar: leyendo se veía el
 * documento correcto y editando el de la app que se acababa de dejar, con el
 * punto de «hay cambios sin guardar» encendido sin haber escrito nada. Peor
 * todavía, guardar ahí escribía el texto ajeno con la revisión buena de esta
 * app, sin conflicto que lo frenara.
 *
 * De ahí que se compruebe también lo que queda en el almacenamiento local:
 * volver a abrir la app tenía que encontrarla como estaba, no con el borrador
 * de la otra puesto encima.
 */
const ASTROLABIO = 'Medir la altura de una estrella sobre el horizonte.';
const SEXTANTE = 'Medir el angulo entre dos puntos desde una cubierta que se mueve.';

test('cambiar de app no arrastra el documento de la anterior', async ({ page, context }) => {
  const { cookie } = await crearSesion('cambio-de-app');
  await context.addCookies([
    { name: 'foundry_session', value: cookie, url: 'http://localhost:4173' },
  ]);

  const erroresDePagina: string[] = [];
  page.on('pageerror', (e) => erroresDePagina.push(e.message));

  await page.goto('/');

  const workspace = page.getByRole('button', { name: `cambio-de-app's workspace`, exact: true });
  const pestanaVision = page.getByRole('button', { name: /^VISION\.md/ });
  const editor = page.locator('.cm-content');

  /** Crea la app desde la lista y escribe su visión. */
  async function crearApp(nombre: string, texto: string) {
    await page.getByLabel(/What.s the idea called/).fill(nombre);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: nombre })).toHaveCount(1);

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await editor.pressSequentially(texto);
    await page.getByRole('button', { name: /^Save/ }).click();
    await page.getByRole('button', { name: 'Stop editing' }).click();
    await expect(page.getByText(texto)).toBeVisible();
  }

  /** Salta a otra app desde el desplegable de la cabecera, sin recargar. */
  async function cambiarA(desde: string, hacia: string) {
    await page.getByRole('button', { name: `Switch from ${desde}` }).click();
    await page.getByRole('option', { name: hacia }).click();
    await expect(page.getByRole('button', { name: hacia, exact: true })).toBeVisible();
  }

  /**
   * Lo que se mira leyendo y lo que se mira editando son el mismo documento, y
   * el de esta app. El punto del rótulo no puede estar encendido: nadie ha
   * escrito nada desde que se guardó.
   */
  async function comprobarDocumento(suyo: string, ajeno: string) {
    await expect(page.getByText(suyo)).toBeVisible();
    await expect(pestanaVision).not.toContainText('•');

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(editor).toContainText(suyo);
    await expect(editor).not.toContainText(ajeno);
    await expect(pestanaVision).not.toContainText('•');
    await page.getByRole('button', { name: 'Stop editing' }).click();
  }

  await test.step('dos apps con visiones distintas', async () => {
    await crearApp('Astrolabio', ASTROLABIO);
    // Al nombre del workspace se vuelve a la lista, que es donde se crean.
    await workspace.click();
    await crearApp('Sextante', SEXTANTE);
  });

  await test.step('saltar a la otra app enseña su documento, no el de esta', async () => {
    await cambiarA('Sextante', 'Astrolabio');
    await comprobarDocumento(ASTROLABIO, SEXTANTE);
  });

  await test.step('y volver tampoco arrastra nada', async () => {
    await cambiarA('Astrolabio', 'Sextante');
    await comprobarDocumento(SEXTANTE, ASTROLABIO);
  });

  await test.step('el salto no dejó un borrador ajeno guardado', async () => {
    /*
     * El borrador local sobrevive a recargar a propósito (RF-506), así que si el
     * salto hubiera escrito el texto de una app bajo la clave de la otra, aquí
     * es donde se vería: reabriéndola aparecería en modo edición y con el texto
     * cambiado.
     */
    await page.reload();
    await page.getByRole('button', { name: /Astrolabio/ }).first().click();
    await comprobarDocumento(ASTROLABIO, SEXTANTE);
  });

  expect(erroresDePagina, 'la aplicación no debe romperse al cambiar de app').toEqual([]);
});
