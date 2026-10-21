const TELEGRAM_API = "https://api.telegram.org";

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function telegramRequest(token, method, body) {
  const response = await fetch(
    `${TELEGRAM_API}/bot${token}/${method}`,
    { method: "POST", body }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error("Telegram delivery failed.");
  }

  return result;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const token = process.env.BOT_TOKEN;
  const chatId = process.env.CHAT_ID;

  if (!token || !chatId) {
    return res.status(500).json({
      error: "Telegram server configuration is missing."
    });
  }

  const contentType = req.headers["content-type"] || "";
  const contentLength = Number(req.headers["content-length"] || 0);

  // Keep requests small. Configure a proper multipart parser
  // or private object storage for larger uploads.
  if (contentLength > 6 * 1024 * 1024) {
    return res.status(413).json({ error: "Request is too large." });
  }

  try {
    if (contentType.includes("multipart/form-data")) {
      return res.status(415).json({
        error:
          "Photo upload needs a multipart parser and a private upload endpoint. " +
          "It is intentionally not enabled in this starter."
      });
    }

    if (!contentType.includes("application/json")) {
      return res.status(415).json({
        error: "Use application/json."
      });
    }

    const report = req.body;

    if (!report || typeof report !== "object" || Array.isArray(report)) {
      return res.status(400).json({ error: "Invalid report." });
    }

    const allowed = new Set(["device", "battery", "network", "location"]);

    if (Object.keys(report).some((key) => !allowed.has(key))) {
      return res.status(400).json({
        error: "Unsupported report fields."
      });
    }

    if (JSON.stringify(report).length > 15000) {
      return res.status(413).json({ error: "Report is too large." });
    }

    const message =
      "<b>📱 BOOMBER X — DEVICE REPORT</b>\n\n" +
      "<b>ℹ️ Selected information</b>\n" +
      "<pre>" +
      escapeHTML(JSON.stringify(report, null, 2)).slice(0, 12000) +
      "</pre>\n" +
      "<i>Only information selected and submitted by the user is included.</i>";

    await telegramRequest(
      token,
      "sendMessage",
      new URLSearchParams({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML"
      })
    );

    return res.status(200).json({ success: true });
  } catch {
    return res.status(500).json({
      error: "Report could not be delivered. Please try again later."
    });
  }
};