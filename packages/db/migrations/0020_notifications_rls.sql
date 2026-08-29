-- Cada uno ve y purga lo suyo, y nadie fabrica avisos para desconocidos.

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- X2 · A quién se le puede escribir
-- ---------------------------------------------------------------------------
-- Un aviso lo inserta quien provoca la acción, pero va dirigido a otra persona,
-- así que es el único sitio del sistema donde se escribe una fila ajena. Sin
-- límite, cualquiera podría escribirle a cualquiera: molestias, y además una vía
-- para averiguar quién tiene cuenta aquí probando identificadores (RF-312).
--
-- El límite es la pertenencia: se avisa a quien comparte contigo el workspace
-- del aviso. Las dos funciones van en SECURITY DEFINER porque la comprobación
-- mira filas que el emisor no tiene por qué ver —la membresía del destinatario,
-- o su cuenta si aún no es miembro— y sin eso la política se evaluaría con la
-- visibilidad de quien escribe y diría que no. Reciben un par concreto y
-- devuelven un booleano: no listan, no aceptan filtros y no sirven para
-- enumerar a nadie.
CREATE OR REPLACE FUNCTION notif_recipient_is_member(recipient uuid, ws uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members m
    WHERE m.workspace_id = ws AND m.user_id = recipient
  );
$$;--> statement-breakpoint

-- La invitación es la excepción necesaria: se avisa precisamente a quien todavía
-- no es miembro. Se acota a que exista una invitación viva a ese workspace
-- dirigida a la dirección de esa cuenta, de modo que el aviso solo puede
-- alcanzar a quien ya ha sido invitado de verdad.
CREATE OR REPLACE FUNCTION notif_recipient_is_invited(recipient uuid, ws uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_invitations i
    JOIN users u ON u.email = i.email
    WHERE i.workspace_id = ws
      AND u.id = recipient
      AND i.status = 'PENDING'
      AND i.expires_at > now()
  );
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION notif_recipient_is_member(uuid, uuid) TO app_user;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notif_recipient_is_invited(uuid, uuid) TO app_user;--> statement-breakpoint

-- Quien escribe ha de ser del workspace: si no, el aviso no nace de nada que esa
-- persona pueda haber hecho allí. Y nadie se avisa a sí mismo (RF-905); esto lo
-- comprueba también el dominio, pero aquí queda como red de seguridad, porque un
-- descuido al calcular destinatarios es fácil y silencioso.
CREATE POLICY notifications_insert ON notifications
  FOR INSERT
  WITH CHECK (
    user_id <> current_app_user()
    AND workspace_id IN (SELECT user_workspaces(current_app_user()))
    AND (
      notif_recipient_is_member(user_id, workspace_id)
      OR (type = 'WORKSPACE_INVITED' AND notif_recipient_is_invited(user_id, workspace_id))
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- X2 · Lo que se ve deja de verse al perder el acceso (RF-906)
-- ---------------------------------------------------------------------------
-- No basta con «es mío»: si te sacan de un workspace, sus avisos dejan de estar
-- a la vista, aunque sigan en la tabla hasta que los purgue el usuario o el
-- plazo. La comprobación de la app se apoya en la política de `apps`, así que
-- refleja el acceso real en este momento y no una copia que envejece.
--
-- La invitación se exceptúa por lo mismo que arriba: mientras no la aceptas no
-- eres miembro, y esconderte el aviso lo dejaría inservible.
CREATE POLICY notifications_select ON notifications
  FOR SELECT
  USING (
    user_id = current_app_user()
    AND (app_id IS NULL OR EXISTS (SELECT 1 FROM apps a WHERE a.id = notifications.app_id))
    AND (
      type = 'WORKSPACE_INVITED'
      OR workspace_id IN (SELECT user_workspaces(current_app_user()))
    )
  );
--> statement-breakpoint

-- Marcar leído es lo único que se puede cambiar, y de eso se encarga el permiso
-- de columna de abajo: las políticas filtran filas, nunca columnas.
CREATE POLICY notifications_update ON notifications
  FOR UPDATE
  USING (user_id = current_app_user())
  WITH CHECK (user_id = current_app_user());
--> statement-breakpoint

-- Purgar es cosa del dueño y de nadie más (RF-909).
--
-- El alcance real lo marca la política de lectura de arriba, no esta: Postgres
-- aplica las políticas de SELECT también al resolver el WHERE de un borrado, así
-- que solo se purga lo que se ve. Es lo coherente —si un workspace ha dejado de
-- estar a tu alcance, sus avisos ya no están en tu lista y no hay nada que
-- vaciar—, y de los que quedan invisibles se encarga la purga automática, que no
-- pasa por estas políticas (RF-910).
CREATE POLICY notifications_delete ON notifications
  FOR DELETE
  USING (user_id = current_app_user());
--> statement-breakpoint

REVOKE UPDATE ON notifications FROM app_user;--> statement-breakpoint
GRANT UPDATE (read_at) ON notifications TO app_user;
