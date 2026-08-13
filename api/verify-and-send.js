const TICKET_PRICES = {
  regular: 5000,
  vip: 20000,
  table: 50000,
  gold: 500000,
  premium: 1000000,
};

const TICKET_NAMES = {
  regular: "Regular",
  vip: "VIP",
  table: "Seat on a Table",
  gold: "Gold Table",
  premium: "Platinum Table",
};

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, function (char) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };

    return map[char];
  });
}

function makeEmailHtml(buyer, order, reference, total) {
  const rows = order
    .map(function (item) {
      const subtotal = item.price * item.qty;

      return (
        '<tr>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #EAE2D2;">' +
        escapeHtml(item.name) +
        "</td>" +
        '<td style="padding:8px 12px;border-bottom:1px solid #EAE2D2;text-align:center;">' +
        item.qty +
        "</td>" +
        '<td style="padding:8px 12px;border-bottom:1px solid #EAE2D2;text-align:right;">₦' +
        subtotal.toLocaleString("en-NG") +
        "</td>" +
        "</tr>"
      );
    })
    .join("");

  return (
    '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">' +

    '<div style="background:#171310;padding:32px;text-align:center;border-bottom:4px solid #D4A017;">' +
    '<h1 style="margin:0;font-size:28px;color:#fff;">MC SURFACE</h1>' +
    '<p style="color:#D4A017;font-weight:700;margin:4px 0;">COMEDY JUNCTION</p>' +
    "</div>" +

    '<div style="padding:32px;">' +

    "<h2>Hey " +
    escapeHtml(buyer.name) +
    ", you're in!</h2>" +

    '<p style="color:#4A4038;">Your tickets are confirmed. Present this email at the entrance.</p>' +

    '<div style="background:#fff8f0;border:2px solid #D4A017;border-radius:8px;padding:16px;margin:20px 0;">' +

    '<p style="margin:0 0 4px;font-size:12px;color:#8C7A5C;">TICKET REFERENCE</p>' +

    '<p style="margin:0;font-size:18px;font-weight:700;">' +
    escapeHtml(reference) +
    "</p>" +

    "</div>" +

    '<table style="width:100%;border-collapse:collapse;">' +

    '<thead>' +
    '<tr style="background:#171310;color:#fff;">' +
    '<th style="padding:10px 12px;text-align:left;">Package</th>' +
    '<th style="padding:10px 12px;">Qty</th>' +
    '<th style="padding:10px 12px;text-align:right;">Subtotal</th>' +
    "</tr>" +
    "</thead>" +

    "<tbody>" +
    rows +
    "</tbody>" +

    "</table>" +

    '<div style="text-align:right;font-size:18px;font-weight:700;margin-top:12px;">' +
    "Total: ₦" +
    total.toLocaleString("en-NG") +
    "</div>" +

    "</div>" +

    '<div style="background:#171310;padding:16px;text-align:center;">' +
    '<p style="color:#D4A017;margin:0;font-size:12px;">Surface Concept Entertainment</p>' +
    "</div>" +

    "</div>"
  );
}

