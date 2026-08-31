-- Aviso al acercarse al techo de tokens (RF-1205).
--
-- Enterarse al agotarse el cupo es enterarse tarde: para entonces la IA ya se
-- ha apagado y alguien se ha quedado a media revisión.

ALTER TYPE "public"."notification_type" ADD VALUE 'AI_QUOTA_THRESHOLD';