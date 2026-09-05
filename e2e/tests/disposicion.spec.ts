import { expect, test } from '@playwright/test';

import { crearSesion } from '../helpers/sesion.js';

/**
 * Dónde se pone la conversación (RF-818).
 *
 * Se comprueba con las **cajas**, no con clases de CSS: lo que se pidió es que
 * los comentarios dejen de leerse en una tira estrecha, y eso solo se ve
 * midiendo dónde acaba el documento y dónde empieza el panel. Una aserción
 * sobre la clase pasaría igual con la rejilla rota.
 */
test('la conversación se puede poner debajo del documento, a todo lo ancho', async ({
  page,
  context,
}) => {
  const { cookie } = await crearSesion('disposicion');
  await context.addCookies([
    { name: 'foundry_session', value: cookie, url: 'http://localhost:4173' },
  ]);

  const erroresDePagina: string[] = [];
  page.on('pageerror', (e) => erroresDePagina.push(e.message));

  await page.goto('/');
  await page.getByLabel(/What.s the idea called/).fill('Cuaderno');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cuaderno' })).toHaveCount(1);

  /* La caja del documento, no su texto: el texto lleva dentro el relleno de la
     caja y mediría cuarenta y ocho píxeles menos que el panel de al lado. */
  const documento = page.locator('.markdown').first().locator('..');
  const conversacion = page.getByRole('complementary');

  await test.step('de fábrica va al lado, y más estrecha que el documento', async () => {
    const doc = (await documento.boundingBox())!;
    const panel = (await conversacion.boundingBox())!;

    expect(panel.x).toBeGreaterThan(doc.x + doc.width - 1);
    expect(panel.width).toBeLessThan(doc.width);
  });

  await test.step('se elige la otra en los ajustes', async () => {
    await page.getByRole('button', { name: 'settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Layout' })).toBeVisible();

    await page.getByRole('button', { name: /Below the document/ }).click();
    await expect(page.getByRole('button', { name: /Below the document/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  await test.step('y entonces cae debajo, con el ancho del documento', async () => {
    await page.getByRole('button', { name: 'VISION.md' }).click();

    const doc = (await documento.boundingBox())!;
    const panel = (await conversacion.boundingBox())!;

    /* Debajo: empieza donde el documento ha terminado. */
    expect(panel.y).toBeGreaterThan(doc.y + doc.height - 1);
    /* Y a todo lo ancho: el mismo que el documento, salvo redondeos. */
    expect(Math.abs(panel.width - doc.width)).toBeLessThan(2);
  });

  await test.step('y se recuerda al volver', async () => {
    await page.reload();
    /* La app no vive en la URL, así que se vuelve a entrar desde el listado. */
    await page
      .getByRole('button', { name: /Cuaderno/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Cuaderno' })).toHaveCount(1);

    const doc = (await documento.boundingBox())!;
    const panel = (await conversacion.boundingBox())!;
    expect(panel.y).toBeGreaterThan(doc.y + doc.height - 1);
  });

  expect(erroresDePagina).toEqual([]);
});
