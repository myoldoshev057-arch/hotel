// server.js — AURUM Hotel Full-Stack Server
require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const Database     = require('better-sqlite3');
const axios        = require('axios');
const nodemailer   = require('nodemailer');
const fs           = require('fs');

// ── App Setup ────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// ── Database ─────────────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || './db/aurum.sqlite';
const dbDir   = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Auto-setup if DB doesn't have tables yet
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
    email TEXT NOT NULL, phone TEXT NOT NULL, check_in TEXT NOT NULL,
    check_out TEXT NOT NULL, room_type TEXT NOT NULL, guests INTEGER DEFAULT 1,
    special_requests TEXT, status TEXT DEFAULT 'pending', total_price REAL,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    notified_telegram INTEGER DEFAULT 0, notified_email INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL,
    phone TEXT, subject TEXT, message TEXT NOT NULL,
    status TEXT DEFAULT 'new', created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT, type_key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL, description TEXT, price_per_night REAL NOT NULL,
    max_guests INTEGER DEFAULT 2, amenities TEXT, available INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS webhook_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT,
    payload TEXT, status TEXT, response TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  INSERT OR IGNORE INTO rooms (type_key,name,description,price_per_night,max_guests,amenities) VALUES
    ('deluxe_king','Deluxe King Room','Shahar ko\'rinishi, king-size to\'shak',280,2,'["WiFi","TV","Mini Bar","Jacuzzi"]'),
    ('luxury_twin','Luxury Twin Suite','Ikki xona, yashash zali',420,3,'["WiFi","TV","Mini Bar","Lounge"]'),
    ('presidential','Presidential Suite','270° panorama, 3 xona',1200,4,'["WiFi","TV","Bar","Butler","SPA"]'),
    ('royal_penthouse','Royal Penthouse','Penthouse, xususiy hovuz',2500,6,'["WiFi","TV","Bar","Butler","Pool","Heli Transfer"]');
`);

// ── Middleware ────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'","'unsafe-inline'","https://fonts.googleapis.com","https://cdnjs.cloudflare.com"],
      styleSrc:   ["'self'","'unsafe-inline'","https://fonts.googleapis.com","https://fonts.gstatic.com"],
      fontSrc:    ["'self'","https://fonts.gstatic.com"],
      imgSrc:     ["'self'","data:","https:"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max:      parseInt(process.env.RATE_LIMIT_MAX       || '100'),
  message:  { success: false, message: 'Juda ko\'p so\'rov. Biroz kuting.' },
  standardHeaders: true, legacyHeaders: false,
});
const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 soat
  max: 10,
  message: { success: false, message: 'Bir soatda 10 tadan ko\'p bron qilib bo\'lmaydi.' },
});

app.use('/api', apiLimiter);

// ── Utility Helpers ──────────────────────────────────────────────────────────
const ROOM_PRICES = { deluxe_king: 280, luxury_twin: 420, presidential: 1200, royal_penthouse: 2500 };
const ROOM_NAMES  = { deluxe_king: 'Deluxe King Room', luxury_twin: 'Luxury Twin Suite', presidential: 'Presidential Suite', royal_penthouse: 'Royal Penthouse' };

function calcNights(checkIn, checkOut) {
  const ms = new Date(checkOut) - new Date(checkIn);
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

// ── Notification Services ─────────────────────────────────────────────────────

// Telegram orqali xabar yuborish
async function notifyTelegram(booking) {
  const nights = calcNights(booking.check_in, booking.check_out);
  const roomName = ROOM_NAMES[booking.room_type] || booking.room_type;
  const msg = `
🏨 *AURUM — Yangi Bron!*

