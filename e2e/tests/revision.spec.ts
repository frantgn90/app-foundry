import { expect, test } from '@playwright/test';

import { crearSesion } from '../helpers/sesion.js';

/**
 * La revisión en abanico, de pedirla a leerla (RF-1606..1610, RNF-905).
 *
 * Es el gesto más caro del producto, así que lo que se comprueba no es solo que
 * aparezcan comentarios: es que **antes** se enseñe el techo de tokens y haya
 * que confirmarlo (RF-1207), y que lo que el agente devuelve acabe **anclado**
 * al fragmento que citó, que es lo que distingue una revisión de un montón de
 * texto (RF-808).
 *
 * El truco del documento: el proveedor de mentira contesta a un esquema
 * fabricando valores a partir de los nombres de los campos, así que su cita es
 * literalmente «quote de mentira». Poniéndola en el documento, el recorrido
 * ejercita el anclaje de verdad en vez de quedarse en el hilo general.
 */
const DOCUMENTO = [
  '# Gaubus',
  '',
  'Llegar al autobús con la información que de verdad hay.',
  '',
  'Esta línea lleva quote de mentira dentro, para que haya dónde anclar.',
].join('\n');

test('pedir una revisión, ver el techo, confirmarla y leer lo que dejó', async ({
  page,
  context,
}) => {
  const { cookie } = await crearSesion('revision');
  await context.addCookies([
    { name: 'foundry_session', value: cookie, url: 'http://localhost:4173' },
  ]);

  const erroresDePagina: string[] = [];
  page.on('pageerror', (e) => erroresDePagina.push(e.message));

  await page.goto('/');

  await test.step('la IA y un agente, como los pondría alguien', async () => {
    await page.getByRole('button', { name: 'AI', exact: true }).click();
    await page.getByRole('button', { name: /I understand/ }).click();
    await page.getByPlaceholder(/sk-ant/).fill('sk-de-mentira-pero-larga');
    await page
      .locator('form')
      .filter({ has: page.getByPlaceholder(/sk-ant/) })
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(page.getByText(/Key ending in/).first()).toBeVisible();

    await page
      .getByRole('listitem')
      .filter({ hasText: 'Product Owner' })
      .getByRole('button', { name: 'Add', exact: true })
      .click();
    await expect(page.getByText('@po', { exact: true }).first()).toBeVisible();
  });

  await test.step('una app con su visión commiteada', async () => {
    await page.getByRole('button', { name: 'Apps', exact: true }).click();
    await page.getByLabel(/What.s the idea called/).fill('Gaubus');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Gaubus' })).toHaveCount(1);

    await page.getByRole('button', { name: 'settings', exact: true }).click();
    await page.getByRole('button', { name: /Product Owner/ }).click();
    await expect(page.getByText('From Product Owner')).toBeVisible();

    await page.getByRole('button', { name: 'VISION.md' }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await editor.pressSequentially(DOCUMENTO);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Stop editing' }).click();
    await page.getByRole('button', { name: 'Commit…' }).click();
    await page.getByLabel('What changed?').fill('Primera');
    await page.getByRole('button', { name: 'Create version' }).click();
    await expect(page.getByRole('button', { name: 'Commit…' })).toHaveCount(0);
  });

  await test.step('el techo se enseña antes de gastar, y hay que confirmarlo', async () => {
    await page.getByRole('button', { name: 'Ask for a review' }).click();

    /* Quién va a leer, qué versión y cuántos tokens como mucho (RF-1207). */
    await expect(page.getByText(/1 agent will read version/)).toBeVisible();
    await expect(page.getByText(/that is the ceiling/)).toBeVisible();
    await expect(page.getByText(/@po/).first()).toBeVisible();

    /* Y se puede no hacerlo: confirmar es un segundo gesto, no el mismo. */
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByText(/that is the ceiling/)).toHaveCount(0);
  });

  await test.step('confirmada, deja sus comentarios y aparecen sin recargar', async () => {
    await page.getByRole('button', { name: 'Ask for a review' }).click();
    await page.getByRole('button', { name: 'Start the review' }).click();

    /*
     * El hilo inline, anclado a la cita: la cita se ve como tal —en el
     * blockquote del hilo— y no como parte del comentario (RF-808).
     */
    await expect(page.getByText('comment de mentira').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('overall de mentira').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('blockquote', { hasText: 'quote de mentira' })).toBeVisible();
  });

  await test.step('y al terminar deja de ofrecerse el progreso, no la revisión', async () => {
    /* Se puede volver a pedir: lo que no se puede es solaparlas (RF-1609). */
    await expect(page.getByRole('button', { name: 'Ask for a review' })).toBeVisible({
      timeout: 30_000,
    });
  });

  expect(erroresDePagina).toEqual([]);
});
