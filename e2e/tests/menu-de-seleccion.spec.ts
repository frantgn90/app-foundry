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
  '',
  /*
   * Un párrafo repartido en dos líneas del fuente, como está escrita la
   * plantilla de la visión y como se escribe casi todo. La pantalla enseña el
   * salto como un espacio, así que marcar de una línea a la siguiente producía
   * un texto que no aparecía en su propio bloque.
   */
  'Tercer parrafo escrito en dos lineas del fuente,',
  'que la pantalla enseña seguidas y termina aqui.',
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
  const segundoParrafo = page.getByText('Segundo parrafo, para tener algo');
  const parrafoPartido = page.getByText('Tercer parrafo escrito en dos lineas');

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
      const documento = window.document.querySelector('.markdown');
      if (!s || s.rangeCount === 0 || !documento) return null;

      /*
       * La referencia es lo marcado **dentro del documento**, no el rango en
       * bruto: el navegador termina la selección fuera del texto más a menudo de
       * lo que parece —el triple clic sobre el último párrafo la lleva hasta el
       * botón de abajo—, y medir contra eso pediría el menú por debajo de algo
       * que el usuario no ha marcado.
       */
      const limites = window.document.createRange();
      limites.selectNodeContents(documento);
      const rango = s.getRangeAt(0).cloneRange();
      if (rango.compareBoundaryPoints(Range.START_TO_START, limites) < 0) {
        rango.setStart(limites.startContainer, limites.startOffset);
      }
      if (rango.compareBoundaryPoints(Range.END_TO_END, limites) > 0) {
        rango.setEnd(limites.endContainer, limites.endOffset);
      }

      const rects = [...rango.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
      const ultimo = rects[rects.length - 1];
      return ultimo ? { bottom: ultimo.bottom, right: ultimo.right } : null;
    });

    expect(marcado).not.toBeNull();
    expect(caja).not.toBeNull();
    expect(caja!.y).toBeGreaterThanOrEqual(marcado!.bottom - 1);
    /* Alineado por su derecha con el final de lo marcado, no a la izquierda. */
    expect(caja!.x + caja!.width).toBeGreaterThan(marcado!.right - caja!.width);
  }

  /*
   * Sin IA configurada en el workspace, el menú es solo el de comentar
   * (RF-1010, AW5). Un botón apagado invitaría a preguntarse qué hay que hacer
   * para encenderlo, y aquí la respuesta no está en manos de quien mira.
   */
  await test.step('sin IA configurada, el menú no ofrece reescribir', async () => {
    await primerParrafo.dblclick();
    await expect(menu).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rewrite' })).toHaveCount(0);
    await limpiar();
  });

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
   * Seleccionar más de una línea, que es lo que se hace todo el rato y lo que
   * seguía sin funcionar: dentro de un párrafo escrito en dos líneas del fuente,
   * y cruzando de un párrafo al siguiente.
   */
  await test.step('un parrafo escrito en dos lineas del fuente', async () => {
    await parrafoPartido.click({ clickCount: 3 });

    const marcado = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    /* Se ha marcado el párrafo entero, las dos líneas del fuente. */
    expect(marcado).toContain('Tercer parrafo');
    expect(marcado).toContain('termina aqui');

    await menuBajoLaSeleccion();
    await limpiar();
  });

  await test.step('una seleccion que pasa de un parrafo al siguiente', async () => {
    const desde = (await primerParrafo.boundingBox())!;
    const hasta = (await segundoParrafo.boundingBox())!;

    await page.mouse.move(desde.x + desde.width * 0.3, desde.y + desde.height / 2);
    await page.mouse.down();
    await page.mouse.move(hasta.x + hasta.width * 0.5, hasta.y + hasta.height / 2, { steps: 15 });
    await page.mouse.up();

    await menuBajoLaSeleccion();
    await limpiar();
  });

  /*
   * Y que el comentario llegue a existir, no solo que salga el menú. El
   * servidor comprueba que la cita coincide con lo que él tiene entre esas dos
   * posiciones, así que un anclaje que cuadre en pantalla pero no en el fuente
   * se rechaza aquí y en ningún sitio antes.
   */
  await test.step('comentar sobre esa seleccion de dos lineas', async () => {
    await parrafoPartido.click({ clickCount: 3 });
    await page.locator('.fixed').getByRole('button', { name: 'Comment' }).click();

    await page.getByRole('textbox', { name: /Write a comment/ }).fill('Cabe en dos lineas');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();

    await expect(page.getByText('Cabe en dos lineas')).toBeVisible();
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
