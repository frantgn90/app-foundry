-- Que un agente avise a quien lo llamó (RF-1612, RF-905).
--
-- La política de inserción exigía `user_id <> current_app_user()`, con este
-- razonamiento: nadie se avisa a sí mismo, y aunque el dominio ya lo comprueba,
-- aquí quedaba como red de seguridad.
--
-- Con agentes deja de valer. El worker escribe con la identidad de **quien
-- provocó** la respuesta, porque es la única forma de que un agente no vea nada
-- que esa persona no vea. Así que cuando alguien menciona a un agente y este
-- contesta, el aviso más útil de todos —«te ha contestado»— tiene por
-- destinatario justamente a quien figura como actor de la transacción.
--
-- Y ese aviso hay que darlo: quien menciona a un agente y cierra la pestaña no
-- tiene otra forma de enterarse. RF-905 dice que no se avisa a nadie de **lo que
-- ha hecho**, y contestar no lo ha hecho esa persona, lo ha hecho el agente.
--
-- Se quita la condición de la política y se deja donde siempre estuvo de
-- verdad: en `audiencia()`, que excluye al actor y tiene sus propias pruebas.
-- Lo que se pierde al quitarla es exactamente esto: la posibilidad de escribir
-- un aviso en la propia bandeja. No es una fuga —no se ve nada que no se
-- viera— sino, como mucho, ruido para uno mismo.
--
-- Lo que la política sigue exigiendo no cambia: pertenecer al workspace y que
-- el destinatario sea miembro suyo o esté invitado.

DROP POLICY notifications_insert ON notifications;--> statement-breakpoint

CREATE POLICY notifications_insert ON notifications
  FOR INSERT
  WITH CHECK (
    workspace_id IN (SELECT user_workspaces(current_app_user()))
    AND (
      notif_recipient_is_member(user_id, workspace_id)
      OR (type = 'WORKSPACE_INVITED' AND notif_recipient_is_invited(user_id, workspace_id))
    )
  );
