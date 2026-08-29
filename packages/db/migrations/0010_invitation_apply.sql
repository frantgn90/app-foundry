-- Aplica una invitación recién creada si su destinatario ya tiene cuenta.
--
-- RF-304 dice que a quien ya tiene cuenta se le añade de inmediato, y RF-312
-- que el sistema no debe confirmar si un email existe. La forma de cumplir
-- ambas es que el camino sea **el mismo** en los dos casos: siempre se crea la
-- invitación y siempre se llama a esto, que no devuelve nada. Quien invita
-- recibe exactamente la misma respuesta exista o no esa cuenta.
--
-- Va en una función con privilegios porque quien invita no puede —ni debe—
-- consultar la tabla de usuarios buscando por email.
CREATE OR REPLACE FUNCTION workspace_apply_invitation_if_user_exists(inv_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  inv record;
  destinatario uuid;
BEGIN
  SELECT id, workspace_id, email, status, expires_at INTO inv
  FROM workspace_invitations WHERE id = inv_id;

  IF NOT FOUND OR inv.status <> 'PENDING' OR inv.expires_at <= now() THEN
    RETURN;
  END IF;

  SELECT id INTO destinatario FROM users WHERE email = inv.email AND status = 'ACTIVE';
  IF destinatario IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (inv.workspace_id, destinatario, 'MEMBER')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  UPDATE workspace_invitations SET status = 'ACCEPTED' WHERE id = inv_id;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION workspace_apply_invitation_if_user_exists(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION workspace_apply_invitation_if_user_exists(uuid) TO app_user;
