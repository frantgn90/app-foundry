-- El prompt de un agente, versión a versión (RF-1510).
--
-- El vigente es el de número más alto. No vive en `agents` porque cada
-- comentario apuntará a **la revisión concreta** con la que se escribió:
-- ajustar la personalidad después no debe reescribir la historia de por qué el
-- agente dijo lo que dijo.
--
-- Se guardará el puntero y no una copia del texto en cada comentario: duplicar
-- kilobytes por línea escrita sería tirar el espacio, y la pregunta que hay que
-- poder contestar se contesta igual de bien desde aquí.

CREATE TABLE "agent_prompt_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agent_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"prompt" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_prompt_revisions_agent_revision_key" UNIQUE("agent_id","revision")
);
--> statement-breakpoint
ALTER TABLE "agent_prompt_revisions" ADD CONSTRAINT "agent_prompt_revisions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_prompt_revisions" ADD CONSTRAINT "agent_prompt_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "agent_prompt_revisions" ADD CONSTRAINT "agent_prompt_revisions_positive_check"
  CHECK ("revision" > 0);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Solo se añade
-- ---------------------------------------------------------------------------
-- Que la historia no se reescriba no puede depender de que nadie escriba un
-- UPDATE por descuido: si una revisión se pudiera editar, guardar el puntero en
-- vez de una copia dejaría de ser equivalente y RF-1510 se caería sin ruido.
-- Ajustar la personalidad es **añadir** una revisión, nunca cambiar la que hay.
REVOKE UPDATE, DELETE ON agent_prompt_revisions FROM app_user;
