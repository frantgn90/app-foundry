-- Autoría polimórfica: un comentario es de una persona o de un agente (T-34).
--
-- Dos columnas excluyentes y no una tabla de autores intermedia. Así el
-- invariante «exactamente uno» lo garantiza Postgres con un CHECK y las dos
-- claves ajenas siguen siendo obligatorias cada una por su lado; con una tabla
-- intermedia, «este comentario no es de nadie» sería una fila válida.
--
-- Sobre el orden, que es lo único delicado de esta migración: las columnas
-- pasan a admitir nulo **después** de que toda fila existente tenga autor —hoy
-- son NOT NULL, así que ya lo tienen—, y los CHECK se añaden NOT VALID y se
-- validan a continuación, para no bloquear la tabla de comentarios mientras se
-- comprueba. No hay ningún instante en el que un comentario pueda quedarse sin
-- dueño.
--
-- Las claves ajenas a `agents` van sin acción al borrar, y no con RESTRICT como
-- la de personas. Con RESTRICT, borrar una app fallaría a veces y no siempre:
-- la app arrastra en cascada tanto a sus agentes como a sus hilos, y RESTRICT
-- comprueba en el acto, de modo que saltaría si los agentes se borran antes que
-- los comentarios que los citan. Sin acción, la comprobación se difiere al
-- final de la sentencia, cuando ya no queda ninguno. Lo que importa se conserva
-- igual: no se puede borrar a mano un agente que haya escrito (RF-1509).

ALTER TABLE "comment_threads" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD COLUMN "created_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "author_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "agent_prompt_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_agent_prompt_revision_id_agent_prompt_revisions_id_fk" FOREIGN KEY ("agent_prompt_revision_id") REFERENCES "public"."agent_prompt_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_author_agent_idx" ON "comments" USING btree ("author_agent_id","thread_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Exactamente un autor, ni cero ni dos
-- ---------------------------------------------------------------------------
-- Un comentario sin autor no se puede leer —no se sabe a quién se responde— y
-- uno con dos no se puede creer. Lo comprueba el motor porque es la clase de
-- invariante que la aplicación cumple hasta el día en que alguien añade una
-- ruta nueva y se olvida.
ALTER TABLE "comments" ADD CONSTRAINT "comments_single_author_check"
  CHECK (num_nonnulls("author_id", "author_agent_id") = 1) NOT VALID;--> statement-breakpoint
ALTER TABLE "comments" VALIDATE CONSTRAINT "comments_single_author_check";--> statement-breakpoint

-- Y el perfil viaja con el agente: los dos o ninguno. Un comentario de agente
-- sin revisión de prompt dejaría RF-1510 sin respuesta justo donde hace falta,
-- y una revisión colgando de un comentario de persona no significa nada.
ALTER TABLE "comments" ADD CONSTRAINT "comments_agent_prompt_pair_check"
  CHECK (("author_agent_id" IS NULL) = ("agent_prompt_revision_id" IS NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "comments" VALIDATE CONSTRAINT "comments_agent_prompt_pair_check";--> statement-breakpoint

ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_single_author_check"
  CHECK (num_nonnulls("created_by", "created_by_agent_id") = 1) NOT VALID;--> statement-breakpoint
ALTER TABLE "comment_threads" VALIDATE CONSTRAINT "comment_threads_single_author_check";
