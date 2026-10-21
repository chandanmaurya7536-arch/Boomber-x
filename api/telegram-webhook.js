async function redis(command, ...args) {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

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
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`,
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
    return res.status(405).end();
  }

  try {
    const update = req.body;

    if (update?.message) {
      const message = update.message;

      // Only the configured admin chat can control the bot.
      if (
        String(message.chat?.id) !== String(process.env.CHAT_ID)
      ) {
        return res.status(200).json({ ok: true });
      }

      if (message.text === "/start" || message.text === "/panel") {
        await telegram("sendMessage", {
          chat_id: process.env.CHAT_ID,
          text: "🎛️ BOOMBER X — CONTROL PANEL",
          reply_markup: {
            inline_keyboard: [
              [{
                text: "🔴 STOP ALL SHARING",
                callback_data: "stopall"
              }],
              [{
                text: "🟢 ALLOW NEW SHARING SESSIONS",
                callback_data: "allownew"
              }]
            ]
          }
        });
      }

      return res.status(200).json({ ok: true });
    }

    const query = update?.callback_query;

    if (!query) {
      return res.status(200).json({ ok: true });
    }

    // Reject controls sent from chats other than the configured admin chat.
    if (
      String(query.message?.chat?.id) !== String(process.env.CHAT_ID)
    ) {
      await telegram("answerCallbackQuery", {
        callback_query_id: query.id,
        text: "Unauthorized"
      });

      return res.status(200).json({ ok: true });
    }

    const action = String(query.data || "");

    if (action.startsWith("stop:")) {
      const sessionId = action.slice(5);

      if (!/^[a-zA-Z0-9_-]{16,64}$/.test(sessionId)) {
        await telegram("answerCallbackQuery", {
          callback_query_id: query.id,
          text: "Invalid session"
        });

        return res.status(200).json({ ok: true });
      }

      await redis("SET", `location:stopped:${sessionId}`, "1");

      await telegram("answerCallbackQuery", {
        callback_query_id: query.id,
        text: "This session has been stopped."
      });

      await telegram("editMessageReplyMarkup", {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        reply_markup: { inline_keyboard: [] }
      });

      await telegram("sendMessage", {
        chat_id: process.env.CHAT_ID,
        text:
          "⏹ <b>SESSION STOPPED</b>\n\n" +
          "Further location reports for this session will be rejected.",
        parse_mode: "HTML"
      });

      return res.status(200).json({ ok: true });
    }

    if (action === "stopall") {
      await redis("SET", "location:stop_all", "1");

      await telegram("answerCallbackQuery", {
        callback_query_id: query.id,
        text: "Sharing has been blocked."
      });

      await telegram("sendMessage", {
        chat_id: process.env.CHAT_ID,
        text:
          "🔴 <b>SHARING BLOCKED</b>\n\n" +
          "New live-location reports are now blocked. " +
          "This does not remotely disable GPS on a visitor's device.",
        parse_mode: "HTML"
      });

      return res.status(200).json({ ok: true });
    }

    if (action === "allownew") {
      await redis("DEL", "location:stop_all");

      await telegram("answerCallbackQuery", {
        callback_query_id: query.id,
        text: "New sessions may be submitted again."
      });

      await telegram("sendMessage", {
        chat_id: process.env.CHAT_ID,
        text:
          "🟢 New sessions are allowed again. " +
          "Visitors must still start location sharing themselves."
      });

      return res.status(200).json({ ok: true });
    }

    await telegram("answerCallbackQuery", {
      callback_query_id: query.id,
      text: "Unknown action"
    });

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Webhook failed" });
  }
};