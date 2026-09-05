-- Cuando un agente no puede contestar, se dice (RF-1615).
--
-- Hasta ahora un fallo del proveedor —credencial revocada, modelo retirado, el
-- servicio caído— acababa en el registro del worker y en ningún sitio más.
-- Quien había mencionado al agente veía exactamente lo mismo que si nadie
-- hubiera pedido nada: un hilo donde no pasa nada, sin forma de distinguir «se
-- lo está pensando» de «esto se ha roto». El aviso es lo único que cierra ese
-- hueco, porque el disparo fue suyo y la respuesta llega minutos después.
--
-- Va dirigido a quien lo provocó y a nadie más: el resto del hilo no pidió esa
-- respuesta y un fallo ajeno no es noticia para ellos.
--
-- La política de inserción no hace falta tocarla: desde 0057 un aviso puede
-- tener por destinatario a quien figura como actor de la transacción, que es
-- justo este caso.

ALTER TYPE "public"."notification_type" ADD VALUE 'AI_AGENT_FAILED';
