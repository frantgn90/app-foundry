-- La revisión en abanico: qué se guarda de ella (RF-1606..1610, T-33).
--
-- Dos tablas y dos columnas nuevas en tablas que ya estaban:
--
--  * `agent_reviews` es la revisión: sobre qué versión, quién la pidió y el
--    techo de tokens que se le enseñó antes de confirmarla (RF-1207).
--  * `agent_review_runs` es lo que le toca a **cada agente**, que es la unidad
--    del reintento, de la idempotencia, de la cancelación y del progreso.
--  * `comment_threads.review_id` dice qué hilos salieron de una revisión.
--  * `ai_invocations.review_run_id` permite contestar «cuánto costó la revisión
--    del martes» sin cruzar por tiempo, que es como se cuentan mal las cosas
--    que corren en paralelo.
--
-- Lo importante de aquí es `agent_reviews_one_live`: el único **parcial** que
-- hace imposible una segunda revisión de la misma app mientras haya una viva
-- (RF-1609). No se comprueba en el servicio a propósito —un `SELECT` previo
-- deja una carrera de milisegundos entre mirar y escribir, y perderla cuesta
-- pagar dos revisiones enteras del mismo documento.

CREATE TYPE "public"."review_status" AS ENUM('QUEUED', 'RUNNING', 'DONE', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TABLE "agent_review_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"review_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" "review_status" DEFAULT 'QUEUED' NOT NULL,
	"threads_written" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"status" "review_status" DEFAULT 'QUEUED' NOT NULL,
	"estimated_tokens" bigint NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_threads" ADD COLUMN "review_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "review_run_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_review_runs" ADD CONSTRAINT "agent_review_runs_review_id_agent_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."agent_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_review_runs" ADD CONSTRAINT "agent_review_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reviews" ADD CONSTRAINT "agent_reviews_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reviews" ADD CONSTRAINT "agent_reviews_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reviews" ADD CONSTRAINT "agent_reviews_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_review_runs_key" ON "agent_review_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_review_runs_agent" ON "agent_review_runs" USING btree ("review_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_reviews_one_live" ON "agent_reviews" USING btree ("app_id") WHERE status IN ('QUEUED', 'RUNNING');--> statement-breakpoint
CREATE INDEX "agent_reviews_app_idx" ON "agent_reviews" USING btree ("app_id","created_at");--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_review_id_agent_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."agent_reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_review_run_id_agent_review_runs_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."agent_review_runs"("id") ON DELETE set null ON UPDATE no action;