# 🏨 AURUM Hotel — Full-Stack Web Application

Premium mehmonxona veb-sayti | Node.js + Express + SQLite + Unibot

---

## 📁 Loyiha tuzilmasi

```
aurum/
├── server.js          ← Asosiy Express server (barcha API endpointlar)
├── package.json       ← Dependencylar
├── .env.example       ← Environment o'zgaruvchilar namunasi
├── db/
│   ├── setup.js       ← Bazani yaratish skripti
│   └── aurum.sqlite   ← SQLite baza (avtomatik yaratiladi)
└── public/
    └── index.html     ← Frontend (premium dizayn)
```

---

## 🚀 O'rnatish va ishga tushirish

### 1. Dependencylarni o'rnatish
```bash
npm install
```

### 2. Environment sozlash
```bash
cp .env.example .env
# .env faylini tahrirlang
```

### 3. Serverni ishga tushirish
```bash
# Production
npm start

# Development (auto-restart)
npm run dev
```

### 4. Brauzerda ochish
```
http://localhost:3000
```

---

## 🔌 API Endpointlar

| Method | URL                           | Tavsif                    |
|--------|-------------------------------|---------------------------|
| GET    | `/api/health`                 | Server holati             |
| GET    | `/api/rooms`                  | Barcha xonalar            |
| GET    | `/api/rooms/availability`     | Mavjudlikni tekshirish    |
| POST   | `/api/bookings`               | Yangi bron yaratish       |
| GET    | `/api/bookings/:id`           | Bron holati               |
| POST   | `/api/contact`                | Aloqa formasi             |
| POST   | `/api/webhooks/unibot`        | Unibot webhook receiver   |
| GET    | `/api/admin/bookings`         | Admin: barcha bronlar     |
| GET    | `/api/admin/stats`            | Admin: statistika         |
| PATCH  | `/api/admin/bookings/:id/status` | Admin: status yangilash |

---

## 🤖 Unibot Integratsiyasi

### Variant 1: Unibot Webhook
`.env` fayliga qo'shing:
```
UNIBOT_WEBHOOK_URL=https://api.unibot.uz/webhook/YOUR_BOT_TOKEN
UNIBOT_API_KEY=your_api_key
```

### Variant 2: To'g'ridan Telegram Bot
```
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ
TELEGRAM_CHAT_ID=-1001234567890
```

Yangi bron kelganda bot avtomatik xabar yuboradi:
```
🏨 AURUM — Yangi Bron!
👤 Mehmon: Akbar Toshmatov
📅 Kelish: 2024-03-15 → Ketish: 2024-03-18
🛏 Xona: Presidential Suite
💰 Jami: $3,600
```

---

## 📧 Email Konfiguratsiya (Nodemailer)

Gmail App Password olish:
1. Google Account → Security → 2-Step Verification yoqish
2. App passwords → Generate
3. `.env` ga qo'shing:
```
SMTP_USER=your@gmail.com
SMTP_PASS=xxxx-xxxx-xxxx-xxxx
```

---

## 🔐 Admin Panel

Barcha admin so'rovlarda header qo'shing:
```
X-Admin-Secret: your_super_secret_admin_key_here
```

### Statistika olish:
```bash
curl -H "X-Admin-Secret: YOUR_KEY" http://localhost:3000/api/admin/stats
```

### Bronni tasdiqlash:
```bash
curl -X PATCH -H "X-Admin-Secret: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"confirmed"}' \
  http://localhost:3000/api/admin/bookings/BOOKING_ID/status
```

---

## 🌐 Production Deploy (Ubuntu Server)

### PM2 bilan:
```bash
npm install -g pm2
pm2 start server.js --name aurum-hotel
pm2 save && pm2 startup
```

### Nginx reverse proxy:
```nginx
server {
    listen 80;
    server_name aurum.uz www.aurum.uz;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### SSL (Let's Encrypt):
```bash
certbot --nginx -d aurum.uz -d www.aurum.uz
```

---

## 🛡 Xavfsizlik xususiyatlari
- ✅ Helmet.js (HTTP headers himoyasi)
- ✅ CORS sozlamalari
- ✅ Rate Limiting (bron: 10/soat, umumiy: 100/15 daqiqa)
- ✅ Input validatsiya (express-validator)
- ✅ SQL injection himoyasi (parametrli so'rovlar)
- ✅ Admin secret key autentifikatsiyasi
- ✅ Request size limiti (10kb)

---

## 📊 Ma'lumotlar bazasi jadvallari

- `bookings` — Bronlar (status: pending/confirmed/checked_in/checked_out/cancelled)
- `rooms` — Xona turlari va narxlar
- `contacts` — Aloqa so'rovlari
- `webhook_logs` — Unibot webhook tarixi

---

Made with ❤️ for AURUM Luxury Hotel
