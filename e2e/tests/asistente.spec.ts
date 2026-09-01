import { expect, test } from '@playwright/test';

import { crearSesion } from '../helpers/sesion.js';

/**
 * El asistente de escritura, de seleccionar a aceptar (RF-1401..1412).
 *
 * Contra el proveedor de mentira, que suplanta al real bajo su mismo
 * identificador: la base de datos, la API y esta pantalla recorren el mismo
 * camino que en producción, sin gastar la cuota de nadie.
 *
 * Si la API en marcha no lo tiene puesto, este recorrido **falla** en vez de
 * saltarse: prefiero una prueba en rojo a una que se salta sola y aparenta que
 * todo está probado.
 */
const DOCUMENTO = [
  '# El problema',
  '',
  'Un parrafo que esta escrito regular y que se puede mejorar bastante.',
  '',
  'Otro parrafo distinto, para que se note que solo cambia el primero.',
].join('\n');

test('seleccionar, pedir, ver el diff, descartar y aceptar', async ({ page, context }) => {
  const { cookie } = await crearSesion('asistente');
  await context.addCookies([
    { name: 'foundry_session', value: cookie, url: 'http://localhost:4173' },
  ]);

  const erroresDePagina: string[] = [];
  page.on('pageerror', (e) => erroresDePagina.push(e.message));

  await page.goto('/');

  /*
   * La IA se configura desde su propia pantalla, como la configuraría alguien:
   * aceptar la advertencia de salida de datos y guardar una clave. Con el
   * proveedor de mentira, la clave no sale de aquí.
   */
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('button', { name: /I understand/ }).click();

  const clave = page.getByPlaceholder(/sk-ant/);
  await clave.fill('sk-de-mentira-pero-larga');
  await page
    .locator('form')
    .filter({ has: page.getByPlaceholder(/sk-ant/) })
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect(page.getByText(/Key ending in/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  await page.getByLabel(/What.s the idea called/).fill('Asistida');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Asistida' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await editor.pressSequentially(DOCUMENTO);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Stop editing' }).click();

  const parrafo = page.getByText('Un parrafo que esta escrito regular');
  /* El documento renderizado, para no confundirlo con el diff de la propuesta. */
  const documento = page.locator('.markdown');
  /* La propuesta es una región con nombre, así que se puede mirar solo dentro. */
  const propuesta = page.getByRole('group', { name: 'AI proposal' });
  const techo = page.getByRole('group', { name: 'AI estimate' });

  await test.step('el menú ofrece comentar y reescribir, en el mismo sitio', async () => {
    await parrafo.click({ clickCount: 3 });
    await expect(page.getByRole('button', { name: 'Comment', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rewrite' })).toBeVisible();
  });

  await test.step('descartar a media respuesta no deja rastro', async () => {
    await page.getByRole('button', { name: 'Rewrite' }).click();
    await page.getByRole('button', { name: /Improve writing/ }).click();

    await expect(propuesta).toBeVisible();
    await expect(propuesta.getByText('Improve writing')).toBeVisible();
    await propuesta.getByRole('button', { name: /discard/i }).click();

    await expect(propuesta).toHaveCount(0);
    /* El documento sigue como estaba: descartar no escribe (RF-1404). */
    await expect(page.getByText('Un parrafo que esta escrito regular')).toBeVisible();
  });

  await test.step('aceptar aplica el cambio a la copia de trabajo', async () => {
    await parrafo.click({ clickCount: 3 });
    await page.getByRole('button', { name: 'Rewrite' }).click();
    await page.getByRole('button', { name: /Improve writing/ }).click();

    const aceptar = propuesta.getByRole('button', { name: 'Accept' });
    await expect(aceptar).toBeEnabled({ timeout: 15_000 });
    await aceptar.click();

    /* La propuesta se retira cuando el guardado ha terminado, no antes. */
    await expect(propuesta).toHaveCount(0);

    /*
     * Lo que escribió el proveedor de mentira está **en el documento** —no en el
     * diff, que es donde también aparecería—, y el párrafo de al lado sigue
     * intacto: se sustituye lo marcado, no el resto.
     */
    await expect(documento.getByText('texto de mentira')).toBeVisible();
    await expect(documento.getByText('Otro parrafo distinto')).toBeVisible();
  });

  await test.step('aceptar no crea versión: deja cambios sin commitear', async () => {
    await expect(page.getByText(/Uncommitted changes/)).toBeVisible();
  });

  await test.step('sobre el documento entero, primero cuánto va a costar', async () => {
    await page.getByLabel('Rewrite the whole document').selectOption('SUMMARISE');

    await expect(techo.getByText(/This will use at most/)).toBeVisible();
    await techo.getByRole('button', { name: 'Cancel' }).click();
    await expect(techo).toHaveCount(0);
  });

  /*
   * Y la protección que importa (RF-1408): si alguien guarda mientras el modelo
   * escribe, la propuesta apunta a un texto que ya no está. Aceptarla se rechaza
   * con la misma comprobación que dos personas editando a la vez, y se ofrece
   * ver qué cambió, en vez de pisar lo que el otro acaba de escribir.
   *
   * Se pide sobre el documento entero, que de paso recorre el camino del techo:
   * así el escenario no depende de volver a marcar texto justo después de que el
   * documento se haya repintado.
   */
  await test.step('si alguien guarda mientras tanto, aceptar se rechaza', async () => {
    await page.getByLabel('Rewrite the whole document').selectOption('SUMMARISE');
    await techo.getByRole('button', { name: 'Go ahead' }).click();
    await expect(propuesta.getByRole('button', { name: 'Accept' })).toBeEnabled({
      timeout: 15_000,
    });

    /* Alguien guarda por detrás, que es lo que pasa cuando se trabaja en equipo. */
    await page.evaluate(async () => {
      /*
       * La aplicación no lleva el identificador en la dirección —no hay rutas—,
       * así que se saca del enlace de descarga, que es el único sitio de la
       * pantalla donde aparece.
       */
      const enlace = window.document.querySelector(
        'a[href*="/document/export"]',
      ) as HTMLAnchorElement;
      const appId = /apps\/([0-9a-f-]{36})/.exec(enlace.href)![1]!;

      const doc = (await (await fetch(`/api/v1/apps/${appId}/document`)).json()) as {
        content: string;
        revision: number;
      };
      await fetch(`/api/v1/apps/${appId}/document`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `${doc.content}\n\nParrafo anadido por otra persona.`,
          revision: doc.revision,
        }),
      });
    });

    await propuesta.getByRole('button', { name: 'Accept' }).click();

    await expect(page.getByText(/while you were writing/)).toBeVisible();

    /*
     * Y se ofrece ver qué cambió, que es la otra mitad del requisito: sin eso,
     * el rechazo es un no a secas y hay que ir a buscar lo que pasó a otra
     * parte.
     */
    await page.getByText('See the saved version').click();
    await expect(page.getByText('Parrafo anadido por otra persona')).toBeVisible();
    await propuesta.getByRole('button', { name: /discard/i }).click();
    await page.getByRole('button', { name: 'Dismiss' }).click();
  });

  expect(erroresDePagina).toEqual([]);
});