export default async function handler(req, res) {
  // Only POST requests are allowed
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  const body = req.body || {};

  const buyer = body.buyer;
  const order = body.order;
  const reference = body.reference;

  // Validate request
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

  // Paystack secret key
  const paystackKey = process.env.PAYSTACK_SECRET_KEY;

  if (!paystackKey) {
    console.error("PAYSTACK_SECRET_KEY is not configured");

    return res.status(500).json({
      error: "Payment verification is not configured",
    });
  }

  // Build a secure order using server-side prices
  const normalizedOrder = [];

  for (const item of order) {
    if (!item || typeof item.id !== "string") {
      return res.status(400).json({
        error: "Invalid ticket item",
      });
    }

    const price = TICKET_PRICES[item.id];
    const name = TICKET_NAMES[item.id];
    const qty = Number(item.qty);

    if (!price || !name) {
      return res.status(400).json({
        error: "Invalid ticket type",
      });
    }

    if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
      return res.status(400).json({
        error: "Invalid ticket quantity",
      });
    }

    normalizedOrder.push({
      id: item.id,
      name: name,
      price: price,
      qty: qty,
    });
  }

  // Calculate the expected total on the server
  const expectedTotal = normalizedOrder.reduce(function (sum, item) {
    return sum + item.price * item.qty;
  }, 0);

  // --------------------------------------------------
  // VERIFY PAYMENT WITH PAYSTACK
  // --------------------------------------------------

  let transaction;

  try {
    const verifyRes = await fetch(
      "https://api.paystack.co/transaction/verify/" +
        encodeURIComponent(reference),
      {
        method: "GET",
        headers: {
          Authorization: "Bearer " + paystackKey,
          "Content-Type": "application/json",
        },
      }
    );

    const verifyData = await verifyRes.json();

    if (!verifyRes.ok || !verifyData.status || !verifyData.data) {
      console.error("Paystack verification failed:", verifyData);

      return res.status(400).json({
        error: "Payment not verified",
      });
    }

    transaction = verifyData.data;

    // Payment must be successful
    if (transaction.status !== "success") {
      return res.status(400).json({
        error: "Payment was not successful",
      });
    }

    // Payment must be in Nigerian Naira
    if (transaction.currency !== "NGN") {
      return res.status(400).json({
        error: "Invalid payment currency",
      });
    }

    // Paystack amounts are in kobo
    const expectedKobo = expectedTotal * 100;

    if (Number(transaction.amount) !== expectedKobo) {
      console.error("Amount mismatch:", {
        reference: reference,
        paystackAmount: transaction.amount,
        expectedKobo: expectedKobo,
      });

      return res.status(400).json({
        error: "Amount mismatch",
      });
    }

    // Check buyer email against Paystack customer email
    const paystackEmail =
      transaction.customer && transaction.customer.email
        ? transaction.customer.email.toLowerCase()
        : "";

    if (
      paystackEmail &&
      paystackEmail !== buyer.email.trim().toLowerCase()
    ) {
      return res.status(400).json({
        error: "Payment email does not match buyer email",
      });
    }
  } catch (error) {
    console.error("Paystack verification error:", error);

    return res.status(500).json({
      error: "Verification failed",
    });
  }

  // --------------------------------------------------
  // SEND EMAIL WITH RESEND
  // --------------------------------------------------

  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    console.error("RESEND_API_KEY is not configured");

    return res.status(500).json({
      error: "Email service not configured",
    });
  }

  const FROM = "tickets@mcsurface.com";
  const ORG = "Lordsurface001@gmail.com";

  const html = makeEmailHtml(
    buyer,
    normalizedOrder,
    reference,
    expectedTotal
  );

  const resendHeaders = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + resendKey,
  };

  try {
    // Send confirmation to customer
    const customerResponse = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: resendHeaders,
        body: JSON.stringify({
          from: FROM,
          to: buyer.email.trim(),
          subject:
            "Your MC Surface Comedy Junction tickets are confirmed!",
          html: html,
        }),
      }
    );

    if (!customerResponse.ok) {
      const errorText = await customerResponse.text();

      console.error(
        "Resend customer email failed:",
        errorText
      );

      return res.status(500).json({
        error:
          "Payment verified, but customer email could not be sent",
      });
    }

    // Send notification to organization
    const orgResponse = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: resendHeaders,
        body: JSON.stringify({
          from: FROM,
          to: ORG,
          subject:
            "New order from " +
            buyer.name.trim() +
            " - " +
            reference,
          html: html,
        }),
      }
    );

    if (!orgResponse.ok) {
      const errorText = await orgResponse.text();

      console.error(
        "Resend organization email failed:",
        errorText
      );

      return res.status(500).json({
        error:
          "Payment verified and customer email sent, but organization email failed",
      });
    }

    // Everything succeeded
    return res.status(200).json({
      ok: true,
      reference: reference,
      total: expectedTotal,
    });
  } catch (error) {
    console.error("Resend request error:", error);

    return res.status(500).json({
      error: "Payment verified, but email delivery failed",
    });
  }
}
