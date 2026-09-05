-- Dónde se pone la conversación de una app (RF-818).
--
-- La columna lateral funciona mientras los comentarios son cortos. En cuanto un
-- agente contesta con varios párrafos, veinte rems de ancho obligan a leer en
-- una tira estrecha al lado de un documento que ocupa el resto. Quien trabaja
-- así prefiere el documento arriba y la conversación debajo, los dos a todo lo
-- ancho.
--
-- Es de la app y no de cada persona a propósito: una app en la que se discute
-- mucho se lee mejor apilada para todo el mundo, y el ajuste vive donde viven
-- los demás de la app. Lo cambia quien puede editarla, como el resto.

CREATE TYPE "public"."comments_layout" AS ENUM('SIDEBAR', 'STACKED');--> statement-breakpoint

ALTER TABLE "apps" ADD COLUMN "comments_layout" "comments_layout"
  DEFAULT 'SIDEBAR' NOT NULL;--> statement-breakpoint

COMMENT ON COLUMN "apps"."comments_layout" IS
  'Dónde va la conversación: al lado del documento o debajo, a todo lo ancho (RF-818).';
