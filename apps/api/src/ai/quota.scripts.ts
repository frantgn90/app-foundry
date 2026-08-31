/**
 * Los guiones Lua del cupo (T-30, TRD v2 §9.2).
 *
 * Van en Lua y no en varias órdenes seguidas porque **la comprobación y la
 * reserva tienen que ser un solo acto**: entre leer «cabe» y apuntar «reservo»,
 * otras cuatro invocaciones de la misma revisión pueden haber leído lo mismo, y
 * las cinco se aprobarían para un hueco que solo daba para una.
 *
 * Tres claves por cupo: el contador (`spent`, `reserved`), el registro de
 * reservas vivas con su importe, y sus vencimientos ordenados. Las tres caducan
 * juntas, así que un mes viejo desaparece solo.
 */

/**
 * Reserva el techo estimado si cabe, sembrando y barriendo antes.
 *
 * KEYS: contador, reservas, vencimientos.
 * ARGV: estimado, cupo (-1 sin cupo), id de reserva, vencimiento, ttl, siembra
 *       (vacío si el contador ya existe), y el instante actual —que no es el
 *       vencimiento, y confundirlos barre todas las reservas vivas—.
 * Devuelve: [concedida, gastado, reservado, cupo].
 */
export const RESERVAR = `
-- La siembra va aquí dentro, y no en una orden aparte, para que sembrar y
-- reservar sean el mismo acto. Con dos órdenes, una reserva que llegara entre
-- ambas crearía la clave y la siembra ya no encontraría hueco: el gasto del mes
-- anterior a un reinicio de Redis desaparecería sin que nadie lo notara.
if ARGV[6] ~= '' then
  redis.call('HSETNX', KEYS[1], 'spent', ARGV[6])
end

-- Barrido de reservas abandonadas, aquí y no en un trabajo aparte: la siguiente
-- reserva es exactamente cuando importa que el hueco esté libre. Un proceso que
-- muera entre reservar y liquidar dejaría cupo comido hasta fin de mes; así lo
-- suelta el primero que vuelva a pasar por aquí.
local vencidas = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', ARGV[7])
for _, vencida in ipairs(vencidas) do
  local abandonado = redis.call('HGET', KEYS[2], vencida)
  if abandonado then
    redis.call('HINCRBY', KEYS[1], 'reserved', -tonumber(abandonado))
    redis.call('HDEL', KEYS[2], vencida)
  end
  redis.call('ZREM', KEYS[3], vencida)
end

local spent = tonumber(redis.call('HGET', KEYS[1], 'spent') or '0')
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0')
local estimate = tonumber(ARGV[1])
local quota = tonumber(ARGV[2])

if quota >= 0 and (spent + reserved + estimate) > quota then
  return {0, spent, reserved, quota}
end

redis.call('HINCRBY', KEYS[1], 'reserved', estimate)
redis.call('HSET', KEYS[2], ARGV[3], estimate)
redis.call('ZADD', KEYS[3], ARGV[4], ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[5])
redis.call('EXPIRE', KEYS[2], ARGV[5])
redis.call('EXPIRE', KEYS[3], ARGV[5])

return {1, spent, reserved, quota}
`;

/**
 * Convierte una reserva en gasto real.
 *
 * Es idempotente por construcción: si la reserva ya no está —porque se liquidó
 * o porque venció—, no hace nada y lo dice. Sin eso, un reintento restaría dos
 * veces del reservado y el contador se iría a números imposibles.
 *
 * KEYS: contador, reservas, vencimientos.
 * ARGV: id de reserva, tokens realmente consumidos.
 * Devuelve: 1 si liquidó, 0 si no había nada que liquidar.
 */
export const LIQUIDAR = `
local amount = redis.call('HGET', KEYS[2], ARGV[1])
if not amount then
  return 0
end

redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('HINCRBY', KEYS[1], 'reserved', -tonumber(amount))
redis.call('HINCRBY', KEYS[1], 'spent', tonumber(ARGV[2]))

return 1
`;
