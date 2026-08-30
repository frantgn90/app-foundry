import { expect, test } from '@playwright/test';

import { crearSesion } from '../helpers/sesion.js';

/**
 * El camino completo: entrar, crear una app, escribir su visión, comentarla y
 * volver a encontrarla buscando.
 *
 * Es un solo recorrido y no cinco pruebas sueltas a propósito. Lo que se
 * comprueba aquí no es cada pieza —de eso ya hay tests más rápidos y más
 * precisos— sino que encajan: que lo que escribes se guarda, que el comentario
 * se ancla al fragmento que marcaste, y que la búsqueda lo encuentra por una
 * palabra que solo está dentro del texto.
 */
test('de crear una app a encontrarla por su contenido', async ({ page, context }) => {
  const { cookie } = await crearSesion('recorrido');
  await context.addCookies([
    { name: 'foundry_session', value: cookie, url: 'http://localhost:4173' },
  ]);

  /*
   * Un error de React deja la página en blanco sin que ninguna aserción explique
   * por qué: se falla aquí, con el mensaje delante, en vez de dentro de diez
   * esperas agotadas.
   */
  const erroresDePagina: string[] = [];
  page.on('pageerror', (e) => erroresDePagina.push(e.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(erroresDePagina, 'la aplicación no debe romperse al cargar').toEqual([]);

  await test.step('crear una app', async () => {
    // El campo está siempre puesto: crear no empieza por desplegar nada.
    await page.getByLabel(/What.s the idea called/).fill('Telescopio');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Crear entra directamente a la ficha: quedarse en la lista sería dejar el
    // trabajo a medias.
    await expect(page.getByRole('heading', { name: 'Telescopio' })).toBeVisible();
  });

  await test.step('escribir la visión', async () => {
    await page.getByRole('button', { name: 'Edit' }).click();

    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await editor.pressSequentially(
      '# The problem\n\nNobody remembers why a feature was dropped.\n',
    );

    await page.getByRole('button', { name: /^Save/ }).click();
    await page.getByRole('button', { name: 'Read' }).click();
    await expect(page.getByText('Nobody remembers why a feature was dropped.')).toBeVisible();
  });

  await test.step('comentar un fragmento del texto', async () => {
    /*
     * La selección se hace con la API del navegador y luego se suelta el ratón
     * encima, que es el gesto que el componente escucha.
     *
     * Arrastrar con `mouse.move` sería más parecido a lo que hace una persona,
     * pero depende de dónde caiga exactamente el texto al maquetarse y falla por
     * motivos que no tienen nada que ver con lo que se está probando. Lo que
     * importa aquí es que un fragmento seleccionado acabe siendo un comentario
     * anclado a él.
     */
    await page.evaluate(() => {
      const parrafo = [...document.querySelectorAll('p[data-src-start]')].find((p) =>
        p.textContent?.includes('feature was dropped'),
      );
      const nodo = parrafo?.firstChild;
      if (!nodo?.textContent) throw new Error('No se encontró el párrafo del documento');

      const desde = nodo.textContent.indexOf('why a feature was dropped');
      const rango = document.createRange();
      rango.setStart(nodo, desde);
      rango.setEnd(nodo, desde + 'why a feature was dropped'.length);

      const seleccion = window.getSelection();
      seleccion?.removeAllRanges();
      seleccion?.addRange(rango);

      // El gesto se suelta aquí mismo, sin salir del navegador: entre poner la
      // selección y soltar el ratón desde fuera cabe un repintado que se la
      // lleva por delante, y el menú no llega a aparecer.
      const caja = rango.getBoundingClientRect();
      parrafo?.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: caja.right, clientY: caja.bottom }),
      );
    });

    // El menú flotante, no el botón de enviar del formulario: ambos dicen
    // «Comment» y solo el primero existe todavía.
    await page.locator('.fixed').getByRole('button', { name: 'Comment' }).click();

    // Con el formulario abierto el menú ya no está, así que «Comment» vuelve a
    // ser único: es el botón de enviar.
    await page
      .getByRole('textbox', { name: /Write a comment/ })
      .fill('¿Y si lo dejamos por escrito?');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();

    await expect(page.getByText('¿Y si lo dejamos por escrito?')).toBeVisible();

    // Y queda anclado al fragmento, no suelto al pie: es la diferencia entre un
    // comentario inline y una nota general.
    await expect(page.getByText('why a feature was dropped').first()).toBeVisible();
  });

  await test.step('encontrarla por una palabra que solo está en el texto', async () => {
    // «dropped» no aparece en el nombre ni en la descripción: si sale, es que la
    // búsqueda está mirando dentro del documento (RF-604).
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByPlaceholder(/Search apps/).fill('dropped');

    const resultado = page.getByRole('dialog', { name: 'Search apps' }).getByText('Telescopio');
    await expect(resultado).toBeVisible();

    await resultado.click();
    await expect(page.getByRole('heading', { name: 'Telescopio' })).toBeVisible();
  });

  expect(erroresDePagina, 'nada debe romperse durante el recorrido').toEqual([]);
});
