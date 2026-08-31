-- La credencial deja de poder leerse por las buenas (T-27, RNF-602, RNF-603).
--
-- La Row-Level Security filtra filas, no columnas: no basta con acotar quién ve
-- la fila si el texto cifrado viaja en cualquier `select *`. Aquí se cierra por
-- dos vías complementarias, la misma idea que la v1 usó para el perfil (T-20) y
-- para el login (T-19).

-- ---------------------------------------------------------------------------
-- AP3 · Permiso por columna
-- ---------------------------------------------------------------------------
-- El rol de la aplicación pierde `SELECT` sobre la tabla entera y lo recupera
-- solo sobre lo que no es secreto. No es un adorno: sin poder leer
-- `workspace_id` y `provider` no podría ni actualizar su propia fila, porque un
-- `UPDATE ... WHERE` exige leer las columnas del filtro. Con esto escribe con
-- normalidad y el cifrado y su nonce le siguen estando vedados.
REVOKE SELECT ON workspace_ai_credentials FROM app_user;--> statement-breakpoint

GRANT SELECT (workspace_id, provider, key_version, created_at, updated_at)
  ON workspace_ai_credentials TO app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AP3 · La única puerta al secreto
-- ---------------------------------------------------------------------------
-- Va en SECURITY DEFINER porque tiene que leer columnas que el rol de la
-- aplicación no puede leer. Eso la convierte en la superficie más delicada del
-- sistema, así que se acota hasta donde se puede:
--
--   · recibe un par concreto y devuelve una fila; no acepta filtros arbitrarios,
--     no lista y no sirve para enumerar nada;
--   · exige que **haya una persona detrás**: quien pide el secreto ha de ser
--     miembro de ese workspace. El trabajo en segundo plano no es una excepción,
--     porque siempre nace de algo que hizo alguien —una mención, una petición de
--     revisión— y corre con su identidad;
--   · exige que el proveedor esté activo, de modo que uno desactivado o inválido
--     no se pueda usar ni por descuido (RF-1006, RF-1012).
--
-- `search_path` fijo para que nadie pueda colar tablas propias por delante.
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
  WHERE c.workspace_id = ws
    AND c.provider = prov
    AND p.status = 'ACTIVE'
    AND EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.workspace_id = ws AND m.user_id = current_app_user()
    );
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION ai_credential_secret(uuid, ai_provider) TO app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AP3 · Y la puerta para rotar
-- ---------------------------------------------------------------------------
-- El recifrado en lote (AP9) es lo único que necesita leer los secretos de todos
-- los workspaces a la vez, y por definición corre sin ninguna persona detrás.
-- No se le concede al rol de la aplicación: se ejecuta con el rol de
-- migraciones, que es quien tiene el privilegio de mantenimiento. Declararlo
-- aquí deja constancia de que es una vía distinta y deliberada, en vez de
-- ampliar la de arriba «solo un poco».
COMMENT ON FUNCTION ai_credential_secret(uuid, ai_provider) IS
  'Única lectura del secreto para el rol de la aplicación: exige miembro del workspace y proveedor activo (AP3, T-27).';
