import { Redis } from 'ioredis';
const r = new Redis(process.env.REDIS_URL);
await r.psubscribe('notif:user:*');
console.log(new Date().toISOString(), 'escuchando notif:user:*');
r.on('pmessage', (_p, canal, mensaje) => {
  console.log(new Date().toISOString(), canal, mensaje);
});
