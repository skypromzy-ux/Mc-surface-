// Server-side only. This runs on Vercel, never in the browser, so the
// Resend key here is never shipped to visitors. Set RESEND_API_KEY in
// Vercel's Project Settings -> Environment Variables (not in this file).

const FROM = "tickets@mcsurface.com";
const ORG = "Lordsurface001@gmail.com";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { buyer, order, ref } = req.body || {};
  if (!buyer || !buyer.email || !buyer.name || !Array.isArray(order) || !ref) {
    return res.status(400).json({ error: "Missing buyer, order, or ref" });
  }

  const RK = process.env.RESEND_API_KEY;
  if (!RK) {
    console.error("RESEND_API_KEY is not set in Vercel environment variables");
    return res.status(500).json({ error: "Email service not configured" });
  }

  const total = order.reduce((s, i) => s + i.price * i.qty, 0);
  const rows = order.map(i => `<tr><td style="padding:8px 12px;border-bottom:1px solid #EAE2D2;">${i.name}</td><td style="padding:8px 12px;border-bottom:1px solid #EAE2D2;text-align:center;">${i.qty}</td><td style="padding:8px 12px;border-bottom:1px solid #EAE2D2;text-align:right;">₦${(i.price*i.qty).toLocaleString()}</td></tr>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;"><div style="background:#171310;padding:32px;text-align:center;border-bottom:4px solid #D4A017;"><h1 style="margin:0;font-size:28px;color:#fff;">MC SURFACE</h1><p style="color:#D4A017;font-weight:700;margin:4px 0;">COMEDY JUNCTION</p></div><div style="padding:32px;"><h2>Hey ${buyer.name}, you're in!</h2><p style="color:#4A4038;">Your tickets are confirmed. Present this email at the entrance.</p><div style="background:#fff8f0;border:2px solid #D4A017;border-radius:8px;padding:16px;margin:20px 0;"><p style="margin:0 0 4px;font-size:12px;color:#8C7A5C;">TICKET REFERENCE</p><p style="margin:0;font-size:18px;font-weight:700;">${ref}</p></div><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#171310;color:#fff;"><th style="padding:10px 12px;text-align:left;">Package</th><th style="padding:10px 12px;">Qty</th><th style="padding:10px 12px;text-align:right;">Subtotal</th></tr></thead><tbody>${rows}</tbody></table><div style="text-align:right;font-size:18px;font-weight:700;margin-top:12px;">Total: ₦${total.toLocaleString()}</div></div><div style="background:#171310;padding:16px;text-align:center;"><p style="color:#D4A017;margin:0;font-size:12px;">Surface Concept Entertainment</p></div></div>`;

  const h = { "Content-Type": "application/json", "Authorization": "Bearer " + RK };

  try {
    await fetch("https://api.resend.com/emails", { method: "POST", headers: h, body: JSON.stringify({ from: FROM, to: buyer.email, subject: "Your MC Surface Comedy Junction tickets are confirmed!", html }) });
    await fetch("https://api.resend.com/emails", { method: "POST", headers: h, body: JSON.stringify({ from: FROM, to: ORG, subject: "New order from " + buyer.name + " - " + ref, html }) });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to send email" });
  }
}
