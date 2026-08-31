-- Aviso al dueño cuando un modelo asignado desaparece del catálogo (RF-1009).
--
-- La alternativa era no avisar y que la función fallara la próxima vez que
-- alguien la usara, cuando ya nadie relaciona el fallo con un modelo que el
-- proveedor retiró hace semanas.

ALTER TYPE "public"."notification_type" ADD VALUE 'AI_MODEL_UNAVAILABLE';