/**
 * Comprobación manual: ¿el canario detectaría que alguien desactiva la RLS?
 *
 * No es un test del suite: es la verificación de que el suite sirve de algo.
 * Se ejecuta a mano con:  pnpm exec tsx test/canario-detecta.ts
 */
import { sql } from 'drizzle-orm';

import { sessions, users } from '../src/index.js';
import { asAppUser, startTestDb } from './helpers.js';

const testDb = await startTestDb();
const enUnaHora = new Date(Date.now() + 3_600_000);

const [ana] = await testDb.db
  .insert(users)
  .values({ githubId: 1, handle: 'ana', email: 'a@e.com', displayName: 'Ana' })
  .returning({ id: users.id });
const [bruno] = await testDb.db
  .insert(users)
  .values({ githubId: 2, handle: 'bruno', email: 'b@e.com', displayName: 'Bruno' })
  .returning({ id: users.id });
await testDb.db.insert(sessions).values([
  { userId: ana!.id, tokenHash: 'ana', expiresAt: enUnaHora },
  { userId: bruno!.id, tokenHash: 'bruno', expiresAt: enUnaHora },
]);

const conRls = await asAppUser(testDb.db, ana!.id, (tx) => tx.select().from(sessions));
console.log(
  `con RLS activa, Ana ve ${conRls.length} sesión(es): ${conRls.map((s) => s.tokenHash).join(', ')}`,
);

// Alguien "desactiva un momento la RLS para depurar".
await testDb.db.execute(sql`ALTER TABLE sessions DISABLE ROW LEVEL SECURITY`);
const sinRls = await asAppUser(testDb.db, ana!.id, (tx) => tx.select().from(sessions));
console.log(
  `con RLS desactivada, Ana ve ${sinRls.length} sesión(es): ${sinRls.map((s) => s.tokenHash).join(', ')}`,
);

const flags = await testDb.db.execute<{ relrowsecurity: boolean }>(
  sql`SELECT relrowsecurity FROM pg_class WHERE relname = 'sessions'`,
);
console.log(`\n¿el canario lo detectaría?`);
console.log(`  - el test de aislamiento fallaría: ${sinRls.length !== 1 ? 'SÍ' : 'no'}`);
console.log(
  `  - el test de flags fallaría:       ${flags.rows[0]?.relrowsecurity === false ? 'SÍ' : 'no'}`,
);

await testDb.stop();
