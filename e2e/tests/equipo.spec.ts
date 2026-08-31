import { type Browser, expect, type Page, test } from '@playwright/test';

import { crearSesion, type Sesion } from '../helpers/sesion.js';

/**
 * El recorrido de trabajar entre dos (RNF-402).
 *
 * Alta, crear la app, compartirla, invitar, editar como invitada y ver el
 * historial. Es el único recorrido con **dos identidades a la vez**, y por eso
 * existe: casi todo lo que falla al trabajar en equipo falla en el salto de una
 * persona a otra —lo que ve la invitada, lo que puede tocar, y a nombre de quién
 * queda—, y eso no se ve nunca con una sola sesión.
 */
async function abrirComo(browser: Browser, sesion: Sesion): Promise<Page> {
  const context = await browser.newContext();
  await context.addCookies([
    { name: 'foundry_session', value: sesion.cookie, url: 'http://localhost:4173' },
  ]);
  return context.newPage();
}

test('de invitar a alguien a ver su nombre en el historial', async ({ browser }) => {
  const anfitriona = await crearSesion('anfitriona');
  const invitada = await crearSesion('invitada');

  const suya = await abrirComo(browser, anfitriona);
  const ajena = await abrirComo(browser, invitada);

  const errores: string[] = [];
  suya.on('pageerror', (e) => errores.push(`anfitriona: ${e.message}`));
  ajena.on('pageerror', (e) => errores.push(`invitada: ${e.message}`));

  await test.step('crear la app y abrirla al workspace', async () => {
    await suya.goto('/');
    await suya.getByLabel(/What.s the idea called/).fill('Cuadrante');
    await suya.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(suya.getByRole('heading', { name: 'Cuadrante' })).toHaveCount(1);

    await suya.getByRole('button', { name: 'settings', exact: true }).click();
    // Un clic, no `check()`: el estado del radio no es del navegador sino de lo
    // que responde el servidor, así que no cambia en el mismo gesto.
    await suya.getByRole('radio', { name: /Workspace can edit/ }).click();
    await expect(suya.getByRole('radio', { name: /Workspace can edit/ })).toBeChecked();
  });

  await test.step('invitar por su dirección', async () => {
    // Se vuelve al workspace por la ruta de arriba, que es como se hace.
    await suya
      .getByRole('button', { name: /workspace$/ })
      .first()
      .click();
    await suya.getByRole('button', { name: 'People & invitations' }).click();

    await suya.getByLabel('Email to invite').fill(invitada.email);
    await suya.getByRole('button', { name: 'Invite', exact: true }).click();

    // Quien ya tenía cuenta entra en el acto: no hay invitación esperando, hay
    // una persona más en la lista.
    await expect(suya.getByText(`@${invitada.handle}`)).toBeVisible();
  });

  await test.step('la invitada la encuentra y escribe en ella', async () => {
    await ajena.goto('/');

    // Aterriza en el suyo, que es lo correcto aunque el ajeno ordene antes, y se
    // cambia desde la ruta de arriba. El workspace lleva el nombre de pila de
    // quien lo creó, sin el sufijo que distingue a las cuentas de prueba.
    await expect(ajena.getByRole('heading', { name: /invitada's workspace/ })).toHaveCount(1);
    await ajena.getByRole('button', { name: /invitada's workspace/ }).click();
    await ajena.getByRole('option', { name: /anfitriona's workspace/ }).click();
    await expect(ajena.getByRole('heading', { name: /anfitriona's workspace/ })).toHaveCount(1);

    await ajena.getByRole('button', { name: /Cuadrante/ }).click();
    await expect(ajena.getByRole('heading', { name: 'Cuadrante', level: 1 })).toHaveCount(1);

    // Aquí está lo que de verdad se comprueba: una invitada puede editar porque
    // la app se abrió al workspace, no porque sea suya.
    await ajena.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = ajena.locator('.cm-content');
    await editor.click();
    await ajena.keyboard.press('ControlOrMeta+a');
    await editor.pressSequentially('# El problema\n\nNadie sabe quien esta de guardia.\n');
    await ajena.getByRole('button', { name: 'Save', exact: true }).click();
    await ajena.getByRole('button', { name: 'Stop editing' }).click();

    await ajena.getByRole('button', { name: 'Commit…' }).click();
    await ajena.getByLabel('What changed?').fill('Digo de que va');
    await ajena.getByRole('button', { name: 'Create version' }).click();
    await expect(ajena.getByRole('button', { name: 'Commit…' })).toHaveCount(0);
  });

  await test.step('la anfitriona ve la versión, a nombre de quien la escribió', async () => {
    await suya.reload();
    await suya.getByRole('button', { name: /Cuadrante/ }).click();

    await expect(suya.getByText('Nadie sabe quien esta de guardia.')).toBeVisible();

    // El historial dice quién y qué cambió: es lo que hace que compartir tenga
    // sentido y no sea un texto que cambia solo.
    const historial = suya.getByLabel('Version', { exact: true });
    await expect(historial.locator('option')).toHaveCount(2);
    await expect(historial.locator('option:checked')).toHaveText(/v2 · current/);
    await expect(suya.getByText(`@${invitada.handle} · Digo de que va`)).toBeVisible();
  });

  expect(errores, 'ninguna de las dos sesiones debe romperse').toEqual([]);
});
