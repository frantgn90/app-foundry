import { expect, test } from '@playwright/test';

import { crearSesion } from '../helpers/sesion.js';

/**
 * De «no tengo ideas» a una app con su borrador delante (RF-1301..1311).
 *
 * Contra el proveedor de mentira, que responde lo que el esquema pide: no son
 * ideas buenas, pero tienen la forma exacta que tendrán las de verdad, que es lo
 * que hace falta para comprobar el camino entero.
 */
test('generar ideas, elegir una y aterrizar en su visión', async ({ page, context }) => {
  const { cookie } = await crearSesion('ideas');
  await context.addCookies([
    { name: 'foundry_session', value: cookie, url: 'http://localhost:4173' },
  ]);

  const erroresDePagina: string[] = [];
  page.on('pageerror', (e) => erroresDePagina.push(e.message));

  await page.goto('/');

  /*
   * Sin IA configurada, la vía no existe (RF-1010). Se comprueba antes de
   * configurarla: enseñar el camino y que luego no lleve a ninguna parte es
   * peor que no enseñarlo.
   */
  await expect(page.getByRole('button', { name: 'Get inspired' })).toHaveCount(0);

  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('button', { name: /I understand/ }).click();
  await page.getByPlaceholder(/sk-ant/).fill('sk-de-mentira-pero-larga');
  await page
    .locator('form')
    .filter({ has: page.getByPlaceholder(/sk-ant/) })
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect(page.getByText(/Key ending in/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Apps', exact: true }).click();

  /*
   * Pulsar «Get inspired» ya es pedir ideas: no hay un segundo botón que
   * confirme algo que ya se ha decidido.
   */
  await test.step('pulsar el botón ya trae propuestas', async () => {
    await page.getByRole('button', { name: 'Get inspired' }).click();

    /* Tres como mínimo, que es lo que pide el esquema. */
    await expect(page.getByRole('button', { name: 'Build this one' })).toHaveCount(3, {
      timeout: 20_000,
    });
    /* Y se dice de dónde salen, siempre (RF-1304, RF-1305). */
    await expect(
      page.getByText(/Grounded in what was found|come from its own memory/),
    ).toBeVisible();
  });

  /* El botón se queda, y cerrar se hace donde se abrió. */
  await test.step('el mismo botón cierra, y vuelve a abrir', async () => {
    await page.getByRole('button', { name: 'Get inspired' }).click();
    await expect(page.getByRole('button', { name: 'Build this one' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Get inspired' }).click();
    await expect(page.getByRole('button', { name: 'Build this one' })).toHaveCount(3, {
      timeout: 20_000,
    });
  });

  /* Los ajustes esperan detrás: delante va lo propuesto. */
  await test.step('las restricciones están plegadas hasta que se piden', async () => {
    await expect(page.getByLabel('Topic or domain')).toBeHidden();
    await page.getByRole('button', { name: /Adjust ideas/ }).click();
    await expect(page.getByLabel('Topic or domain')).toBeVisible();
  });

  /*
   * Quien ha escrito «gestión de rutas» y luego pide ideas ya ha dicho de qué las
   * quiere: volver a preguntárselo sería no haber escuchado.
   */
  await test.step('lo escrito para crear a mano se usa como tema', async () => {
    await page.getByRole('button', { name: 'Get inspired' }).click();
    await page.getByLabel(/What.s the idea called/).fill('rutas de autobus');
    await page.getByRole('button', { name: 'Get inspired' }).click();

    await page.getByRole('button', { name: /Adjust ideas/ }).click();
    await expect(page.getByLabel('Topic or domain')).toHaveValue('rutas de autobus');

    /* Y se limpia para no arrastrarlo al paso siguiente. */
    await page.getByLabel(/What.s the idea called/).fill('');
  });

  await test.step('otra tanda conserva las entradas y no repite', async () => {
    await page.getByRole('button', { name: 'More ideas, different ones' }).click();
    await expect(page.getByRole('button', { name: 'Build this one' })).toHaveCount(6, {
      timeout: 20_000,
    });
  });

  await test.step('elegir una crea la app y aterriza en su visión', async () => {
    await page.getByRole('button', { name: 'Build this one' }).first().click();

    /*
     * Lo que ha escrito un modelo llega como borrador: hay cambios sin
     * commitear, y se dice de dónde salió (RF-1308, RF-1311).
     */
    await expect(page.getByText(/drafted from a generated idea/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Uncommitted changes/)).toBeVisible();

    /* Con la estructura de la plantilla de la v1, no con otra forma (RF-503). */
    await expect(page.getByRole('heading', { name: 'The problem' })).toBeVisible();
    await expect(page.getByRole('heading', { name: "Who it's for" })).toBeVisible();
  });

  expect(erroresDePagina).toEqual([]);
});
