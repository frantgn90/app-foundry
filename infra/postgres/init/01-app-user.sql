-- Rol de la aplicación para desarrollo local.
--
-- La migración 0001 crea este mismo rol y le fija los atributos de seguridad
-- (NOSUPERUSER, NOBYPASSRLS), pero deliberadamente sin contraseña: un secreto
-- no se versiona. Aquí se le pone una, válida solo en local; en producción la
-- fija la infraestructura.
--
-- Este script solo se ejecuta al inicializar un volumen vacío.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user WITH LOGIN PASSWORD 'app_local_dev'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE app_user WITH PASSWORD 'app_local_dev';
  END IF;
END
$$;
