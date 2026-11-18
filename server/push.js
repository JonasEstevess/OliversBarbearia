import webpush from 'web-push';
import { all, run, getSetting, setSetting } from './db.js';
import { shop } from './catalog.js';

// Chaves VAPID geradas automaticamente na primeira vez e guardadas no banco:
// não há nada para configurar manualmente.
let keysPromise;
export function vapidKeys() {
  keysPromise ||= (async () => {
    let pub = await getSetting('vapid_public');
    let priv = await getSetting('vapid_private');
    if (!pub || !priv) {
      const k = webpush.generateVAPIDKeys();
      await setSetting('vapid_public', k.publicKey);
      await setSetting('vapid_private', k.privateKey);
      pub = k.publicKey;
      priv = k.privateKey;
    }
    webpush.setVapidDetails(`https://wa.me/${shop.whatsapp}`, pub, priv);
    return { publicKey: pub };
  })().catch((err) => {
    keysPromise = null;
    throw err;
  });
  return keysPromise;
}

export async function saveSubscription(userId, sub) {
  const endpoint = String(sub?.endpoint || '');
  const { p256dh, auth } = sub?.keys || {};
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) throw Object.assign(new Error('Inscrição inválida.'), { status: 400 });
  await run(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    [endpoint, userId, String(p256dh), String(auth)]
  );
}

export const removeSubscription = (endpoint) => run('DELETE FROM push_subscriptions WHERE endpoint = ?', [String(endpoint || '')]);

async function sendTo(subs, payload) {
  if (!subs.length) return 0;
  await vapidKeys();
  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 60 * 60 * 12 }))
  );
  let sent = 0;
  await Promise.all(
    results.map(async (r, i) => {
      if (r.status === 'fulfilled') return sent++;
      // Aparelho desinstalou o app ou revogou a permissão: remove a inscrição.
      if ([404, 410].includes(r.reason?.statusCode)) await removeSubscription(subs[i].endpoint);
      else console.error('push falhou', r.reason?.statusCode, r.reason?.body || r.reason?.message);
    })
  );
  return sent;
}

// Nunca deixa uma falha de notificação quebrar o agendamento.
const safe = (fn) => fn().catch((err) => { console.error('notificação', err); return 0; });

export const notifyAdmins = (payload) =>
  safe(async () => sendTo(await all("SELECT s.* FROM push_subscriptions s JOIN users u ON u.id = s.user_id WHERE u.role = 'admin'"), payload));

export const notifyUser = (userId, payload) =>
  safe(async () => sendTo(await all('SELECT * FROM push_subscriptions WHERE user_id = ?', [userId]), payload));
