import { expect, test } from '@playwright/test';

import { crearSesion } from '../helpers/sesion.js';

/**
 * El recorrido entero de un agente, de adoptarlo a que se calle (RNF-905).
 *
 * Es la primera vez que la IA **escribe en el producto** sin que nadie firme lo
 * escrito, así que lo que se prueba aquí no es que un endpoint responda: es que
 * la cadena completa —adoptar del catálogo, instanciar en una app, mencionar,
 * encolar, que el worker conteste, que la respuesta aparezca sola en pantalla y
 * que el tope de turnos le corte— funcione junta.
 *
 * Contra el proveedor de mentira, en la API y en el worker (T-36): un recorrido
 * que llamara a un modelo de verdad gastaría la cuota de quien lo ejecute y
 * dependería de que un tercero esté en pie.
 *
 * La respuesta aparece **sin recargar**, que no es un detalle: llega por el
 * canal de avisos (T-6), y si ese canal se rompe este test se pone rojo. Es la
 * única prueba que mira ese tramo de punta a punta.
 */

/** Lo que contesta el proveedor de mentira, siempre igual. */
const RESPUESTA = 'texto de mentira';

test('adoptar un agente, mencionarlo, replicarle y que calle al llegar a su tope', async ({
  page,
  context,
}) => {
  const { cookie } = await crearSesion('agentes');
  await context.addCookies([
    { name: 'foundry_session', value: cookie, url: 'http://localhost:4173' },
  ]);

  const erroresDePagina: string[] = [];
  page.on('pageerror', (e) => erroresDePagina.push(e.message));

  await page.goto('/');

  /** Cuántas veces ha hablado el agente en el hilo. */
  const dichoPorElAgente = page.getByText(RESPUESTA);

  await test.step('la IA del workspace, configurada como la configuraría alguien', async () => {
    await page.getByRole('button', { name: 'AI', exact: true }).click();
    await page.getByRole('button', { name: /I understand/ }).click();

    await page.getByPlaceholder(/sk-ant/).fill('sk-de-mentira-pero-larga');
    await page
      .locator('form')
      .filter({ has: page.getByPlaceholder(/sk-ant/) })
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(page.getByText(/Key ending in/).first()).toBeVisible();
  });

  await test.step('se adopta un perfil del catálogo de fábrica', async () => {
    const perfil = page.getByRole('listitem').filter({ hasText: 'Product Owner' });
    await perfil.getByRole('button', { name: 'Add', exact: true }).click();

    /* Adoptar copia: a partir de ahí la plantilla es del workspace (RF-1514). */
    await expect(page.getByText('@po', { exact: true }).first()).toBeVisible();
  });

  await test.step('y se instancia en una app', async () => {
    await page.getByRole('button', { name: 'Apps', exact: true }).click();
    await page.getByLabel(/What.s the idea called/).fill('Con agentes');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Con agentes' })).toHaveCount(1);

    await page.getByRole('button', { name: 'settings', exact: true }).click();
    await page.getByRole('button', { name: /Product Owner/ }).click();
    await expect(page.getByText('From Product Owner')).toBeVisible();
  });

  await test.step('al mencionarlo, contesta en el hilo y sin recargar', async () => {
    await page.getByRole('button', { name: 'VISION.md' }).click();
    await page.getByRole('button', { name: 'Add a general comment' }).click();
    await page.getByRole('textbox').last().fill('@po ¿esto se sostiene?');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();

    /*
     * Sin recargar y con margen: entre mandar la mención y ver la respuesta hay
     * una cola, un worker y el canal de avisos. Treinta segundos es de sobra
     * para un proveedor de mentira y no tanto como para que un cuelgue se
     * confunda con lentitud.
     */
    await expect(dichoPorElAgente.first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('AI', { exact: true }).first()).toBeVisible();
  });

  await test.step('replicarle también le hace hablar, hasta agotar sus turnos', async () => {
    /* Dos réplicas más: con la del principio son los tres turnos del tope. */
    for (const cuantos of [2, 3]) {
      await responder(`Sigo hablando, ${String(cuantos)}.`);
      await expect(dichoPorElAgente).toHaveCount(cuantos, { timeout: 30_000 });
    }
  });

  await test.step('y a la siguiente calla, porque ya ha gastado el tope', async () => {
    await responder('Y una vez más.');

    /*
     * Se espera **a propósito** antes de comprobar que no ha pasado nada: si se
     * mirara al momento, el test pasaría igual con el worker apagado. Lo que se
     * afirma es que se le dio tiempo de sobra y aun así se calló (RF-1605).
     */
    await page.waitForTimeout(5_000);
    await expect(dichoPorElAgente).toHaveCount(3);
  });

  await test.step('pero llamarlo por su nombre le devuelve la palabra', async () => {
    /* El tope existe para que un hilo no se llene solo, no para dejarlo mudo. */
    await responder('@po una última cosa.');
    await expect(dichoPorElAgente).toHaveCount(4, { timeout: 30_000 });
  });

  expect(erroresDePagina).toEqual([]);

  async function responder(texto: string): Promise<void> {
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await page.getByRole('textbox').last().fill(texto);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText(texto)).toBeVisible();
  }
});
