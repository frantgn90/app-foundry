import { createHash, randomBytes } from 'node:crypto';

import pg from 'pg';

/**
 * Crea una cuenta y su sesión, y devuelve la cookie.
 *
 * El acceso real es OAuth contra GitHub, que no se puede automatizar sin
 * depender de un servicio externo y de credenciales de alguien. Lo que hace el
 * login es exactamente esto —crear la cuenta, su workspace y una sesión—, así
 * que se hace directamente y se prueba todo lo demás, que es lo que se rompe.
 */
export async function crearSesion(handle: string): Promise<{ cookie: string; userId: string }> {
  const url = process.env['DATABASE_MIGRATION_URL'];
  if (!url) throw new Error('Falta DATABASE_MIGRATION_URL: carga el .env antes de ejecutar');

  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();

  try {
    const sufijo = Date.now().toString().slice(-6);
    const identidad = `${handle}-${sufijo}`;

    const { rows } = await cliente.query<{ auth_upsert_user: string }>(
      `SELECT auth_upsert_user($1::bigint, $2::citext, $3::citext, $4::text, NULL::text)`,
      [700_000 + Number(sufijo), identidad, `${identidad}@example.com`, handle],
    );
    const userId = rows[0]!.auth_upsert_user;

    // El workspace personal lo crea el servicio de autenticación, no la función
    // de alta, así que aquí hay que ponerlo.
    const ws = await cliente.query<{ id: string }>(
      `INSERT INTO workspaces (owner_id, name, slug, is_personal)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [userId, `${handle}'s workspace`, identidad],
    );
    await cliente.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [ws.rows[0]!.id, userId],
    );

    const token = randomBytes(32).toString('base64url');
    await cliente.query(
      `SELECT auth_create_session($1::uuid, $2::bytea, $3::timestamptz, NULL::inet, 'e2e'::text)`,
      [userId, createHash('sha256').update(token).digest(), new Date(Date.now() + 3_600_000)],
    );

    return { cookie: token, userId };
  } finally {
    await cliente.end();
  }
}
