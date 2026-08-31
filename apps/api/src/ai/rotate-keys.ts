/**
 * Recifra las credenciales de proveedor con la clave actual (AP9, T-26).
 *
 * Se ejecuta a mano después de añadir una versión nueva a `AI_CREDENTIAL_KEYS`:
 *
 *   AI_CREDENTIAL_KEYS=1:vieja,2:nueva pnpm --filter @app-foundry/api ai:rotate
 *   ... y con `--dry-run` para ver qué haría sin tocar nada.
 *
 * Va con el **rol de migraciones** y no con el de la aplicación, por dos
 * motivos que conviene tener juntos: necesita leer el texto cifrado, que al rol
 * de la aplicación le está vedado por permiso de columna (AP3); y corre sin
 * ninguna persona detrás, así que la función acotada —que exige pertenencia al
 * workspace— no le sirve. Es la única vía deliberadamente distinta, y por eso es
 * un comando aparte y no un endpoint.
 *
 * Retirar la clave vieja de la variable **después** de que esto termine sin
 * ilegibles: hacerlo antes deja credenciales que nadie puede descifrar.
 */
import { CredentialCipher, parseKeyRing, rotateCredentials } from '@app-foundry/ai';
import type { StoredCredential } from '@app-foundry/ai';
import { createDb, workspaceAiCredentials } from '@app-foundry/db';
import { loadEnv } from '@app-foundry/env';
import { and, eq } from 'drizzle-orm';

const env = loadEnv();
const dryRun = process.argv.includes('--dry-run');

if (!env.AI_CREDENTIAL_KEYS) {
  console.error('Falta AI_CREDENTIAL_KEYS: no hay llavero con el que recifrar.');
  process.exit(1);
}

const cipher = new CredentialCipher(parseKeyRing(env.AI_CREDENTIAL_KEYS));
const handle = createDb(env.DATABASE_MIGRATION_URL, 1);

const filas = (await handle.db
  .select({
    workspaceId: workspaceAiCredentials.workspaceId,
    provider: workspaceAiCredentials.provider,
    ciphertext: workspaceAiCredentials.ciphertext,
    nonce: workspaceAiCredentials.nonce,
    keyVersion: workspaceAiCredentials.keyVersion,
  })
  .from(workspaceAiCredentials)) as StoredCredential[];

const resultado = rotateCredentials(filas, cipher);

console.log(`Clave actual: ${String(cipher.currentKeyVersion)}`);
console.log(`  al día:      ${String(resultado.upToDate)}`);
console.log(`  por recifrar:${String(resultado.rotated.length)}`);
console.log(`  ilegibles:   ${String(resultado.unreadable.length)}`);

for (const mala of resultado.unreadable) {
  console.error(`  · ${mala.workspaceId} / ${mala.provider}: ${mala.reason}`);
}

if (!dryRun) {
  /*
   * Una transacción para todo: una rotación a medias deja el llavero y la base
   * de datos contando historias distintas.
   */
  await handle.db.transaction(async (tx) => {
    for (const fila of resultado.rotated) {
      await tx
        .update(workspaceAiCredentials)
        .set({
          ciphertext: fila.ciphertext,
          nonce: fila.nonce,
          keyVersion: fila.keyVersion,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workspaceAiCredentials.workspaceId, fila.workspaceId),
            eq(workspaceAiCredentials.provider, fila.provider),
          ),
        );
    }
  });
  console.log('Recifrado escrito.');
} else {
  console.log('Simulación: no se ha escrito nada.');
}

await handle.close();

/* Con ilegibles, la rotación no está terminada: no retires la clave vieja. */
process.exit(resultado.unreadable.length > 0 ? 1 : 0);
