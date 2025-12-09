const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const express = require("express");
const FormData = require("form-data");
const cheerio = require("cheerio"); // Untuk cek OTP manual/otomatis

// ===========================
// CONFIG (GANTI INI)
// ===================================
const TOKEN = "8538829118:AAFLc_-aR66jifaxdjIZVchajGWMc1Cxj6c"; // [GANTI] Bot Token Anda
const VNUM_API_KEY = "v1sGhi9rnV4OkpYcboBdFP6RKZM8NJ"; // [GANTI] API Key Virtusim Anda
const OCR_API_KEY = "K85889857588957"; // [GANTI] API Key OCR Anda
const CHANNEL_ID = "@stockwalzy"; // [GANTI] Channel ID Anda
const ADMIN_ID = "7732520601"; // [GANTI] ID Admin Anda (Sama dengan salah satu ID di orders.json)
const ADMIN_USERNAME = "walzdevnew"; // [GANTI] Username Admin (Tanpa @)
const VIRTUSIM_BASE_URL = "https://virtusim.com/api/v2/json.php"; // Base URL Virtusim

const bot = new TelegramBot(TOKEN, { polling: true });
const DB_FILE = "./orders.json";
let orders = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE)) : [];

const app = express();
app.use(express.json());

// ===========================
// MODE MAINTENANCE
// ===========================
let maintenanceMode = false;

// ===========================
// Variabel global untuk pengurangan saldo
// ===========================
let pendingReduceSaldo = null; 

// ===========================
// Fungsi API VIRTUOSIM
// ===========================
async function virtusimRequest(action, params = {}) {
  try {
    const query = new URLSearchParams({ api_key: VNUM_API_KEY, action, ...params }).toString();
    const url = `${VIRTUSIM_BASE_URL}?${query}`;
    
    const res = await axios.get(url);
    if (res.data && res.data.status) return res.data;
    
    return { status: false, error: res.data?.data?.msg || "Respon Virtusim Error." };
  } catch (err) {
    return { status: false, error: err.response?.data?.msg || err.message };
  }
}

async function fetchPrices() {
  // Menggunakan harga default karena harga dinamis Virtusim kompleks
  return {}; 
}

async function getPrice(country, service, prices) {
  // Harga tetap Rp 3.500 per nomor
  const defaultPriceRp = 3500; 
  return defaultPriceRp;
}

async function buyVirtualNumber(service, country) {
  try {
    const res = await virtusimRequest('order', { service: service, country: country });
    
    if (res.status && res.data && res.data.number && res.data.id) {
        return { phone: res.data.number, id: res.data.id };
    }
    return { error: res.error || "Nomor virtual gagal dibuat dari Virtusim." };
  } catch (err) {
    return { error: err.message };
  }
}

async function checkOTP(orderId) {
    try {
        const res = await virtusimRequest('status', { id: orderId });
        
        if (res.status && res.data && res.data.sms_code) {
            return res.data.sms_code;
        }
        return null;
    } catch {
        return null;
    }
}

async function checkSupplierBalance() {
    const res = await virtusimRequest('balance');
    return res.data?.balance; 
}

async function getBalanceLogs() {
    const res = await virtusimRequest('balance_logs');
    return res.data?.logs; 
}

// ===========================
// Daftar layanan lengkap
// ===========================
const serviceList = [
  { text: "📲 WhatsApp", code: "wa" },
  { text: "💬 Telegram", code: "telegram" },
  { text: "🌐 Google", code: "google" },
  { text: "📸 Instagram", code: "instagram" },
  { text: "📘 Facebook", code: "facebook" },
  { text: "🐦 Twitter", code: "twitter" },
  { text: "🛒 Shopee", code: "shopee" },
  { text: "🎵 TikTok", code: "tiktok" },
  // ... (layanan dipersingkat untuk fokus)
];

