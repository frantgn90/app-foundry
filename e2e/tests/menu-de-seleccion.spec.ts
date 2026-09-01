import { expect, test } from '@playwright/test';

import { crearSesion } from '../helpers/sesion.js';

/**
 * Los cuatro gestos con los que se selecciona texto (RF-1414..1416, U26, U27).
 *
 * Existe porque los cuatro estaban rotos y ninguno de los tests que había lo
 * notaba: el menú se abría al soltar el ratón y se colocaba donde quedara el
 * puntero, así que el doble clic, el triple clic, el teclado y el arrastre hacia
 * la izquierda producían selecciones perfectamente válidas que la interfaz
 * ignoraba o marcaba en el sitio equivocado.
 *
 * Se comprueba en un navegador de verdad porque no hay otra forma: lo que falla
 * es la relación entre la selección del navegador, el DOM renderizado y dónde
 * cae un elemento en pantalla.
 */
const DOCUMENTO = [
  '# Un titulo entero para seleccionar',
  '',
  'Primer parrafo con bastante texto para arrastrar de un lado a otro con calma.',
  '',
  'Segundo parrafo, para tener algo debajo del primero.',
].join('\n');

test('el menú aparece con los cuatro gestos, y siempre bajo la selección', async ({
  page,
  context,
}) => {
  const { cookie } = await crearSesion('selector');
  await context.addCookies([
    { name: 'foundry_session', value: cookie, url: 'http://localhost:4173' },
  ]);

  const erroresDePagina: string[] = [];
  page.on('pageerror', (e) => erroresDePagina.push(e.message));

  await page.goto('/');
  await page.getByLabel(/What.s the idea called/).fill('Seleccion');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seleccion' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await editor.pressSequentially(DOCUMENTO);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Stop editing' }).click();

  const menu = page.getByRole('button', { name: 'Comment', exact: true });
  const titulo = page.getByRole('heading', { name: 'Un titulo entero para seleccionar' });
  const primerParrafo = page.getByText('Primer parrafo con bastante texto');

  /** Deshace la selección sin dejar el menú abierto de la comprobación anterior. */
  async function limpiar(): Promise<void> {
    await page.mouse.click(20, 400);
    await expect(menu).toHaveCount(0);
  }

  /**
   * El menú tiene que caer **debajo** de la selección y hacia su derecha.
   *
   * Se comprueba contra la geometría de lo marcado y no contra el ratón, que es
   * justamente la diferencia: arrastrando hacia la izquierda, el puntero termina
   * al principio del texto y el menú tiene que seguir estando al final.
   */
  async function menuBajoLaSeleccion(): Promise<void> {
    await expect(menu).toBeVisible();
    const caja = await menu.boundingBox();
    const marcado = await page.evaluate(() => {
      const s = window.getSelection();
      if (!s || s.rangeCount === 0) return null;
      const rects = [...s.getRangeAt(0).getClientRects()];
      const ultimo = rects[rects.length - 1];
      return ultimo ? { bottom: ultimo.bottom, right: ultimo.right } : null;
    });

    expect(marcado).not.toBeNull();
    expect(caja).not.toBeNull();
    expect(caja!.y).toBeGreaterThanOrEqual(marcado!.bottom - 1);
    /* Alineado por su derecha con el final de lo marcado, no a la izquierda. */
    expect(caja!.x + caja!.width).toBeGreaterThan(marcado!.right - caja!.width);
  }

  await test.step('doble clic sobre una palabra', async () => {
    await primerParrafo.dblclick();
    await menuBajoLaSeleccion();
    await limpiar();
  });

  await test.step('triple clic sobre un título entero', async () => {
    await titulo.click({ clickCount: 3 });
    await menuBajoLaSeleccion();
    await limpiar();
  });

  await test.step('arrastrar de derecha a izquierda', async () => {
    const caja = (await primerParrafo.boundingBox())!;
    await page.mouse.move(caja.x + caja.width * 0.7, caja.y + caja.height / 2);
    await page.mouse.down();
    await page.mouse.move(caja.x + 10, caja.y + caja.height / 2, { steps: 12 });
    await page.mouse.up();

    await menuBajoLaSeleccion();
    await limpiar();
  });

  /*
   * Con el teclado se **extiende** una selección, no se crea: en un documento
   * que no es editable, Chrome no deja cursor al pinchar, así que las flechas
   * solas mueven la página. Lo que hay que cubrir es que el menú reaccione
   * cuando la selección cambia sin tocar el ratón, y eso es exactamente esto.
   */
  await test.step('extender la selección con el teclado', async () => {
    await primerParrafo.dblclick();
    await expect(menu).toBeVisible();
    const antes = await page.evaluate(() => window.getSelection()?.toString() ?? '');

    await page.keyboard.down('Shift');
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');

    const despues = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(despues.length).toBeGreaterThan(antes.length);
    await expect(menu).toBeVisible();
    await limpiar();
  });

  /*
   * Y lo que pidió quien lo usó: que arrastrar no interfiera. Si la aplicación
   * toca el estado mientras el gesto está en curso, la selección se vuelve
   * errática; aquí se comprueba que al terminar el arrastre lo marcado es lo que
   * se marcó, y nada más.
   */
  await test.step('arrastrar no descoloca la selección', async () => {
    const caja = (await primerParrafo.boundingBox())!;
    await page.mouse.move(caja.x + 10, caja.y + caja.height / 2);
    await page.mouse.down();
    await page.mouse.move(caja.x + caja.width * 0.6, caja.y + caja.height / 2, { steps: 20 });
    await page.mouse.up();

    const marcado = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(marcado.length).toBeGreaterThan(3);
    expect(DOCUMENTO).toContain(marcado.trim().split('\n')[0]);
    /* No se ha ido al principio del documento: el título no está dentro. */
    expect(marcado).not.toContain('Un titulo entero');
  });

  expect(erroresDePagina).toEqual([]);
});
