-- Si puedes ver una versión, puedes ver quién la escribió.
--
-- La política anterior mostraba únicamente a quienes comparten workspace
-- contigo. El efecto no era «no ver a esa persona»: era que **el historial
-- perdía entradas**, porque la consulta une las versiones con sus autores y un
-- autor invisible se lleva su versión por delante. Alguien que dejaba el
-- workspace desaparecía del historial de lo que había escrito, contradiciendo
-- RF-413, que dice justamente que la autoría permanece.
--
-- El EXISTS se apoya en la RLS de `apps`: solo encuentra versiones de apps que
-- quien pregunta ya puede ver, así que esto no abre nada que no estuviera
-- abierto. Lo que hace es dejar de ocultar el nombre de alguien cuyo trabajo sí
-- se está mostrando.
DROP POLICY users_visible ON users;--> statement-breakpoint

CREATE POLICY users_visible ON users
  FOR SELECT
  USING (
    id = current_app_user()
    OR EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.user_id = users.id
        AND m.workspace_id IN (SELECT user_workspaces(current_app_user()))
    )
    OR EXISTS (
      SELECT 1
      FROM document_versions v
      JOIN documents d ON d.id = v.document_id
      JOIN apps a ON a.id = d.app_id
      WHERE v.author_id = users.id
    )
  );