👤 *Mehmon:* ${booking.first_name} ${booking.last_name}
📧 *Email:* ${booking.email}
📞 *Tel:* ${booking.phone}
🛏 *Xona:* ${roomName}
📅 *Kelish:* ${booking.check_in}
📅 *Ketish:* ${booking.check_out}
🌙 *Tunlar:* ${nights}
👥 *Mehmonlar:* ${booking.guests}
💰 *Narx:* $${booking.total_price}
📝 *Izoh:* ${booking.special_requests || '—'}
🆔 *Bron ID:* \`${booking.id}\`
  `.trim();

  const chatId  = process.env.TELEGRAM_CHAT_ID;
  const token   = process.env.TELEGRAM_BOT_TOKEN;
  const unibotUrl = process.env.UNIBOT_WEBHOOK_URL;

  // Unibot orqali
  if (unibotUrl && process.env.UNIBOT_API_KEY) {
    try {
      const res = await axios.post(unibotUrl, {
        event: 'new_booking', booking_id: booking.id,
        data: booking, message: msg,
      }, {
        headers: { 'Authorization': `Bearer ${process.env.UNIBOT_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 5000,
      });
      db.prepare("INSERT INTO webhook_logs (event_type,payload,status,response) VALUES (?,?,?,?)").run(
        'unibot_notify', JSON.stringify(booking), 'success', JSON.stringify(res.data)
      );
      return true;
    } catch (e) {
      db.prepare("INSERT INTO webhook_logs (event_type,payload,status,response) VALUES (?,?,?,?)").run(
        'unibot_notify', JSON.stringify(booking), 'error', e.message
      );
    }
  }

  // To'g'ridan Telegram Bot API
  if (token && chatId) {
    try {
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId, text: msg, parse_mode: 'Markdown',
      }, { timeout: 5000 });
      return true;
    } catch (e) {
      console.error('[Telegram] Xatolik:', e.message);
    }
  }
  return false;
}

// Email tasdiqlash yuborish
async function sendConfirmationEmail(booking) {
  if (!process.env.SMTP_USER) return false;
  const nights   = calcNights(booking.check_in, booking.check_out);
  const roomName = ROOM_NAMES[booking.room_type] || booking.room_type;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const html = `
<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f9f9f9;padding:20px;">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #eee;">
  <div style="background:#0a0907;padding:24px 32px;">
    <h1 style="color:#c9a84c;margin:0;letter-spacing:0.3em;font-weight:300;font-size:24px;">AURUM</h1>
    <p style="color:rgba(240,235,224,0.6);margin:4px 0 0;font-size:13px;letter-spacing:0.1em;">LUXURY HOTEL · TOSHKENT</p>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#1a1a1a;font-weight:400;margin-bottom:8px;">Broniz tasdiqlandi ✓</h2>
    <p style="color:#666;font-size:14px;">Hurmatli ${booking.first_name}, sizning bron so'rovingiz qabul qilindi.</p>
    <div style="background:#f8f6f2;border-radius:6px;padding:20px;margin:20px 0;">
      <table style="width:100%;font-size:14px;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#999;width:45%">Bron ID</td><td style="color:#1a1a1a;font-family:monospace">${booking.id.slice(0,8).toUpperCase()}</td></tr>
        <tr><td style="padding:6px 0;color:#999;">Xona</td><td style="color:#1a1a1a;">${roomName}</td></tr>
        <tr><td style="padding:6px 0;color:#999;">Kelish</td><td style="color:#1a1a1a;">${booking.check_in}</td></tr>
        <tr><td style="padding:6px 0;color:#999;">Ketish</td><td style="color:#1a1a1a;">${booking.check_out}</td></tr>
        <tr><td style="padding:6px 0;color:#999;">Tunlar</td><td style="color:#1a1a1a;">${nights} kecha</td></tr>
        <tr><td style="padding:6px 0;color:#999;">Mehmonlar</td><td style="color:#1a1a1a;">${booking.guests} kishi</td></tr>
        <tr><td style="padding:6px 0;color:#999;border-top:1px solid #e8e4dd;padding-top:12px;">Jami narx</td>
            <td style="color:#c9a84c;font-size:18px;font-weight:500;border-top:1px solid #e8e4dd;padding-top:12px;">$${booking.total_price}</td></tr>
      </table>
    </div>
    <p style="color:#666;font-size:13px;">Savollar uchun: <a href="tel:+998712000000" style="color:#c9a84c;">+998 71 200 00 00</a> yoki <a href="mailto:info@aurum.uz" style="color:#c9a84c;">info@aurum.uz</a></p>
  </div>
  <div style="background:#0a0907;padding:16px 32px;text-align:center;">
    <p style="color:rgba(240,235,224,0.3);font-size:11px;margin:0;letter-spacing:0.1em;">© 2024 AURUM Luxury Hotel · Amir Temur shoh. 1, Toshkent</p>
  </div>
</div></body></html>
  `;
  try {
    await transporter.sendMail({
      from:    process.env.EMAIL_FROM || '"AURUM Hotel" <noreply@aurum.uz>',
      to:      booking.email,
      subject: `✓ Bron tasdiqlandi — ${roomName} | AURUM Hotel`,
      html,
    });
    return true;
  } catch (e) {
    console.error('[Email] Xatolik:', e.message);
    return false;
  }
}

// ── Static Files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════════════════════

// ── GET /api/rooms — Barcha xonalar
app.get('/api/rooms', (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms WHERE available = 1').all();
  rooms.forEach(r => { try { r.amenities = JSON.parse(r.amenities); } catch { r.amenities = []; } });
  res.json({ success: true, data: rooms });
});

// ── GET /api/rooms/availability — Mavjudligini tekshirish
app.get('/api/rooms/availability', (req, res) => {
  const { check_in, check_out, room_type } = req.query;
  if (!check_in || !check_out) return res.status(400).json({ success: false, message: 'check_in va check_out kerak' });
  const conflict = db.prepare(`
    SELECT COUNT(*) as cnt FROM bookings
    WHERE room_type = ? AND status NOT IN ('cancelled')
    AND NOT (check_out <= ? OR check_in >= ?)
  `).get(room_type, check_in, check_out);
  const nights = calcNights(check_in, check_out);
  const price  = ROOM_PRICES[room_type] || 0;
  res.json({ success: true, available: conflict.cnt === 0, nights, estimated_price: price * nights });
});

// ── POST /api/bookings — Yangi bron yaratish
app.post('/api/bookings',
  bookingLimiter,
  [
    body('first_name').trim().notEmpty().withMessage('Ism kiritilishi shart').isLength({ max: 80 }),
    body('last_name').trim().notEmpty().withMessage('Familiya kiritilishi shart').isLength({ max: 80 }),
    body('email').isEmail().normalizeEmail().withMessage('Email noto\'g\'ri'),
    body('phone').trim().notEmpty().withMessage('Telefon kiritilishi shart').matches(/^[+\d\s\-()]{7,20}$/),
    body('check_in').isDate().withMessage('Kelish sanasi noto\'g\'ri'),
    body('check_out').isDate().withMessage('Ketish sanasi noto\'g\'ri'),
    body('room_type').isIn(['deluxe_king','luxury_twin','presidential','royal_penthouse']).withMessage('Noto\'g\'ri xona turi'),
    body('guests').optional().isInt({ min: 1, max: 10 }),
    body('special_requests').optional().trim().isLength({ max: 500 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ success: false, errors: errors.array().map(e => ({ field: e.path, message: e.msg })) });
    }

    const { first_name, last_name, email, phone, check_in, check_out, room_type, guests, special_requests } = req.body;

    if (new Date(check_out) <= new Date(check_in)) {
      return res.status(400).json({ success: false, message: 'Ketish sanasi kelish sanasidan keyin bo\'lishi kerak' });
    }

    const nights      = calcNights(check_in, check_out);
    const total_price = (ROOM_PRICES[room_type] || 0) * nights;
    const id          = uuidv4();

    const insert = db.prepare(`
      INSERT INTO bookings (id,first_name,last_name,email,phone,check_in,check_out,room_type,guests,special_requests,total_price)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `);

    try {
      insert.run(id, first_name, last_name, email, phone, check_in, check_out, room_type, guests || 1, special_requests || '', total_price);
    } catch (e) {
      console.error('[DB] Insert error:', e.message);
      return res.status(500).json({ success: false, message: 'Serverda xatolik yuz berdi' });
    }

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);

    // Async notifications (javobni kechiktirmaydi)
    setImmediate(async () => {
      const telegramOk = await notifyTelegram(booking);
      const emailOk    = await sendConfirmationEmail(booking);
      db.prepare('UPDATE bookings SET notified_telegram=?,notified_email=?,updated_at=datetime("now") WHERE id=?')
        .run(telegramOk ? 1 : 0, emailOk ? 1 : 0, id);
    });

    res.status(201).json({
      success: true,
      message: 'Bron muvaffaqiyatli qabul qilindi!',
      data: {
        booking_id:   id.slice(0, 8).toUpperCase(),
        full_id:      id,
        nights,
        total_price,
        room_name:    ROOM_NAMES[room_type],
        check_in,
        check_out,
        status:       'pending',
      },
    });
  }
);

// ── GET /api/bookings/:id — Bron holati
app.get('/api/bookings/:id', (req, res) => {
  const booking = db.prepare('SELECT id,first_name,last_name,check_in,check_out,room_type,guests,total_price,status,created_at FROM bookings WHERE id=? OR substr(upper(id),1,8)=?')
    .get(req.params.id, req.params.id.toUpperCase());
  if (!booking) return res.status(404).json({ success: false, message: 'Bron topilmadi' });
  res.json({ success: true, data: { ...booking, room_name: ROOM_NAMES[booking.room_type] } });
});

// ── POST /api/contact — Aloqa formasi
app.post('/api/contact',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: { success: false, message: 'Keyinroq urinib ko\'ring' } }),
  [
    body('name').trim().notEmpty().withMessage('Ism kiritilishi shart').isLength({ max: 100 }),
    body('email').isEmail().normalizeEmail(),
    body('message').trim().notEmpty().isLength({ min: 10, max: 1000 }),
    body('phone').optional().trim().isLength({ max: 20 }),
    body('subject').optional().trim().isLength({ max: 150 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
    const { name, email, phone, subject, message } = req.body;
    db.prepare('INSERT INTO contacts (name,email,phone,subject,message) VALUES (?,?,?,?,?)').run(name, email, phone || '', subject || '', message);
    res.json({ success: true, message: 'Xabaringiz qabul qilindi. Tez orada javob beramiz!' });
  }
);

// ── POST /api/webhooks/unibot — Unibotdan kelgan webhook'larni qabul qilish
app.post('/api/webhooks/unibot', (req, res) => {
  const signature = req.headers['x-unibot-signature'];
  // TODO: signature validation qo'shing
  const payload = req.body;
  console.log('[Unibot Webhook]', JSON.stringify(payload));
  db.prepare('INSERT INTO webhook_logs (event_type,payload,status) VALUES (?,?,?)').run('unibot_incoming', JSON.stringify(payload), 'received');

  // Hodisaga qarab amal bajarish
  if (payload.event === 'booking_confirmed' && payload.booking_id) {
    db.prepare("UPDATE bookings SET status='confirmed',updated_at=datetime('now') WHERE id=?").run(payload.booking_id);
  }
  if (payload.event === 'booking_cancelled' && payload.booking_id) {
    db.prepare("UPDATE bookings SET status='cancelled',updated_at=datetime('now') WHERE id=?").run(payload.booking_id);
  }
  res.json({ received: true });
});

// ── Admin API (Secret key talab qiladi)
const adminMiddleware = (req, res, next) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ success: false, message: 'Ruxsat yo\'q' });
  }
  next();
};

app.get('/api/admin/bookings', adminMiddleware, (req, res) => {
  const { status, date, page = 1, limit = 20 } = req.query;
  let query = 'SELECT * FROM bookings WHERE 1=1';
  const params = [];
  if (status) { query += ' AND status = ?'; params.push(status); }
  if (date)   { query += ' AND check_in = ?'; params.push(date); }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
  const bookings = db.prepare(query).all(...params);
  const total    = db.prepare('SELECT COUNT(*) as cnt FROM bookings').get().cnt;
  res.json({ success: true, data: bookings, total, page: parseInt(page) });
});

app.patch('/api/admin/bookings/:id/status', adminMiddleware, (req, res) => {
  const { status } = req.body;
  const allowed = ['pending','confirmed','checked_in','checked_out','cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Noto\'g\'ri status' });
  const result = db.prepare("UPDATE bookings SET status=?,updated_at=datetime('now') WHERE id=?").run(status, req.params.id);
  if (!result.changes) return res.status(404).json({ success: false, message: 'Bron topilmadi' });
  res.json({ success: true, message: 'Status yangilandi' });
});

app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  const stats = {
    total_bookings:     db.prepare("SELECT COUNT(*) as c FROM bookings").get().c,
    pending:            db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status='pending'").get().c,
    confirmed:          db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status='confirmed'").get().c,
    total_revenue:      db.prepare("SELECT COALESCE(SUM(total_price),0) as s FROM bookings WHERE status NOT IN ('cancelled')").get().s,
    today_checkins:     db.prepare("SELECT COUNT(*) as c FROM bookings WHERE check_in=date('now')").get().c,
    unread_contacts:    db.prepare("SELECT COUNT(*) as c FROM contacts WHERE status='new'").get().c,
  };
  res.json({ success: true, data: stats });
});

// ── Health Check
app.get('/api/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' }));

// ── SPA Fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ── Error Handler
app.use((err, req, res, _next) => {
  console.error('[Error]', err.stack);
  res.status(500).json({ success: false, message: process.env.NODE_ENV === 'development' ? err.message : 'Serverda xatolik' });
});

// ── Start
app.listen(PORT, () => {
  console.log(`\n🏨  AURUM Hotel Server ishga tushdi`);
  console.log(`    ➜  Local:   http://localhost:${PORT}`);
  console.log(`    ➜  API:     http://localhost:${PORT}/api`);
  console.log(`    ➜  Health:  http://localhost:${PORT}/api/health\n`);
});

process.on('SIGINT', () => { db.close(); process.exit(); });
module.exports = app;
