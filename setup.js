// db/setup.js — Ma'lumotlar bazasini yaratish va jadvallarni sozlash
require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './db/aurum.sqlite';
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);

// ── Performance sozlamalari
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Jadvallarni yaratish
db.exec(`
  -- Bronlar jadvali
  CREATE TABLE IF NOT EXISTS bookings (
    id           TEXT PRIMARY KEY,
    first_name   TEXT NOT NULL,
    last_name    TEXT NOT NULL,
    email        TEXT NOT NULL,
    phone        TEXT NOT NULL,
    check_in     TEXT NOT NULL,
    check_out    TEXT NOT NULL,
    room_type    TEXT NOT NULL,
    guests       INTEGER DEFAULT 1,
    special_requests TEXT,
    status       TEXT DEFAULT 'pending',
    total_price  REAL,
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now')),
    notified_telegram INTEGER DEFAULT 0,
    notified_email    INTEGER DEFAULT 0
  );

  -- Xonalar jadvali
  CREATE TABLE IF NOT EXISTS rooms (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type_key     TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    price_per_night REAL NOT NULL,
    max_guests   INTEGER DEFAULT 2,
    amenities    TEXT,
    available    INTEGER DEFAULT 1
  );

  -- Aloqa so'rovlari
  CREATE TABLE IF NOT EXISTS contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    phone      TEXT,
    subject    TEXT,
    message    TEXT NOT NULL,
    status     TEXT DEFAULT 'new',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Webhook log (Unibot xatolar uchun)
  CREATE TABLE IF NOT EXISTS webhook_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT,
    payload    TEXT,
    status     TEXT,
    response   TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Indekslar
  CREATE INDEX IF NOT EXISTS idx_bookings_email    ON bookings(email);
  CREATE INDEX IF NOT EXISTS idx_bookings_status   ON bookings(status);
  CREATE INDEX IF NOT EXISTS idx_bookings_checkin  ON bookings(check_in);
  CREATE INDEX IF NOT EXISTS idx_contacts_status   ON contacts(status);
`);

// ── Boshlang'ich xona ma'lumotlari
const insertRoom = db.prepare(`
  INSERT OR IGNORE INTO rooms (type_key, name, description, price_per_night, max_guests, amenities)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const seedRooms = db.transaction(() => {
  insertRoom.run('deluxe_king',     'Deluxe King Room',  'Shahar manzarasi va king-size to\'shak',       280,  2, JSON.stringify(['WiFi','TV','Mini Bar','Jacuzzi']));
  insertRoom.run('luxury_twin',     'Luxury Twin Suite', 'Ikkita alohida to\'shak, yashash xonasi bilan', 420,  3, JSON.stringify(['WiFi','TV','Mini Bar','Lounge']));
  insertRoom.run('presidential',    'Presidential Suite','Butun qavat, 3 xona, 270° panorama',           1200, 4, JSON.stringify(['WiFi','TV','Bar','Butler','SPA access']));
  insertRoom.run('royal_penthouse', 'Royal Penthouse',   'Penthouse, xususiy hovuz, terrace',             2500, 6, JSON.stringify(['WiFi','TV','Bar','Butler','Private Pool','Helicopter Transfer']));
});
seedRooms();

console.log('✅ Baza muvaffaqiyatli yaratildi:', DB_PATH);
db.close();

module.exports = db;
