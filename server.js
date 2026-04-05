require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const { v4: uuidv4 } = require('uuid');
const Database     = require('better-sqlite3');
const axios        = require('axios');
const fs           = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// SIZNING BOT TOKENINGIZ
const BOT_TOKEN = '8762173444:AAFKaXkIezMwVAXf1ezOnM-Of_1ZWRCqzlU';
// SIZNING TELEGRAM ID'INGIZ (Shu ID ni @userinfobot dan bilib olib, yozing. Hozircha bo'sh qoldiraman)
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || 'SIZNING_TELEGRAM_ID'; 

// ── Database ─────────────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || './db/aurum.sqlite';
const dbDir   = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY, tg_id TEXT, first_name TEXT, last_name TEXT,
    email TEXT, phone TEXT, check_in TEXT, check_out TEXT, room_type TEXT, 
    guests INTEGER, special_requests TEXT, status TEXT DEFAULT 'pending', total_price REAL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*', credentials: true })); // Hamma domen ruxsat etilgan
app.use(express.json());

const ROOM_PRICES = { deluxe_king: 280, luxury_twin: 420, presidential: 1200, royal_penthouse: 2500 };
const ROOM_NAMES  = { deluxe_king: 'Deluxe King', luxury_twin: 'Luxury Twin', presidential: 'Presidential Suite', royal_penthouse: 'Royal Penthouse (VIP)' };

function calcNights(checkIn, checkOut) {
  const ms = new Date(checkOut) - new Date(checkIn);
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

// ── Telegram Notification ─────────────────────────────────────────────────────
async function sendTelegramMsg(chatId, text, buttons = null) {
  try {
    const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
    if (buttons) payload.reply_markup = { inline_keyboard: buttons };
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, payload);
  } catch (e) { console.error('TG Xatolik:', e.message); }
}

async function handleNewBooking(booking) {
  const nights = calcNights(booking.check_in, booking.check_out);
  const roomName = ROOM_NAMES[booking.room_type];
  
  // 1. Adminga xabar (Mehmonxona egasiga)
  const adminMsg = `
🔔 <b>YANGI VIP BRON</b>

👤 <b>Mijoz:</b> ${booking.first_name} ${booking.last_name}
📞 <b>Tel:</b> ${booking.phone}
🛏 <b>Xona:</b> ${roomName}
📅 <b>Sana:</b> ${booking.check_in} ➡️ ${booking.check_out} (${nights} kecha)
💰 <b>Jami tushum:</b> $${booking.total_price}
📝 <b>Istak:</b> ${booking.special_requests || 'Yo\'q'}
  `;
  await sendTelegramMsg(ADMIN_CHAT_ID, adminMsg, [
    [{ text: "✅ Tasdiqlash", callback_data: `confirm_${booking.id}` }, { text: "❌ Bekor qilish", callback_data: `cancel_${booking.id}` }]
  ]);

  // 2. Mijozning o'ziga xabar (Agar u bot orqali kirgan bo'lsa va tg_id bor bo'lsa)
  if (booking.tg_id) {
    const clientMsg = `
Hurmatli <b>${booking.first_name}</b>,

Sizning <b>${roomName}</b> uchun buyurtmangiz qabul qilindi.
💰 Jami to'lov: <b>$${booking.total_price}</b>.

<i>Iltimos, xonani to'liq band qilish uchun oldindan to'lovni (Payme/Click) amalga oshiring yoki menejer qo'ng'irog'ini kuting.</i>
    `;
    // Click yoki Payme linki shu yerga ulanishi mumkin
    await sendTelegramMsg(booking.tg_id, clientMsg, [
      [{ text: "💳 Payme orqali to'lash", url: "https://payme.uz" }] 
    ]);
  }
}

// ── API ROUTES ────────────────────────────────────────────────────────────────
app.post('/api/bookings', async (req, res) => {
    const data = req.body;
    const nights = calcNights(data.check_in, data.check_out);
    const total_price = (ROOM_PRICES[data.room_type] || 0) * nights;
    const id = uuidv4();

    const insert = db.prepare(`
      INSERT INTO bookings (id,tg_id,first_name,last_name,email,phone,check_in,check_out,room_type,guests,special_requests,total_price)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    try {
      insert.run(id, data.tg_id || '', data.first_name, data.last_name, data.email, data.phone, data.check_in, data.check_out, data.room_type, data.guests || 1, data.special_requests || '', total_price);
      
      const newBooking = { id, ...data, total_price };
      setImmediate(() => handleNewBooking(newBooking));

      res.status(201).json({ success: true, data: { booking_id: id.slice(0,8).toUpperCase(), total_price } });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, message: 'Server xatoligi' });
    }
});

// Bot uchun oddiy Webhook qabul qilgich (Tasdiqlash tugmalari ishlashi uchun)
app.post('/bot-webhook', async (req, res) => {
  // Bu qismda siz botdagi "Tasdiqlash" tugmasi bosilganda nima bo'lishini yozasiz
  res.sendStatus(200);
});

app.listen(PORT, () => { console.log(`Backend ishga tushdi: http://localhost:${PORT}`); });
