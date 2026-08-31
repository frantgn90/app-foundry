-- El interruptor general de la IA de un workspace (RF-1012).
--
-- Apagarlo no borra nada: la configuración, las credenciales y los agentes se
-- quedan donde están, y lo único que ocurre es que no se invoca a nadie.

ALTER TABLE "workspaces" ADD COLUMN "ai_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AP7 · El interruptor, también en la puerta del secreto
-- ---------------------------------------------------------------------------
-- Si apagar la IA fuera solo una comprobación en el servicio, cualquier camino
-- que se olvidara de mirarla seguiría invocando. Poniéndolo aquí, apagar el
-- interruptor deja el secreto ilegible y **ninguna** ruta puede invocar, se
-- acuerde o no de comprobarlo (RNF-101).
CREATE OR REPLACE FUNCTION ai_credential_secret(ws uuid, prov ai_provider)
RETURNS TABLE (ciphertext bytea, nonce bytea, key_version integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.ciphertext, c.nonce, c.key_version
  FROM workspace_ai_credentials c
  JOIN workspace_ai_providers p
    ON p.workspace_id = c.workspace_id AND p.provider = c.provider
  JOIN workspaces w
    ON w.id = c.workspace_id
  WHERE c.workspace_id = ws
    AND c.provider = prov
    AND p.status = 'ACTIVE'
    AND w.ai_enabled
    AND EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.workspace_id = ws AND m.user_id = current_app_user()
    );
$$;
