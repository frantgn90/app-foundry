-- Los totales del mes, para conciliar el contador (AR5, TRD v2 §9.3).
--
-- El contador de Redis puede quedarse corto: si un proceso muere entre llamar al
-- modelo y liquidar, el gasto queda en la tabla y no en el contador. Nadie lo
-- nota —el cupo simplemente rinde de más— hasta que alguien cuadra el mes.
--
-- Va en SECURITY DEFINER por lo mismo que la de refrescar el catálogo: el
-- proceso que concilia no tiene identidad con la que ver las invocaciones de
-- todos. Devuelve totales agregados, nunca filas: de aquí no se saca quién hizo
-- qué, solo cuánto suma cada workspace y proveedor.
CREATE OR REPLACE FUNCTION ai_quota_month_totals(month_start timestamptz)
RETURNS TABLE (workspace_id uuid, provider ai_provider, tokens bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.workspace_id, i.provider, sum(i.input_tokens + i.output_tokens)::bigint
  FROM ai_invocations i
  WHERE i.created_at >= month_start
  GROUP BY i.workspace_id, i.provider;
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION ai_quota_month_totals(timestamptz) TO app_user;
