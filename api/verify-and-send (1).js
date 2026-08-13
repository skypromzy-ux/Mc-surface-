const TICKET_CATALOG = {
  regular: {
    name: "Regular",
    price: 5000,
  },
  vip: {
    name: "VIP",
    price: 20000,
  },
  table: {
    name: "Seat on a Table",
    price: 50000,
  },
  gold: {
    name: "Gold Table",
    price: 500000,
  },
  premium: {
    name: "Platinum Table",
    price: 1000000,
  },
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { buyer, order, reference } = req.body || {};

  if (
    !buyer ||
    typeof buyer.name !== "string" ||
    typeof buyer.email !== "string" ||
    !buyer.name.trim() ||
    !buyer.email.trim() ||
    !Array.isArray(order) ||
    order.length === 0 ||
    !reference
  ) {
    return res.status(400).json({
      error: "Missing buyer, order, or reference",
    });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    console.error("PAYSTACK_SECRET_KEY is not set");
    return res.status(500).json({
      error: "Payment verification is not configured",
    });
  }

  /*
   * IMPORTANT:
   * The browser sends only ticket IDs and quantities.
   * Prices are deliberately taken from this server-side catalog.
   * Never trust a price sent by the browser.
   */
  const normalizedOrder = [];

  for (const item of order) {
    if (!item || typeof item.id !== "string") {
      return res.status(400).json({ error: "Invalid ticket item" });
    }

    const ticket = TICKET_CATALOG[item.id];
    const qty = Number(item.qty);

    if (!ticket) {
      return res.status(400).json({
        error: `Invalid ticket type: ${item.id}`,
      });
    }

    if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
      return res.status(400).json({
        error: `Invalid quantity for ${ticket.name}`,
      });
    }

    normalizedOrder.push({
      id: item.id,
      name: ticket.name,
      price: ticket.price,
      qty,
    });
  }

  const expectedTotal = normalizedOrder.reduce(
    (sum, item) => sum + item.price * item.qty,
    0
  );

  try {
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const verifyData = await verifyRes.json();

    if (
      !verifyRes.ok ||
      !verifyData.status ||
      !verifyData.data
    ) {
      console.error("Paystack verification response:", verifyData);

      return res.status(400).json({
        error: "Payment not verified",
      });
    }

    const transaction = verifyData.data;

    if (transaction.status !== "success") {
      return res.status(400).json({
        error: "Payment was not successful",
      });
    }

    if (transaction.currency !== "NGN") {
      return res.status(400).json({
        error: "Invalid payment currency",
      });
    }

    /*
     * Paystack returns amount in kobo.
     * Example: ₦5,000 = 500000 kobo.
     */
    const expectedAmountKobo = expectedTotal * 100;

    if (Number(transaction.amount) !== expectedAmountKobo) {
      console.error("Amount mismatch:", {
        paystackAmountKobo: transaction.amount,
        expectedAmountKobo,
        expectedTotal,
        order: normalizedOrder,
        reference,
      });

      return res.status(400).json({
        error: "Amount mismatch",
      });
    }

    if (
      transaction.customer?.email &&
      transaction.customer.email.toLowerCase() !==
        buyer.email.trim().toLowerCase()
    ) {
      return res.status(400).json({
        error: "Payment email does not match buyer email",
      });
    }
  } catch (e) {
    console.error("Paystack verification error:", e);

    return res.status(500).json({
      error: "Verification failed",
    });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const FROM = "tickets@mcsurface.com";
  const ORG = "Lordsurface001@gmail.com";

  if (!resendKey) {
    console.error("RESEND_API_KEY is not set");

    return res.status(500).json({
      error: "Email service not configured",
    });
  }

  const safeName = escapeHtml(buyer.name.trim());
  const safeEmail = escapeHtml(buyer.email.trim());
  const safeReference = escapeHtml(reference);

  const rows = normalizedOrder
    .map(
      (item) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #EAE2D2;">
            ${escapeHtml(item.name)}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #EAE2D2;text-align:center;">
            ${item.qty}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #EAE2D2;text-align:right;">
            ₦${(item.price * item.qty).toLocaleString("en-NG")}
          </td>
        </tr>
      `
    )
    .join("");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#171310;padding:32px;text-align:center;border-bottom:4px solid #D4A017;">
        <h1 style="margin:0;font-size:28px;color:#fff;">MC SURFACE</h1>
        <p style="color:#D4A017;font-weight:700;margin:4px 0;">
          COMEDY JUNCTION
        </p>
      </div>

      <div style="padding:32px;">
        <h2>Hey ${safeName}, you're in!</h2>

        <p style="color:#4A4038;">
          Your tickets are confirmed. Present this email at the entrance.
        </p>

        <div style="background:#fff8f0;border:2px solid #D4A017;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="margin:0 0 4px;font-size:12px;color:#8C7A5C;">
            TICKET REFERENCE
          </p>
          <p style="margin:0;font-size:18px;font-weight:700;">
            ${safeReference}
          </p>
        </div>

        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#171310;color:#fff;">
              <th style="padding:10px 12px;text-align:left;">Package</th>
              <th style="padding:10px 12px;">Qty</th>
              <th style="padding:10px 12px;text-align:right;">Subtotal</th>
            </tr>
          </thead>

          <tbody>
            ${rows}
          </tbody>
        </table>

        <div style="text-align:right;font-size:18px;font-weight:700;margin-top:12px;">
          Total: ₦${expectedTotal.toLocaleString("en-NG")}
        </div>
      </div>

      <div style="background:#171310;padding:16px;text-align:center;">
        <p style="color:#D4A017;margin:0;font-size:12px;">
          Surface Concept Entertainment
        </p>
      </div>
    </div>
  `;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${resendKey}`,
  };

  try {
    const [customerRes, orgRes] = await Promise.all([
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers,
        body: JSON.stringify({
          from: FROM,
          to: buyer.email.trim(),
          subject: "Your MC Surface Comedy Junction tickets are confirmed!",
          html,
        }),
      }),

      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers,
        body: JSON.stringify({
          from: FROM,
          to: ORG,
          subject: `New order from ${buyer.name.trim()} - ${reference}`,
          html,
        }),
      }),
    ]);

    if (!customerRes.ok || !orgRes.ok) {
      const customerError = await customerRes.text().catch(() => "");
      const orgError = await orgRes.text().catch(() => "");

      console.error("Resend error:", {
        customerStatus: customerRes.status,
        customerError,
        orgStatus: orgRes.status,
        orgError,
      });

      return res.status(500).json({
        error: "Payment verified, but email delivery failed",
      });
    }

    return res.status(200).json({
      ok: true,
      reference,
      total: expectedTotal,
      message: "Payment verified and tickets confirmed",
    });
  } catch (e) {
    console.error("Email sending error:", e);

    return res.status(500).json({
      error: "Failed to send confirmation email",
    });
  }
}
