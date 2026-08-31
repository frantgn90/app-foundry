import { expect, test } from '@playwright/test';

import { crearSesion } from '../helpers/sesion.js';

const SALIDA =
  '/private/tmp/claude-501/-Users-juanfranciscomartinezvera-Coding-app-foundry/528927e3-2c78-434f-adf6-0d17d49537fd/scratchpad/responsive';

/**
 * RF-608: usable en portátil y escritorio; el móvil es deseable, no bloqueante.
 *
 * La comprobación dura es el desbordamiento horizontal: si la página es más
 * ancha que la ventana, hay que hacer scroll lateral para leer, y eso ya no es
 * usable. Es medible y no opinable, al contrario que «se ve bien».
 */
const ANCHOS = [
  { nombre: 'escritorio-1440', ancho: 1440, alto: 900, exigido: true },
  { nombre: 'portatil-1280', ancho: 1280, alto: 800, exigido: true },
  { nombre: 'portatil-1024', ancho: 1024, alto: 700, exigido: true },
  { nombre: 'tablet-768', ancho: 768, alto: 1024, exigido: true },
  // El móvil se mide y se avisa, pero no tumba la prueba: el requisito lo pone
  // como deseable y no como condición. Un test más estricto que su requisito
  // acaba bloqueando cambios legítimos por algo que nadie prometió.
  { nombre: 'movil-390', ancho: 390, alto: 844, exigido: false },
];

test('la interfaz aguanta a distintos anchos', async ({ page, context }) => {
  const { cookie } = await crearSesion('responsive');
  await context.addCookies([
    { name: 'foundry_session', value: cookie, url: 'http://localhost:4173' },
  ]);

  // Un poco de contenido, para que las pantallas no salgan vacías.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByLabel(/What.s the idea called/).fill('Una app de prueba con nombre largo');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForSelector('main header');

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await editor.pressSequentially('# Un título\n\nUn párrafo cualquiera para tener contenido.\n');
  await page.getByRole('button', { name: /^Save/ }).click();
  await page.getByRole('button', { name: 'Stop editing' }).click();

  const appUrl = page.url();
  const problemas: string[] = [];

  for (const medida of ANCHOS) {
    await page.setViewportSize({ width: medida.ancho, height: medida.alto });

    const pantallas: { nombre: string; abrir: () => Promise<void> }[] = [
      {
        nombre: 'ficha',
        abrir: async () => {
          await page.goto(appUrl);
        },
      },
      {
        nombre: 'listado',
        abrir: async () => {
          await page.goto('/');
        },
      },
      {
        nombre: 'ajustes-cuenta',
        abrir: async () => {
          await page.goto('/');
          await page.getByRole('button', { name: 'Account' }).click();
          await page.getByRole('menuitem', { name: 'Account settings' }).click();
        },
      },
    ];

    for (const pantalla of pantallas) {
      await pantalla.abrir();
      await page.waitForTimeout(400);

      const desbordamiento = await page.evaluate(() => ({
        pagina: document.documentElement.scrollWidth,
        ventana: window.innerWidth,
        // Qué elemento se sale, si alguno.
        culpables: [...document.querySelectorAll('*')]
          .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 3)
          .map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}`),
      }));

      const nombre = `${medida.nombre}-${pantalla.nombre}`;
      if (process.env['CAPTURAS'] === 'true') {
        await page.screenshot({ path: `${SALIDA}/${nombre}.png`, fullPage: false });
      }

      if (desbordamiento.pagina > desbordamiento.ventana + 1) {
        const aviso = `${nombre}: la página mide ${String(desbordamiento.pagina)} y la ventana ${String(desbordamiento.ventana)} → ${desbordamiento.culpables.join(' | ')}`;
        if (medida.exigido) problemas.push(aviso);
        else console.log('AVISO (móvil, no bloqueante):', aviso);
      }
    }
  }

  console.log(problemas.length === 0 ? 'SIN DESBORDAMIENTOS' : problemas.join('\n'));
  expect(problemas, 'ninguna pantalla debe desbordarse en portátil ni escritorio').toEqual([]);
});
