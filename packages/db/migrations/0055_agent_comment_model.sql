-- Con qué se generó un comentario de agente (RF-1704).
--
-- Aquí y no deducido del registro de invocaciones, por dos motivos. Uno, que
-- una invocación no apunta a ningún comentario: emparejarlos por fecha y agente
-- sería adivinar. Dos, que el modelo asignado a una tarea cambia, así que
-- preguntar hoy por lo que se usó ayer daría la respuesta de hoy.
--
-- Nulos en los comentarios de persona, que no se generaron con nada.

ALTER TABLE "comments" ADD COLUMN "ai_provider" "ai_provider";--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "ai_model_id" text;--> statement-breakpoint

-- Los dos van juntos, y solo con autoría de agente: un modelo sin proveedor no
-- dice cuál, y cualquiera de los dos en un comentario de persona no significa
-- nada. Se añade NOT VALID y se valida aparte para no bloquear la tabla.
ALTER TABLE "comments" ADD CONSTRAINT "comments_ai_model_check"
  CHECK (
    num_nonnulls("ai_provider", "ai_model_id") <> 1
    AND ("ai_provider" IS NULL OR "author_agent_id" IS NOT NULL)
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "comments" VALIDATE CONSTRAINT "comments_ai_model_check";
