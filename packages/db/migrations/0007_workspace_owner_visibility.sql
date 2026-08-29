-- El dueño ve siempre su workspace, tenga o no fila de membresía.
--
-- La política anterior resolvía la visibilidad únicamente por `user_workspaces`,
-- es decir, consultando `workspace_members`. Eso creaba un ciclo al dar de alta
-- a alguien: se inserta el workspace y, con RETURNING, Postgres evalúa además la
-- política de SELECT sobre la fila recién creada... que todavía no es visible,
-- porque la membresía se inserta justo después. El INSERT funcionaba sin
-- RETURNING y fallaba con él, que es de los errores más desconcertantes que
-- puede dar la RLS.
--
-- Incluir al dueño no solo rompe el ciclo: es lo correcto. Un workspace sin su
-- dueño entre quienes lo ven sería un espacio huérfano en la práctica.
DROP POLICY workspaces_visible ON workspaces;--> statement-breakpoint

CREATE POLICY workspaces_visible ON workspaces
  FOR SELECT
  USING (
    owner_id = current_app_user()
    OR id IN (SELECT user_workspaces(current_app_user()))
  );