// ===========================
// Tombol Menu Utama
// ===========================
function getMainMenuKeyboard(isAdmin = false) {
  const keyboard = [
    [
      { text: "📱 Beli Nomor", callback_data: "btn_buy_page_0" },
      { text: "💰 Deposit QRIS", callback_data: "btn_deposit" },
      { text: "💳 Cek Saldo", callback_data: "btn_check_saldo" }
    ],
    [
      { text: "📋 Cek Nomor", callback_data: "btn_check_all" },
      { text: "💡 Bantuan NOKOS", callback_data: "btn_nokos_help" }
    ],
    [
      { text: "📣 Broadcast", callback_data: "btn_broadcast_menu" },
      { text: "📡 ChannelCast", callback_data: "btn_channelcast_menu" }
    ],
    [
      { text: "🤖 AI CS", callback_data: "btn_ai_help" }
    ],
    [
      { text: "👤 Hubungi Admin", url: `https://t.me/${ADMIN_USERNAME}` }
    ]
  ];

  if (isAdmin) {
    keyboard.splice(2, 0, [
      { text: maintenanceMode ? "🛠️ Matikan Mode Off" : "🛠️ Aktifkan Mode Off", callback_data: "btn_toggle_maintenance" },
      { text: "💰 Tambah Saldo Pelanggan", callback_data: "btn_admin_add_saldo" },
      { text: "💸 Kurangi Saldo Pelanggan", callback_data: "btn_admin_reduce_saldo" }
    ], [
        { text: "💳 Saldo Supplier", callback_data: "btn_supplier_balance" },
        { text: "📜 Mutasi Supplier", callback_data: "btn_supplier_logs" }
    ]);
  }

  return keyboard;
}

// ===========================
// Fungsi Keyboard Layanan per Halaman
// ===========================
function getServicePageKeyboardWithSaldo(page = 0, country = "id", prices = {}, userSaldo = 0) {
  const perPage = 4;
  const start = page * perPage;
  const end = start + perPage;
  const pageServices = serviceList.slice(start, end);

  const buttons = pageServices.map(s => {
    const priceRp = 3500; 
    const priceText = ` - Rp${priceRp.toLocaleString()}`;
    return [{ text: `${s.text}${priceText}`, callback_data: `service_${s.code}` }];
  });

  const navButtons = [];
  if (start > 0) navButtons.push({ text: "⬅️ Prev", callback_data: `btn_buy_page_${page - 1}` });
  if (end < serviceList.length) navButtons.push({ text: "➡️ Next", callback_data: `btn_buy_page_${page + 1}` });
  if (navButtons.length) buttons.push(navButtons);

  buttons.push([{ text: `💳 Saldo: Rp${userSaldo.toLocaleString()}`, callback_data: "btn_check_saldo" }]);
  buttons.push([{ text: "🏠 Kembali ke Menu Utama", callback_data: "btn_back_main" }]);

  return { inline_keyboard: buttons };
}

// ===========================
// Tombol Pemilihan Negara Saat Beli Nomor
// ===========================
function getCountryKeyboard(service, saldoUser) {
  const countriesList = [
    { text: "🇮🇩 Indonesia", code: "id" }, 
    { text: "🇲🇾 Malaysia", code: "my" },
    { text: "🇹🇭 Thailand", code: "th" },
    { text: "🇺🇸 Amerika Serikat", code: "us" }
    // ... (sisanya dihilangkan untuk fokus)
  ];

  const inline_keyboard = [];
  for (let i = 0; i < countriesList.length; i += 2) {
    const row = [];
    for (let j = i; j < i + 2 && j < countriesList.length; j++) {
      row.push({ text: countriesList[j].text, callback_data: `country_${countriesList[j].code}_${service}` });
    }
    inline_keyboard.push(row);
  }

  inline_keyboard.push([{ text: `💳 Saldo: Rp${saldoUser.toLocaleString()}`, callback_data: "btn_check_saldo" }]);
  inline_keyboard.push([{ text: "🏠 Kembali ke Menu Utama", callback_data: "btn_back_main" }]);

  return { inline_keyboard };
}

