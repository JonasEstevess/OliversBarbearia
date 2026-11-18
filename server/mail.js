import nodemailer from 'nodemailer';
import { shop } from './catalog.js';

// Envio de e-mail por SMTP. Sem domínio próprio, use um Gmail da barbearia com "senha de app":
//   SMTP_USER=oliversbarbearia@gmail.com  SMTP_PASS=<senha de app de 16 letras>
// SMTP_HOST/SMTP_PORT são opcionais (padrão: Gmail). MAIL_DEBUG=1 só imprime o e-mail no log (testes).
let transport;
function getTransport() {
  if (transport !== undefined) return transport;
  if (process.env.MAIL_DEBUG) transport = nodemailer.createTransport({ jsonTransport: true });
  else if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = Number(process.env.SMTP_PORT) || 465;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  } else transport = null;
  return transport;
}

export const mailEnabled = () => !!getTransport();

const fromAddress = () => `"${shop.name}" <${process.env.EMAIL_FROM || process.env.SMTP_USER || 'no-reply@example.com'}>`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function sendPasswordResetEmail({ to, name, url, minutes }) {
  const t = getTransport();
  if (!t) throw new Error('E-mail não configurado.');
  const first = escapeHtml(String(name || '').split(' ')[0] || 'cliente');
  const html = `<!doctype html><html><body style="margin:0;background:#0b0a08;font-family:Arial,Helvetica,sans-serif;color:#f3ebdd">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0a08;padding:32px 16px"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#13110d;border:1px solid #2a261e;border-radius:20px;padding:32px">
      <tr><td style="font-size:12px;letter-spacing:3px;color:#d4a94c;text-transform:uppercase;font-weight:bold">${escapeHtml(shop.name)}</td></tr>
      <tr><td style="font-size:28px;font-weight:bold;padding:14px 0 8px">Olá, ${first}!</td></tr>
      <tr><td style="font-size:15px;line-height:1.6;color:#c9c0b0">Recebemos um pedido para criar uma nova senha na sua conta. Toque no botão abaixo — o link vale por <b style="color:#f3ebdd">${minutes} minutos</b> e só pode ser usado uma vez.</td></tr>
      <tr><td style="padding:26px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#d4a94c;color:#1a1305;text-decoration:none;font-weight:bold;padding:15px 28px;border-radius:999px;font-size:15px">Criar nova senha</a></td></tr>
      <tr><td style="font-size:13px;line-height:1.6;color:#9b9284">Se o botão não funcionar, copie este endereço no navegador:<br><span style="color:#f2d48b;word-break:break-all">${escapeHtml(url)}</span></td></tr>
      <tr><td style="font-size:13px;line-height:1.6;color:#9b9284;padding-top:20px;border-top:1px solid #2a261e">Não foi você? Pode ignorar este e-mail: sua senha continua a mesma.<br>${escapeHtml(shop.address)}</td></tr>
    </table>
  </td></tr></table></body></html>`;
  const text = `Olá, ${String(name || '').split(' ')[0]}!\n\nPara criar uma nova senha na sua conta da ${shop.name}, acesse:\n${url}\n\nO link vale por ${minutes} minutos e só pode ser usado uma vez.\nNão foi você? Ignore este e-mail.`;
  const info = await t.sendMail({ from: fromAddress(), to, subject: `Crie sua nova senha — ${shop.name}`, html, text });
  if (process.env.MAIL_DEBUG) console.log('[MAIL_DEBUG]', JSON.stringify({ to, url }));
  return info;
}
