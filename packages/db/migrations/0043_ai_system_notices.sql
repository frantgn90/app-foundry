-- Los avisos que no provoca nadie (RF-905, RF-1009, RF-1205).
--
-- La política de inserción prohibía escribirte un aviso a ti mismo, que es la
-- forma en el motor de «nadie se entera de lo que acaba de hacer él» (RF-905).
-- Con la v2 aparecen dos avisos que **no los hace una persona**: que el consumo
-- del mes pase del umbral —lo provoca el uso acumulado, a menudo de otros— y que
-- el proveedor retire un modelo asignado.
--
-- Ambos van dirigidos al dueño del workspace, que es quien puede hacer algo. Y
-- resulta que el dueño es a menudo quien está usando la aplicación cuando eso se
-- detecta, así que la regla anterior los tiraba justo cuando más falta hacían:
-- en silencio, porque la emisión de avisos no puede tumbar la acción que la
-- provocó.
--
-- La excepción se acota a esos dos tipos y a nadie más: el resto de avisos sigue
-- necesitando un actor distinto del destinatario.
DROP POLICY notifications_insert ON notifications;--> statement-breakpoint

CREATE POLICY notifications_insert ON notifications
  FOR INSERT
  WITH CHECK (
    (
      user_id <> current_app_user()
      OR type IN ('AI_QUOTA_THRESHOLD', 'AI_MODEL_UNAVAILABLE')
    )
    AND workspace_id IN (SELECT user_workspaces(current_app_user()))
    AND (
      notif_recipient_is_member(user_id, workspace_id)
      OR (type = 'WORKSPACE_INVITED' AND notif_recipient_is_invited(user_id, workspace_id))
    )
  );
