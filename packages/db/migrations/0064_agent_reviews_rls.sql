-- Aislamiento de la revisión en abanico (RNF-603, RNF-904, RD-6).
--
-- Tres reglas, y la primera es la que se sale de lo habitual:
--
--  * **Pedirla basta con poder leer la app** (RF-1608, D-12). En las demás
--    tablas de agentes escribir exige poder editar; aquí no, y es deliberado:
--    pedir que te lean no es cambiar nada de la app, y quien solo puede leer es
--    justamente quien más necesita una segunda lectura.
--  * **Verla es ver la app**, como todo lo que cuelga de ella.
--  * **Moverla la mueve quien la pidió**, o el precursor de la app. El worker
--    escribe con la identidad de quien la pidió —igual que al contestar una
--    mención—, así que sus cambios de estado entran por esa misma puerta sin
--    necesidad de una excepción para él.
--
-- No hay política de borrado en ninguna de las dos. Cancelar es cambiar de
-- estado, no borrar: una revisión cancelada tiene que seguir explicando los
-- comentarios que llegó a dejar (RF-1610).

ALTER TABLE agent_reviews ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agent_reviews FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agent_review_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agent_review_runs FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- BH5 · La revisión
-- ---------------------------------------------------------------------------
-- Verla es ver la app: de eso ya se encarga la política de `apps`, así que si
-- la app es privada y no eres su precursor, aquí no aparece nada.
CREATE POLICY agent_reviews_visible ON agent_reviews
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM apps a WHERE a.id = agent_reviews.app_id));
--> statement-breakpoint

-- Pedirla: cualquiera que vea la app y a su cuenta (RF-1608). Una app
-- archivada no admite gasto nuevo, como no admite ningún otro cambio (RF-409).
CREATE POLICY agent_reviews_request ON agent_reviews
  FOR INSERT
  WITH CHECK (
    requested_by = current_app_user()
    AND EXISTS (
      SELECT 1 FROM apps a
      WHERE a.id = agent_reviews.app_id AND a.archived_at IS NULL
    )
  );
--> statement-breakpoint

-- Moverla —arrancarla, cerrarla, cancelarla— quien la pidió o el precursor de
-- la app (RF-1610).
CREATE POLICY agent_reviews_move ON agent_reviews
  FOR UPDATE
  USING (
    requested_by = current_app_user()
    OR EXISTS (
      SELECT 1 FROM apps a
      WHERE a.id = agent_reviews.app_id AND a.precursor_id = current_app_user()
    )
  )
  WITH CHECK (
    requested_by = current_app_user()
    OR EXISTS (
      SELECT 1 FROM apps a
      WHERE a.id = agent_reviews.app_id AND a.precursor_id = current_app_user()
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- BH5 · Lo que le toca a cada agente
-- ---------------------------------------------------------------------------
-- Una ejecución se ve si se ve su revisión. Es lo que hace posible enseñar el
-- progreso —«3 de 5»— a quien esté mirando la app (RF-1609).
CREATE POLICY agent_review_runs_visible ON agent_review_runs
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM agent_reviews r WHERE r.id = agent_review_runs.review_id));
--> statement-breakpoint

-- Y se crea y se mueve con la misma mano que su revisión, sin repetir aquí el
-- predicado: si la revisión no es tuya, la subconsulta no la encuentra.
CREATE POLICY agent_review_runs_write ON agent_review_runs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agent_reviews r
      JOIN apps a ON a.id = r.app_id
      WHERE r.id = agent_review_runs.review_id
        AND (r.requested_by = current_app_user() OR a.precursor_id = current_app_user())
    )
  );
--> statement-breakpoint

CREATE POLICY agent_review_runs_move ON agent_review_runs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM agent_reviews r
      JOIN apps a ON a.id = r.app_id
      WHERE r.id = agent_review_runs.review_id
        AND (r.requested_by = current_app_user() OR a.precursor_id = current_app_user())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agent_reviews r
      JOIN apps a ON a.id = r.app_id
      WHERE r.id = agent_review_runs.review_id
        AND (r.requested_by = current_app_user() OR a.precursor_id = current_app_user())
    )
  );--> statement-breakpoint

COMMENT ON TABLE agent_reviews IS
  'Una lectura del documento por todos los agentes activos de la app (RF-1606). La pide quien pueda leerla y no se solapa con otra: lo garantiza el único parcial agent_reviews_one_live (RF-1609).';--> statement-breakpoint
COMMENT ON TABLE agent_review_runs IS
  'Lo que le toca a cada agente dentro de una revisión: unidad de reintento, idempotencia, cancelación y progreso (T-33).';
