-- Candidatos para refrescar el catálogo de modelos (RF-1009, AQ2).
--
-- El refresco corre en segundo plano y sin nadie delante, así que no tiene
-- identidad con la que ver `workspace_ai_providers`. Esta función le dice qué
-- hay que refrescar y con qué credencial hacerlo.
--
-- Va en SECURITY DEFINER y **sí** se le concede al rol de la aplicación, que es
-- una excepción que conviene justificar: es la única forma de que el proceso que
-- atiende peticiones pueda además mantener una caché compartida, sin abrirle una
-- conexión privilegiada dentro. Se acota todo lo que se puede:
--
--   · devuelve como mucho una fila por proveedor, no un listado;
--   · solo identificadores, nunca credenciales ni contenido;
--   · solo de proveedores activos, en workspaces con la IA encendida;
--   · y solo cuando el catálogo de ese proveedor está viejo, así que en régimen
--     normal no devuelve nada.
CREATE OR REPLACE FUNCTION ai_catalog_refresh_candidates(max_age interval)
RETURNS TABLE (workspace_id uuid, provider ai_provider, owner_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (p.provider) p.workspace_id, p.provider, w.owner_id
  FROM workspace_ai_providers p
  JOIN workspaces w ON w.id = p.workspace_id
  WHERE p.status = 'ACTIVE'
    AND w.ai_enabled
    AND NOT EXISTS (
      SELECT 1 FROM ai_models m
      WHERE m.provider = p.provider
        AND m.fetched_at > now() - max_age
    )
  ORDER BY p.provider, p.created_at;
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION ai_catalog_refresh_candidates(interval) TO app_user;
