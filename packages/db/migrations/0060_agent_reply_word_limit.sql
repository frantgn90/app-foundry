-- Cuánto puede escribir un agente en una respuesta.
--
-- Cero es **sin límite**, y es lo que viene de fábrica: casi siempre lo que se
-- quiere es que conteste lo que tenga que contestar. Se pone un número cuando
-- un perfil concreto se va por las ramas, que es una decisión sobre ese agente
-- y no sobre todos.
--
-- En la plantilla y en la instancia, como el resto de sus campos: la plantilla
-- lo propone al instanciar y a partir de ahí cada agente lleva el suyo.
--
-- No sustituye al techo de tokens, que es otra cosa: aquel es la salvaguarda
-- del sistema —lo que impide que una generación se dispare— y este es una
-- preferencia de estilo que se le pide al modelo en el prompt.

ALTER TABLE "agent_templates" ADD COLUMN "reply_word_limit" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "reply_word_limit" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Ni negativo ni absurdo. El tope de arriba es generoso a propósito: lo que se
-- quiere evitar es un número escrito por error, no acotar hasta dónde puede
-- llegar quien de verdad quiera respuestas largas.
ALTER TABLE "agent_templates" ADD CONSTRAINT "agent_templates_word_limit_check"
  CHECK ("reply_word_limit" >= 0 AND "reply_word_limit" <= 5000);--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_word_limit_check"
  CHECK ("reply_word_limit" >= 0 AND "reply_word_limit" <= 5000);