// ===========================
// Tombol Deposit Inline Preset
// ===========================
function getDepositKeyboard() {
  const depositOptions = [10000, 20000, 50000, 100000, 200000];
  const buttons = depositOptions.map(amount => [{ text: `💰 Rp${amount.toLocaleString()}`, callback_data: `deposit_${amount}` }]);
  buttons.push([{ text: "🏠 Kembali ke Menu Utama", callback_data: "btn_back_main" }]);
  return { inline_keyboard: buttons };
}

// ===========================
// Tombol Admin Tambah Saldo
// ===========================
function getAdminUserListKeyboard(page = 0) {
  const perPage = 5;
  const start = page * perPage;
  const end = start + perPage;
  const pageUsers = orders.slice(start, end);

  const buttons = pageUsers.map(u => [{ text: `${u.chat_id} - Saldo: Rp${(u.saldo||0).toLocaleString()}`, callback_data: `admin_addsaldo_${u.chat_id}` }]);

  const navButtons = [];
  if (start > 0) navButtons.push({ text: "⬅️ Prev", callback_data: `admin_user_page_${page - 1}` });
  if (end < orders.length) navButtons.push({ text: "➡️ Next", callback_data: `admin_user_page_${page + 1}` });
  if (navButtons.length) buttons.push(navButtons);

  buttons.push([{ text: "🏠 Kembali ke Menu Utama", callback_data: "btn_back_main" }]);
  return { inline_keyboard: buttons };
}

// ... (Fungsi getAdminDepositPresetKeyboard tetap)


// ===========================
// /start
// ===========================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id.toString();
  const photo = "https://files.catbox.moe/43qk85.jpg";

  if (!orders.some(o => o.chat_id === chatId)) {
    orders.push({ chat_id: chatId, system: "REGISTERED_USER", saldo: 0 });
    fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2));
  }

  bot.sendPhoto(chatId, photo, {
    caption:
`✨ *Selamat Datang di Virtual Number Bot* 🔹 Layanan aktivasi lengkap  
🔹 Proses cepat & otomatis  
🔹 Deposit QRIS tersedia  
🔹 Bantuan admin tersedia

Silakan pilih menu di bawah.`,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: getMainMenuKeyboard(chatId === ADMIN_ID) }
  });
});

