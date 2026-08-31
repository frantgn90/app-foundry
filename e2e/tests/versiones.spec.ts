import { expect, test } from '@playwright/test';

import { crearSesion } from '../helpers/sesion.js';

/**
 * El historial desde la interfaz, ahora que vive encima del documento y no en
 * una pestaña aparte (RF-507, RF-508, RF-510).
 *
 * Lo que se comprueba es el recorrido entero de volver atrás: elegir una versión
 * y ver su texto, comparar con lo de hoy, y restaurarla dejando constancia. Es
 * justo donde un fallo pasa desapercibido —el desplegable enseña una versión y
 * la caja de abajo otra— porque cada pieza por separado funciona.
 */
test('mirar una versión anterior, compararla y restaurarla', async ({ page, context }) => {
  const { cookie } = await crearSesion('versiones');
  await context.addCookies([
    { name: 'foundry_session', value: cookie, url: 'http://localhost:4173' },
  ]);

  const erroresDePagina: string[] = [];
  page.on('pageerror', (e) => erroresDePagina.push(e.message));

  await page.goto('/');
  await page.getByLabel(/What.s the idea called/).fill('Sextante');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sextante' })).toHaveCount(1);

  /** Escribe, guarda y commitea: guardar ya no crea versión (RF-505). */
  async function escribir(texto: string, mensaje: string) {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await editor.pressSequentially(texto);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Stop editing' }).click();
    await expect(page.getByText(texto)).toBeVisible();

    await page.getByRole('button', { name: 'Commit…' }).click();
    await page.getByLabel('What changed?').fill(mensaje);
    await page.getByRole('button', { name: 'Create version' }).click();
    await expect(page.getByRole('button', { name: 'Commit…' })).toHaveCount(0);
  }

  await escribir('Medir la altura de una estrella.', 'La primera idea');
  await escribir('Medir la altura del sol al mediodia.', 'Mejor el sol');

  // Exacto: el nombre del workspace de prueba también lleva «versiones» dentro.
  const historial = page.getByLabel('Version', { exact: true });

  await test.step('el historial ya no es un sitio aparte', async () => {
    // La pestaña desapareció: lo que traía se elige aquí, sin salir del
    // documento.
    await expect(page.getByRole('button', { name: 'history' })).toHaveCount(0);
    await expect(historial).toBeVisible();
    await expect(historial.locator('option').first()).toHaveText(/current/);
  });

  await test.step('elegir una versión anterior enseña su texto', async () => {
    // La segunda de la lista, que va del más reciente al más antiguo: la que se
    // guardó justo antes de la actual.
    await historial.selectOption({ index: 1 });

    await expect(page.getByText('Medir la altura de una estrella.')).toBeVisible();
    await expect(page.getByText('Medir la altura del sol al mediodia.')).toHaveCount(0);

    // Y no se puede escribir encima: el botón de editar se apaga y dice por qué,
    // que no es la falta de permiso.
    await expect(
      page.getByRole('button', { name: 'Restore this version to edit it' }),
    ).toBeDisabled();
  });

  await test.step('comparar con la actual', async () => {
    await page.getByRole('button', { name: 'Compare with current' }).click();

    // El diff enseña las dos a la vez: lo que se fue y lo que vino.
    await expect(page.getByText('estrella')).toBeVisible();
    await expect(page.getByText('sol al mediodia')).toBeVisible();

    await page.getByRole('button', { name: 'Hide changes' }).click();
    await expect(page.getByText('sol al mediodia')).toHaveCount(0);
  });

  await test.step('restaurarla la deja sin commitear, para poder mirarla antes', async () => {
    await page.getByRole('button', { name: 'Restore', exact: true }).click();

    // No hay versión nueva: el texto viejo queda en la copia de trabajo, que es
    // lo que se está leyendo, y decide luego quien mira.
    await expect(historial.locator('option:checked')).toHaveText('Working copy');
    await expect(page.getByText('Medir la altura de una estrella.')).toBeVisible();
    await expect(page.getByText(/Uncommitted changes/)).toBeVisible();
    await expect(historial.locator('option')).toHaveCount(4);

    // Y vuelve a poderse editar: se escribe sobre la copia de trabajo.
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeEnabled();
  });

  await test.step('descartar lo devuelve todo a la versión, avisando antes', async () => {
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByText(/nowhere to get them back from/)).toBeVisible();

    // Cancelar no toca nada: el aviso es un aviso, no un trámite.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText(/Uncommitted changes/)).toBeVisible();

    await page.getByRole('button', { name: 'Discard changes' }).click();
    await page.getByRole('button', { name: 'Yes, discard them' }).click();

    await expect(page.getByText('Medir la altura del sol al mediodia.')).toBeVisible();
    await expect(historial.locator('option:checked')).toHaveText(/current/);
    await expect(page.getByRole('button', { name: 'Commit…' })).toHaveCount(0);
  });

  await test.step('commitear pide un mensaje, y con él nace la versión', async () => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await editor.pressSequentially('Medir la altura de cualquier astro.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Stop editing' }).click();

    // Guardar no ha creado versión: sigue habiendo tres.
    await expect(historial.locator('option')).toHaveCount(4);

    await page.getByRole('button', { name: 'Commit…' }).click();
    // Sin mensaje no se puede crear la versión: una versión sin explicación es
    // una fecha en una lista.
    await expect(page.getByRole('button', { name: 'Create version' })).toBeDisabled();

    await page.getByLabel('What changed?').fill('Vale para cualquier astro');
    await page.getByRole('button', { name: 'Create version' }).click();

    await expect(historial.locator('option')).toHaveCount(4);
    await expect(historial.locator('option:checked')).toHaveText(/v4 · current/);
    await expect(page.getByText('Vale para cualquier astro')).toBeVisible();
  });

  expect(erroresDePagina, 'la aplicación no debe romperse por el camino').toEqual([]);
});
