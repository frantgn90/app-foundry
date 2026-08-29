-- El aviso de invitación se ve mientras la invitación siga en pie.

-- La política anterior dejaba visible el aviso de invitación siempre, por tipo,
-- para que el invitado pudiera verlo antes de aceptar, cuando todavía no es
-- miembro y por tanto no pasa la comprobación de pertenencia.
--
-- El efecto secundario era que ese aviso seguía visible después de marcharse del
-- workspace, cuando ya no queda nada que ver ahí (RF-906). Se ata a que la
-- invitación siga viva, que es exactamente el momento en que hace falta la
-- excepción: pendiente antes de aceptar, y ni pendiente ni miembro después de
-- irse.
DROP POLICY notifications_select ON notifications;--> statement-breakpoint

CREATE POLICY notifications_select ON notifications
  FOR SELECT
  USING (
    user_id = current_app_user()
    AND (app_id IS NULL OR EXISTS (SELECT 1 FROM apps a WHERE a.id = notifications.app_id))
    AND (
      workspace_id IN (SELECT user_workspaces(current_app_user()))
      OR (
        type = 'WORKSPACE_INVITED'
        AND notif_recipient_is_invited(user_id, workspace_id)
      )
    )
  );
