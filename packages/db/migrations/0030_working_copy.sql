-- Guardar deja de crear versión (RF-505, RF-515, RF-516, RF-817).
--
-- `documents.current_content` pasa a ser la copia de trabajo: puede ir por
-- delante de la versión actual, y eso es justamente tener cambios sin
-- commitear. `revision` es lo que detecta ediciones concurrentes, porque la
-- versión actual ya no cambia en cada guardado.

CREATE TABLE "document_version_coauthors" (
	"version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "document_version_coauthors_version_id_user_id_pk" PRIMARY KEY("version_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "document_working_authors" (
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_working_authors_document_id_user_id_pk" PRIMARY KEY("document_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD COLUMN "working_start" integer;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD COLUMN "working_end" integer;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD COLUMN "working_status" "anchor_status";--> statement-breakpoint
ALTER TABLE "document_version_coauthors" ADD CONSTRAINT "document_version_coauthors_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version_coauthors" ADD CONSTRAINT "document_version_coauthors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_working_authors" ADD CONSTRAINT "document_working_authors_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_working_authors" ADD CONSTRAINT "document_working_authors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_version_coauthors_user_idx" ON "document_version_coauthors" USING btree ("user_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AK1 · El mensaje de un commit cabe en una línea
-- ---------------------------------------------------------------------------
-- Cien caracteres (RF-505). Se admite null por las versiones que ya existían y
-- por la inicial, que la pone el sistema.
ALTER TABLE document_versions
  ADD CONSTRAINT document_versions_message_length
  CHECK (message IS NULL OR char_length(message) <= 100);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AL1 · Un hilo inline pertenece a una versión
-- ---------------------------------------------------------------------------
-- La referencia pasa de `SET NULL` a `CASCADE`. Con la restricción de abajo, un
-- `SET NULL` dejaría la fila inválida y abortaría el borrado del documento que
-- lo provocó; en cascada, el hilo se va con la versión, que es lo único que
-- puede llevárselo por delante: las versiones no se borran de otro modo.
ALTER TABLE comment_threads
  DROP CONSTRAINT comment_threads_anchored_version_id_document_versions_id_fk;--> statement-breakpoint

ALTER TABLE comment_threads
  ADD CONSTRAINT comment_threads_anchored_version_id_document_versions_id_fk
  FOREIGN KEY (anchored_version_id) REFERENCES document_versions(id) ON DELETE CASCADE;--> statement-breakpoint

-- Los hilos que ya existían se reanclaban contra el contenido de cada guardado,
-- así que sus posiciones son las de la versión actual, no las de aquella en la
-- que se escribieron. Se las hace pertenecer a la actual, que es donde sus
-- offsets son ciertos; y como la copia de trabajo todavía coincide con ella, la
-- posición de trabajo arranca siendo la misma.
UPDATE comment_threads t
SET anchored_version_id = d.current_version_id,
    working_start = t.anchor_start,
    working_end = t.anchor_end,
    working_status = t.anchor_status
FROM documents d
WHERE d.id = t.document_id
  AND t.kind = 'INLINE';--> statement-breakpoint

ALTER TABLE comment_threads
  ADD CONSTRAINT comment_threads_inline_has_version
  CHECK (kind <> 'INLINE' OR anchored_version_id IS NOT NULL);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AK5 · Quién ha escrito, con y sin commitear
-- ---------------------------------------------------------------------------
ALTER TABLE document_working_authors ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE document_working_authors FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE document_version_coauthors ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE document_version_coauthors FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Quien ve el documento ve quién lo está tocando: es parte de saber que lo que
-- lees puede no ser lo último.
CREATE POLICY document_working_authors_visible ON document_working_authors
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM documents d WHERE d.id = document_working_authors.document_id));--> statement-breakpoint

-- Apuntarse es decir «he guardado yo», así que solo a nombre propio.
CREATE POLICY document_working_authors_insert ON document_working_authors
  FOR INSERT
  WITH CHECK (
    user_id = current_app_user()
    AND EXISTS (
      SELECT 1 FROM documents d
      JOIN apps a ON a.id = d.app_id
      WHERE d.id = document_working_authors.document_id
        AND a.archived_at IS NULL
        AND (a.precursor_id = current_app_user() OR a.access_level = 'WORKSPACE_WRITE')
    )
  );--> statement-breakpoint

-- Borrar sí alcanza a las filas de los demás: commitear y descartar vacían la
-- lista entera, y quien lo hace no tiene por qué ser quien guardó.
CREATE POLICY document_working_authors_delete ON document_working_authors
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM documents d
      JOIN apps a ON a.id = d.app_id
      WHERE d.id = document_working_authors.document_id
        AND a.archived_at IS NULL
        AND (a.precursor_id = current_app_user() OR a.access_level = 'WORKSPACE_WRITE')
    )
  );--> statement-breakpoint

CREATE POLICY document_version_coauthors_visible ON document_version_coauthors
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM document_versions v WHERE v.id = document_version_coauthors.version_id)
  );--> statement-breakpoint

-- Coautor solo puede ser quien de verdad guardó algo desde el commit anterior:
-- se exige que su fila siga en la lista de trabajo, que se vacía justo después.
-- Sin esto, quien commitea podría atribuir la versión a cualquiera.
CREATE POLICY document_version_coauthors_insert ON document_version_coauthors
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM document_versions v
      JOIN documents d ON d.id = v.document_id
      JOIN apps a ON a.id = d.app_id
      JOIN document_working_authors w
        ON w.document_id = d.id AND w.user_id = document_version_coauthors.user_id
      WHERE v.id = document_version_coauthors.version_id
        AND a.archived_at IS NULL
        AND (a.precursor_id = current_app_user() OR a.access_level = 'WORKSPACE_WRITE')
    )
  );--> statement-breakpoint

-- La coautoría es tan inmutable como la versión de la que habla.
REVOKE UPDATE, DELETE ON document_version_coauthors FROM app_user;
