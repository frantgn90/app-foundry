-- Emails y nombres de usuario comparan sin distinguir mayúsculas.
--
-- `Ana@Example.com` y `ana@example.com` son la misma persona, y `FranTgn90` el
-- mismo handle de GitHub. Guardarlo todo en minúsculas también compararía bien,
-- pero perdería la forma en que cada uno escribe su nombre, que es lo que se
-- muestra en la interfaz.
--
-- Va antes que las tablas de workspaces porque ellas ya usan este tipo.
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint

ALTER TABLE users ALTER COLUMN handle TYPE citext;--> statement-breakpoint
ALTER TABLE users ALTER COLUMN email TYPE citext;
