-- Aislamiento de la configuración de IA (RNF-603, RD-6).
--
-- Dos tablas con criterios distintos porque sirven a cosas distintas: la
-- configuración la mira cualquier miembro —sin saber si hay proveedor activo no
-- se puede decidir si enseñar las funciones de IA (RF-1010)— y la escribe solo
-- el dueño, que es quien pone la clave y quien la paga (RF-1002).

ALTER TABLE workspace_ai_providers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_ai_providers FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_ai_credentials ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_ai_credentials FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AP4 · La configuración
-- ---------------------------------------------------------------------------
CREATE POLICY ai_providers_visible ON workspace_ai_providers
  FOR SELECT
  USING (workspace_id IN (SELECT user_workspaces(current_app_user())));
--> statement-breakpoint

-- Configurar, verificar, poner cupo y borrar: del dueño y de nadie más. El
-- WITH CHECK impide además fabricar la configuración de un workspace ajeno.
CREATE POLICY ai_providers_owner_manage ON workspace_ai_providers
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_ai_providers.workspace_id AND w.owner_id = current_app_user()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_ai_providers.workspace_id AND w.owner_id = current_app_user()
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AP4 · El secreto
-- ---------------------------------------------------------------------------
-- Aquí hay una interacción que conviene tener delante: con FORCE, las políticas
-- se aplican **también** dentro de una función SECURITY DEFINER, porque su
-- dueño es el de la tabla. Es decir, la política de lectura de abajo no gobierna
-- solo lo que ve el rol de la aplicación: gobierna lo que `ai_credential_secret`
-- puede devolver.
--
-- Por eso la lectura se abre a los miembros y no solo al dueño. Cualquier
-- miembro puede provocar una invocación —comentar mencionando a un agente, pedir
-- que le mejoren un párrafo—, y la credencial que la atiende es la del dueño.
-- Lo que impide que ese miembro **vea** el secreto no es esta política sino el
-- permiso por columna de AP3: sin `SELECT` sobre `ciphertext` ni `nonce`, lo más
-- que puede leer es de qué proveedor es y con qué versión de clave se cifró.
CREATE POLICY ai_credentials_member_read ON workspace_ai_credentials
  FOR SELECT
  USING (workspace_id IN (SELECT user_workspaces(current_app_user())));
--> statement-breakpoint

-- Escribirla, en cambio, es exclusivo del dueño: es su clave.
CREATE POLICY ai_credentials_owner_write ON workspace_ai_credentials
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_ai_credentials.workspace_id AND w.owner_id = current_app_user()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_ai_credentials.workspace_id AND w.owner_id = current_app_user()
    )
  );