// ===========================
// CALLBACK QUERY
// ===========================
const lastMessageId = {}; // penyimpanan message_id

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id.toString();
  const messageId = query.message.message_id;
  lastMessageId[chatId] = messageId;

  bot.answerCallbackQuery(query.id, { text: "Sedang diproses...", show_alert: false });

  try {
    const data = query.data;
    const prices = await fetchPrices(); 
    const user = orders.find(o => o.chat_id === chatId);
    const saldoUser = user?.saldo || 0;

    const checkSaldo = () => {
      if (saldoUser < 3500) { // Saldo minimal
        bot.sendMessage(chatId, "❌ Saldo Anda kurang dari Rp3.500. Silakan deposit terlebih dahulu.");
        return false;
      }
      return true;
    };

    if (data === "btn_supplier_balance" && chatId === ADMIN_ID) {
        const balance = await checkSupplierBalance();
        const msg = (typeof balance === 'number') 
            ? `✅ Saldo Virtusim: *$${balance.toFixed(2)}*`
            : `❌ Gagal cek saldo Virtusim: ${balance}`;
        return bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    }
    
    if (data === "btn_supplier_logs" && chatId === ADMIN_ID) {
        const logs = await getBalanceLogs();
        let message = `🧾 *LOG MUTASI SALDO VIRTUOSIM:* \n\n`;

        if (typeof logs === 'string') {
            message += `❌ ${logs}`;
        } else if (Array.isArray(logs) && logs.length > 0) {
            logs.slice(0, 10).forEach((log, index) => {
                message += `${index + 1}. Saldo: ${log.balance_after || 'N/A'}\n`; 
                message += `   Waktu: ${log.date || 'N/A'}\n`;
                message += `   Deskripsi: ${log.description || 'N/A'}\n`;
            });
        } else {
            message += `Tidak ditemukan riwayat mutasi.`;
        }
        return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }

    if (data === "btn_buy_page_0") {
      if (!checkSaldo()) return;
      const page = 0;
      return bot.editMessageReplyMarkup(
        getServicePageKeyboardWithSaldo(page, "id", prices, saldoUser),
        { chat_id: chatId, message_id: messageId }
      );
    }
    
    // ... (Logika Admin lainnya tetap)

    if (data === "btn_back_main") {
      return bot.editMessageReplyMarkup({ inline_keyboard: getMainMenuKeyboard(chatId === ADMIN_ID) }, { chat_id: chatId, message_id: messageId });
    }

    if (data === "btn_check_saldo") {
      return bot.sendMessage(chatId, `💰 Saldo Anda saat ini: Rp${saldoUser.toLocaleString()}`);
    }

    // ... (Logika Bantuan, Broadcast, Deposit tetap)

    if (data.startsWith("service_")) {
      if (!checkSaldo()) return;
      const service = data.split("_")[1];
      return bot.sendMessage(chatId, "Pilih negara:", { reply_markup: getCountryKeyboard(service, saldoUser) });
    }

    if (data.startsWith("country_")) {
      if (!checkSaldo()) return;

      const parts = data.split("_");
      const country = parts[1];
      const service = parts.slice(2).join("_");

      // HARGA DITETAPKAN
      const priceRp = 3500; 

      if (saldoUser < priceRp) 
        return bot.sendMessage(chatId, `❌ Saldo tidak cukup. Harga: Rp${priceRp.toLocaleString()}, Saldo Anda: Rp${saldoUser.toLocaleString()}`);

      const vnum = await buyVirtualNumber(service, country);
      if (vnum.error) return bot.sendMessage(chatId, `❌ Gagal membeli nomor: ${vnum.error}`);

      user.saldo -= priceRp;
      orders.push({
        chat_id: chatId,
        service,
        country,
        order_id: vnum.id,
        phone: vnum.phone,
        status: "PAID",
        price: priceRp
      });
      fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2));

      // Kirim notifikasi ke admin
      const layanan = service + " - " + country;
      bot.sendMessage(ADMIN_ID, `📝 User ${chatId} memesan layanan: ${layanan}\nNomor: ${vnum.phone}\nOrder ID: ${vnum.id}`);

      bot.sendMessage(chatId,
        `✅ Nomor berhasil dibuat!\n📞 ${vnum.phone}\n🆔 Order ID: ${vnum.id}\n💵 Harga: Rp${priceRp.toLocaleString()}\n💰 Saldo tersisa: Rp${user.saldo.toLocaleString()}`,
        { parse_mode: "Markdown" }
      );

      // Otomatis Cek OTP
      (async () => {
        let attempt = 0;
        const maxAttempts = 20; 
        const interval = setInterval(async () => {
            attempt++;
            const otpCode = await checkOTP(vnum.id);
            if (otpCode) {
                clearInterval(interval);
                bot.sendMessage(chatId, `🔑 Kode OTP untuk nomor ${vnum.phone}: ${otpCode}`);
            } else if (attempt >= maxAttempts) {
                clearInterval(interval);
                bot.sendMessage(chatId, `⚠️ Gagal mengambil kode OTP otomatis untuk nomor ${vnum.phone}. Silakan cek manual.`);
            }
        }, 5000);
      })();
    }

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Terjadi kesalahan saat memproses permintaan.");
  }
});

// ... (Bagian OCR Deposit Otomatis, AI CS, Broadcast, Server, Handler Pesan, tetap)
