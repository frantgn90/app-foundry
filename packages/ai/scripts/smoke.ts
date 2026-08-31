/**
 * Prueba de humo contra los proveedores **de verdad**.
 *
 * Se ejecuta a mano, con una clave propia, y **nunca en integración continua**
 * (TRD v2 §16): la suite automática no llama a nadie y no gasta la cuota de
 * nadie. Esto es lo otro: la comprobación de que lo que escribimos contra la
 * documentación se comporta como dice cuando hay una API al otro lado.
 *
 *   ANTHROPIC_API_KEY=... pnpm --filter @app-foundry/ai smoke anthropic
 *   GROQ_API_KEY=...      pnpm --filter @app-foundry/ai smoke groq
 *
 * Gasta unos pocos cientos de tokens por ejecución.
 */
import type { LlmProvider, TextRequest } from '@app-foundry/core';
import { assertStrictSchema, supportForTask, AiTask } from '@app-foundry/core';

import { AnthropicProvider } from '../src/anthropic/anthropic-provider.js';
import { GroqProvider } from '../src/groq/groq-provider.js';

const IDEAS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ideas'],
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'problem'],
        properties: { name: { type: 'string' }, problem: { type: 'string' } },
      },
    },
  },
};

async function main(): Promise<void> {
  const cual = process.argv[2];
  const { provider, apiKey, model } = configuracion(cual);

  if (!apiKey) {
    console.error(`Falta la clave en el entorno para ${cual ?? '(sin proveedor)'}`);
    process.exit(1);
  }
  const credential = { apiKey };

  console.log(`\n· Proveedor: ${provider.id}`);
  console.log(`  Capacidades: ${JSON.stringify(provider.capabilities)}`);
  for (const task of Object.values(AiTask)) {
    const soporte = supportForTask(task, provider.capabilities);
    console.log(
      `  ${task}: ${soporte.supported ? 'sí' : 'NO'}${soporte.degraded.length ? ` (degradada: ${soporte.degraded.join(', ')})` : ''}`,
    );
  }

  console.log('\n· verify()');
  await provider.verify(credential);
  console.log('  credencial válida');

  console.log('\n· listModels()');
  const modelos = await provider.listModels(credential);
  for (const m of modelos.slice(0, 5)) {
    console.log(
      `  ${m.id} · ventana ${String(m.contextWindow)} · salida ${String(m.maxOutputTokens)}`,
    );
  }
  console.log(`  ${String(modelos.length)} modelos`);

  const peticion: TextRequest = {
    model,
    system: 'Respondes en una sola frase, en castellano.',
    messages: [{ role: 'user', content: '¿Para qué sirve un documento de visión?' }],
    maxOutputTokens: 200,
  };

  console.log('\n· countTokens()');
  const cuenta = await provider.countTokens(peticion, credential);
  console.log(
    `  ${String(cuenta.inputTokens)} tokens de entrada (exacto: ${String(cuenta.exact)})`,
  );

  console.log('\n· streamText()');
  process.stdout.write('  ');
  for await (const evento of provider.streamText(peticion, credential)) {
    if (evento.type === 'delta') process.stdout.write(evento.text);
    if (evento.type === 'usage') {
      console.log(
        `\n  consumo: ${String(evento.usage.inputTokens)} entrada / ${String(evento.usage.outputTokens)} salida`,
      );
    }
  }

  console.log('\n· streamObject() con el subconjunto estricto');
  assertStrictSchema(IDEAS_SCHEMA, 'esquema de ideas');
  for await (const evento of provider.streamObject(
    {
      ...peticion,
      system: 'Propones ideas de aplicaciones.',
      messages: [{ role: 'user', content: 'Dame dos ideas de apps para gestión de residuos.' }],
      maxOutputTokens: 600,
      schema: IDEAS_SCHEMA,
    },
    credential,
  )) {
    if (evento.type === 'done') console.log(`  ${JSON.stringify(evento.value, null, 2)}`);
  }

  console.log('\nHumo pasado.\n');
}

function configuracion(cual: string | undefined): {
  provider: LlmProvider;
  apiKey: string | undefined;
  model: string;
} {
  switch (cual) {
    case 'anthropic':
      return {
        provider: new AnthropicProvider(),
        apiKey: process.env['ANTHROPIC_API_KEY'],
        model: process.env['SMOKE_MODEL'] ?? 'claude-opus-5',
      };
    case 'groq':
      return {
        provider: new GroqProvider(),
        apiKey: process.env['GROQ_API_KEY'],
        model: process.env['SMOKE_MODEL'] ?? 'llama-3.3-70b-versatile',
      };
    case undefined:
    default:
      console.error('Uso: smoke <anthropic|groq>');
      return process.exit(1);
  }
}

await main();
