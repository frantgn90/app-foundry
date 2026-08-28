-- Cimientos del aislamiento de App Foundry (TRD §6.1, RNF-103, RD-6).
--
-- El invariante que sostiene todo el producto es que nadie vea lo que no le
-- corresponde. Aquí se establece en la propia base de datos, para que un olvido
-- en una consulta no se convierta en una fuga de datos.

-- ---------------------------------------------------------------------------
-- Rol de la aplicación
-- ---------------------------------------------------------------------------
-- La aplicación se conecta con este rol; las migraciones, con otro. NOBYPASSRLS
-- es la línea que separa "las políticas se aplican" de "las políticas decoran".
-- Se crea sin contraseña a propósito: el secreto se fija fuera (en el arranque
-- local o por infraestructura), nunca en una migración versionada.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE app_user WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;--> statement-breakpoint

-- Las tablas que creen futuras migraciones heredan estos permisos: un olvido
-- aquí se manifestaría como un "permission denied" evidente, no como un agujero.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Identidad de la petición
-- ---------------------------------------------------------------------------
-- La API fija `app.user_id` al abrir la transacción, con set_config(..., true),
-- que es *local a la transacción*: al terminar desaparece, de modo que una
-- conexión reutilizada del pool nunca arrastra la identidad de otro usuario.
--
-- Devuelve NULL si no hay contexto, y todas las políticas comparan contra él:
-- sin contexto, ninguna fila casa. El caso por defecto es no ver nada.
CREATE OR REPLACE FUNCTION current_app_user() RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION current_app_user() TO app_user;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
-- FORCE, además de ENABLE, para que las políticas se apliquen también al dueño
-- de la tabla. Sin FORCE, cualquier consulta hecha con el rol propietario las
-- ignoraría en silencio.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- En H0 un usuario solo se ve a sí mismo. En H1, cuando existan los workspaces,
-- esta política se ampliará a "quienes comparten workspace conmigo", que es lo
-- que necesitan las menciones y la autoría (RF-815).
CREATE POLICY users_self_select ON users
  FOR SELECT
  USING (id = current_app_user());
--> statement-breakpoint

CREATE POLICY users_self_update ON users
  FOR UPDATE
  USING (id = current_app_user())
  WITH CHECK (id = current_app_user());
--> statement-breakpoint

-- Una sesión es de quien es. WITH CHECK evita además que alguien cree o mueva
-- una sesión a nombre de otro: sin él, la política filtraría lecturas pero
-- dejaría pasar escrituras.
CREATE POLICY sessions_own ON sessions
  FOR ALL
  USING (user_id = current_app_user())
  WITH CHECK (user_id = current_app_user());
