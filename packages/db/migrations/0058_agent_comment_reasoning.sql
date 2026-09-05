-- Lo que el modelo se dijo a sí mismo antes de contestar (RF-1403, RD-9).
--
-- Aparte del cuerpo, que es lo que impide que acabe dentro del comentario, y
-- guardado, que es lo que permite enseñarlo plegado. Es la misma decisión que
-- se tomó con el asistente en H10: quien lee la conversación no quiere leer la
-- deliberación, y quien duda de una respuesta concreta no tiene otro sitio
-- donde mirarla.
--
-- Solo lo llenan los modelos que piensan en voz alta. Nulo no significa que no
-- se sepa: significa que ese modelo no enseña su razonamiento.

ALTER TABLE "comments" ADD COLUMN "ai_reasoning" text;