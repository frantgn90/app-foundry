import { expect, test } from '@playwright/test';

import { crearSesion } from '../helpers/sesion.js';

/**
 * Un comentario habla de un texto concreto (RF-817).
 *
 * Lo que se comprueba aquí es lo que pasa al commitear: la conversación no se
 * arrastra a la versión nueva, pero tampoco se pierde de vista. Es la parte que
 * un test de API no ve —que haya camino de vuelta— y la que hace la diferencia
 * entre una regla sensata y una conversación desaparecida.
 */
test('la conversación se queda en su versión, y sigue habiendo camino hasta ella', async ({
  page,
  context,
}) => {
  const { cookie } = await crearSesion('conversa');
  await context.addCookies([
    { name: 'foundry_session', value: cookie, url: 'http://localhost:4173' },
  ]);

  const erroresDePagina: string[] = [];
  page.on('pageerror', (e) => erroresDePagina.push(e.message));

  await page.goto('/');
  await page.getByLabel(/What.s the idea called/).fill('Cuaderno');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cuaderno' })).toHaveCount(1);

  async function escribir(texto: string, mensaje: string) {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await editor.pressSequentially(texto);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Stop editing' }).click();
    await page.getByRole('button', { name: 'Commit…' }).click();
    await page.getByLabel('What changed?').fill(mensaje);
    await page.getByRole('button', { name: 'Create version' }).click();
    await expect(page.getByRole('button', { name: 'Commit…' })).toHaveCount(0);
  }

  await escribir('# El problema\n\nApuntar una idea cuesta demasiado.\n', 'Primera versión');

  await test.step('comentar un fragmento de la versión actual', async () => {
    await page.evaluate(() => {
      const parrafo = [...document.querySelectorAll('p[data-src-start]')].find((p) =>
        p.textContent?.includes('cuesta demasiado'),
      );
      const nodo = parrafo?.firstChild;
      if (!nodo?.textContent) throw new Error('No se encontró el párrafo del documento');

      const desde = nodo.textContent.indexOf('cuesta demasiado');
      const rango = document.createRange();
      rango.setStart(nodo, desde);
      rango.setEnd(nodo, desde + 'cuesta demasiado'.length);

      const seleccion = window.getSelection();
      seleccion?.removeAllRanges();
      seleccion?.addRange(rango);

      const caja = rango.getBoundingClientRect();
      parrafo?.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: caja.right, clientY: caja.bottom }),
      );
    });

    await page.locator('.fixed').getByRole('button', { name: 'Comment' }).click();
    await page.getByRole('textbox', { name: /Write a comment/ }).fill('¿Cuánto es demasiado?');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(page.getByText('¿Cuánto es demasiado?')).toBeVisible();
  });

  await test.step('al commitear, el hilo se queda atrás pero se anuncia', async () => {
    await escribir('# El problema\n\nApuntar una idea lleva tres pasos de más.\n', 'Lo digo mejor');

    // La conversación de la versión nueva empieza en blanco…
    await expect(page.getByText('¿Cuánto es demasiado?')).toHaveCount(0);
    // …pero no se ha perdido: se dice cuántas quedan vivas y dónde.
    await expect(page.getByText('Still open on earlier versions:')).toBeVisible();
    await page.getByRole('button', { name: 'v2 (1)' }).click();
  });

  await test.step('desde su versión se lee y se resuelve', async () => {
    await expect(page.getByText('¿Cuánto es demasiado?')).toBeVisible();
    // Y se lee sobre el texto sobre el que se escribió, no sobre el de hoy.
    await expect(page.getByText('Apuntar una idea cuesta demasiado.')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Conversation.*on v2/ })).toBeVisible();

    /*
     * Y el fragmento aparece subrayado, que es lo que dice de qué habla el
     * comentario. Se mira la Custom Highlight API porque el resaltado no toca el
     * DOM: no hay ningún elemento que buscar, solo rangos registrados.
     */
    const subrayados = await page.evaluate(() => {
      const highlights = (CSS as unknown as { highlights: Map<string, { size: number }> })
        .highlights;
      return highlights.get('foundry-anchors')?.size ?? 0;
    });
    expect(subrayados, 'el fragmento comentado se subraya en su propia versión').toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByText('Still open on earlier versions:')).toHaveCount(0);
  });

  expect(erroresDePagina, 'la aplicación no debe romperse por el camino').toEqual([]);
});
