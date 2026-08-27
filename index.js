const express   = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode    = require("qrcode");

const app    = express();
const PORT   = process.env.PORT || 3001;
const SECRET = process.env.WA_SECRET || "change-me";

app.use(express.json());

// ── WhatsApp client ───────────────────────────────────────────────────────

let isReady  = false;
let currentQR = null;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: "./wa_session" }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  },
});

client.on("qr", (qr) => {
  currentQR = qr;
  isReady   = false;
  console.log("[WA] QR code ready — open /qr to scan");
});

client.on("ready", () => {
  isReady   = true;
  currentQR = null;
  console.log("[WA] Connected and ready!");
});

client.on("disconnected", (reason) => {
  isReady = false;
  console.log("[WA] Disconnected:", reason);
  // Auto-reconnect
  setTimeout(() => client.initialize(), 5000);
});

client.initialize();

// ── Auth middleware ───────────────────────────────────────────────────────

function auth(req, res, next) {
  if (req.headers["x-wa-secret"] !== SECRET)
    return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────

// Health check — no auth needed
app.get("/", (req, res) => {
  res.json({ service: "xeno-whatsapp", ready: isReady, hasQR: Boolean(currentQR) });
});

// Get QR code as image — open in browser to scan
app.get("/qr", async (req, res) => {
  if (isReady)   return res.send("<h2 style='font-family:sans-serif;color:green'>✅ WhatsApp متصل!</h2>");
  if (!currentQR) return res.send("<h2 style='font-family:sans-serif'>⏳ جارٍ التهيئة... انتظر 10 ثواني وأعد التحميل</h2>");

  const img = await qrcode.toDataURL(currentQR);
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl">
    <head><title>XENO WhatsApp QR</title><meta http-equiv="refresh" content="30"></head>
    <body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>📱 افتح WhatsApp → الأجهزة المرتبطة → ربط جهاز</h2>
      <img src="${img}" style="width:300px;border:1px solid #ddd;border-radius:12px;padding:16px">
      <p style="color:#888;font-size:13px">الصفحة بتتحدث كل 30 ثانية تلقائياً</p>
    </body>
    </html>
  `);
});

// Send a message
app.post("/send", auth, async (req, res) => {
  if (!isReady)
    return res.status(503).json({ error: "WhatsApp مش متصل — افتح /qr للربط" });

  const { phone, message } = req.body;
  if (!phone || !message)
    return res.status(400).json({ error: "phone و message مطلوبين" });

  // Normalize phone: remove non-digits, ensure country code
  let number = phone.replace(/[^0-9]/g, "");
  if (number.startsWith("0")) number = "20" + number.slice(1); // Egyptian local → 20xx
  if (!number.startsWith("20")) number = "20" + number;        // ensure Egypt code

  const chatId = `${number}@c.us`;

  try {
    await client.sendMessage(chatId, message);
    res.json({ ok: true, to: chatId });
  } catch (err) {
    console.error("[WA] Send error:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => console.log(`[WA] Service on port ${PORT}`));
