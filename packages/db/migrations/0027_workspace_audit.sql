-- El dueño de un workspace puede ver lo que ha pasado dentro (RF-704).

-- La tabla de auditoría no tiene políticas de lectura para nadie: se escribe y
-- no se lee desde la aplicación (RF-705). Eso deja fuera al dueño de un
-- workspace, que sí tiene derecho a ver su propia actividad.
--
-- Se abre por una función acotada y no por una política, por lo mismo que en el
-- resto de este sistema: una política dejaría `audit_log` legible en cualquier
-- consulta y bastaría un join descuidado para sacar de ahí lo que no toca. Esto
-- recibe un workspace, comprueba que quien pregunta es su dueño, y no admite
-- ninguna otra condición.
CREATE OR REPLACE FUNCTION workspace_audit(
  ws uuid,
  desde timestamptz,
  hasta timestamptz,
  tope integer
)
RETURNS TABLE (
  id uuid,
  actor_id uuid,
  actor_handle citext,
  action text,
  resource_type text,
  resource_id uuid,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workspaces w WHERE w.id = ws AND w.owner_id = current_app_user()
  ) THEN
    RAISE EXCEPTION 'Only the workspace owner can see its activity'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT a.id, a.actor_id, u.handle, a.action, a.resource_type, a.resource_id,
         a.metadata, a.created_at
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id
   WHERE a.workspace_id = ws
     AND (desde IS NULL OR a.created_at >= desde)
     AND (hasta IS NULL OR a.created_at <= hasta)
   ORDER BY a.created_at DESC
   LIMIT least(greatest(coalesce(tope, 100), 1), 500);
END;
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION workspace_audit(uuid, timestamptz, timestamptz, integer) TO app_user;
