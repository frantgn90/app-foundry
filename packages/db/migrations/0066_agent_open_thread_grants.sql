-- Lo que le faltaba al dueño de la puerta para poder abrir un hilo.
--
-- `agent_writer` es el rol dueño de las funciones estrechas, y hasta ahora solo
-- necesitaba insertar comentarios: tenía `INSERT` sobre `comments` y `SELECT`
-- sobre lo que comprueba. Abrir un hilo necesita tres cosas más, y sin ellas la
-- función existía pero fallaba en la primera consulta.
--
-- `SECURITY DEFINER` no regala permisos de tabla: hace que la función corra con
-- los del dueño, que son exactamente estos. Es lo que mantiene la puerta
-- estrecha —el rol no puede hacer nada que no se le haya concedido— y también
-- lo que obliga a concederle cada cosa a mano.

GRANT INSERT ON comment_threads TO agent_writer;--> statement-breakpoint
GRANT SELECT ON documents, agent_reviews TO agent_writer;
