// api/verify-and-send.js
//
// Written as a Vercel-style serverless function (default export, req/res),
// since that's the most common lightweight backend to pair with a static
// React site like this one. If you're hosting on Netlify, a plain Node/
// Express server, or Cloudflare Workers instead, the verification + email
// logic below is identical — only the function signature at the top and
// the res.status(...).json(...) calls need to change shape. Say the word
// and I'll adapt it to whichever you're using.
//
// REQUIRED — set these as environment variables in your hosting dashboard.
// Never put either of these in the frontend/React code:
//
//   PAYSTACK_SECRET_KEY   Paystack dashboard → Settings → API Keys ("sk_...")
//   RESEND_API_KEY        The key that used to be hardcoded in the frontend.
//                          Rotate it in the Resend dashboard first — treat
//                          the old one as compromised — then put the NEW
//                          key here, not the old one.

const FROM = "tickets@mcsurface.com";
const ORG_EMAIL = "Lordsurface001@gmail.com";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { reference, buyer, order } = req.body || {};
  if (!reference || !buyer?.email || !buyer?.name || !Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: "Missing reference, buyer, or order" });
  }

  // 1. Confirm the charge actually happened — don't trust the client.
  let verify;
  try {
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    verify = await verifyRes.json();
  } catch (e) {
    console.error("Paystack verify request failed:", e);
    return res.status(502).json({ error: "Could not reach Paystack to verify payment" });
  }

  if (!verify?.status || verify.data?.status !== "success") {
    return res.status(402).json({ error: "Payment not verified" });
  }

  // 2. Make sure what was actually paid matches the order — otherwise
  //    someone could pay for a Regular ticket and claim a Premium Table.
  const expectedKobo = order.reduce((s, i) => s + i.price * i.qty, 0) * 100;
  if (verify.data.amount !== expectedKobo) {
    console.error(`Amount mismatch for ${reference}: paid ${verify.data.amount}, expected ${expectedKobo}`);
    return res.status(402).json({ error: "Paid amount does not match order" });
  }

  // 3. Only now, build and send the confirmation emails.
  //    (Same HTML template as the original frontend version.)
  const total = order.reduce((s, i) => s + i.price * i.qty, 0);
  const rows = order
    .map(
      (i) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;">${i.name}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${i.qty}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">\u20a6${(i.price * i.qty).toLocaleString()}</td></tr>`
    )
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;"><div style="background:#1a1a1a;padding:32px;text-align:center;border-bottom:4px solid #D4A017;"><h1 style="margin:0;font-size:28px;color:#fff;">MC SURFACE</h1><p style="color:#D4A017;font-weight:700;margin:4px 0;">COMEDY JUNCTION</p></div><div style="padding:32px;"><h2>Hey ${buyer.name}, you're in!</h2><p style="color:#555;">Your tickets are confirmed. Present this email at the entrance.</p><div style="background:#fff8f0;border:2px solid #D4A017;border-radius:8px;padding:16px;margin:20px 0;"><p style="margin:0 0 4px;font-size:12px;color:#888;">TICKET REFERENCE</p><p style="margin:0;font-size:18px;font-weight:700;">${reference}</p></div><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#1a1a1a;color:#fff;"><th style="padding:10px 12px;text-align:left;">Package</th><th style="padding:10px 12px;">Qty</th><th style="padding:10px 12px;text-align:right;">Subtotal</th></tr></thead><tbody>${rows}</tbody></table><div style="text-align:right;font-size:18px;font-weight:700;margin-top:12px;">Total: \u20a6${total.toLocaleString()}</div></div><div style="background:#1a1a1a;padding:16px;text-align:center;"><p style="color:#D4A017;margin:0;font-size:12px;">Surface Concept Entertainment</p></div></div>`;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
  };

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: FROM,
        to: buyer.email,
        subject: "Your MC Surface Comedy Junction tickets are confirmed!",
        html,
      }),
    });
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: FROM,
        to: ORG_EMAIL,
        subject: `New order from ${buyer.name} - ${reference}`,
        html,
      }),
    });
  } catch (e) {
    // Payment is already verified at this point — don't fail the request
    // over an email hiccup. Log it so it can be followed up manually.
    console.error("Resend send failed for", reference, e);
  }

  return res.status(200).json({ ok: true });
}
