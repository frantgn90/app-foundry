-- Las apps de quien se marcha pasan al dueño del workspace (RF-413).

-- ---------------------------------------------------------------------------
-- AG1 · Heredar es cosa del sistema, no de una persona
-- ---------------------------------------------------------------------------
-- Una app pertenece siempre al workspace donde nació, así que cuando su
-- precursor deja de ser miembro no puede quedarse sin dueño: el rol pasa al
-- `OWNER`. Hasta ahora no pasaba, y esas apps se quedaban con un precursor que
-- ya no estaba, sin nadie que pudiera cambiarles el nivel de acceso ni
-- transferirlas.
--
-- Va en SECURITY DEFINER porque quien dispara esto puede ser cualquiera de los
-- dos lados: quien se marcha —que sí es el precursor— o quien expulsa, que no lo
-- es y a quien las políticas impedirían tocar una app ajena, con razón. Es una
-- consecuencia del sistema y no una acción de nadie.
--
-- Solo toca el precursor. Ni el nivel de acceso, ni el contenido, ni la autoría
-- de las versiones, que sigue siendo de quien las escribió.
CREATE OR REPLACE FUNCTION workspace_inherit_apps(ws uuid, leaving uuid)
RETURNS TABLE (app_id uuid, app_name text, new_precursor uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  dueno uuid;
BEGIN
  SELECT owner_id INTO dueno FROM workspaces WHERE id = ws;
  IF dueno IS NULL OR dueno = leaving THEN
    -- El dueño no puede marcharse de su propio workspace, así que si llega aquí
    -- no hay nada que heredar ni a quién dárselo.
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE apps a
     SET precursor_id = dueno, updated_at = now()
   WHERE a.workspace_id = ws AND a.precursor_id = leaving
  RETURNING a.id, a.name, dueno;
END;
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION workspace_inherit_apps(uuid, uuid) TO app_user;
