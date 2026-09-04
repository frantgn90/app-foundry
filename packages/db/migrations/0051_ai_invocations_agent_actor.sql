-- Qué agente provocó la invocación (RD-10, RF-1201).
--
-- No sustituye a `actor_user_id`: los dos van juntos en una respuesta de
-- agente. Detrás de ella hay siempre una persona que la desencadenó —quien
-- mencionó, quien pidió la revisión— y es a quien se le imputa el consumo. El
-- agente dice qué perfil gastó; la persona, a cuenta de quién.
--
-- Se pone a nulo si el agente desaparece, igual que con las personas: lo
-- gastado ya se gastó, y borrar la fila descuadraría el mes.

ALTER TABLE "ai_invocations" ADD COLUMN "actor_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;