-- Retirado implica callado (RF-1508, RF-1509).
--
-- Las dos columnas llegaron con la tabla en 0046, porque una columna no puede
-- preceder a su tabla. Lo que faltaba es la relación entre ellas, que no es
-- evidente: `active` es reversible y `removed_at` es terminal, así que un
-- agente retirado y a la vez «activo» es un estado que no significa nada.
--
-- Importa que lo sostenga el motor y no la aplicación porque de `active` va a
-- colgar el disparo: quien decida si un agente interviene consultará esa
-- columna, y un retirado que se quedara con `active = true` por un update a
-- medias seguiría contestando en una app de la que ya se le sacó.
--
-- Retirar es, por tanto, un solo movimiento: fecha y bandera a la vez.

ALTER TABLE "agents" ADD CONSTRAINT "agents_retired_is_inactive_check"
  CHECK ("removed_at" IS NULL OR NOT "active");
