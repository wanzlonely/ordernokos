"use strict";

const path = require("path");
const fs = require("fs");
const axios = require("axios");
const qs = require("querystring");
const moment = require("moment");
const momentTZ = require("moment-timezone");
const TelegramBot = require("node-telegram-bot-api");
const QRCode = require("qrcode");

moment.locale("id");

const {
  Bot: BotConfig,
  Owner,
  Atlantic,
  Panel,
  Links,
  Notification,
} = require("./settings");

// === UTIL DB SEDERHANA (SCRIPT) ===
// === UTIL DB SEDERHANA (UPDATE) ===
const DB_DIR = path.resolve(__dirname, "Database");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const DB_FILES = {
  script: path.join(DB_DIR, "Script.json"),
  pricing: path.join(DB_DIR, "Pricing.json"),
  orders: path.join(DB_DIR, "Orders.json"),
  warranty: path.join(DB_DIR, "Warranty.json"),
  users: path.join(DB_DIR, "Users.json"),
  saldo: path.join(DB_DIR, "Saldo.json"), // Tambah database saldo
  nokos: path.join(DB_DIR, "Nokos.json"), // Tambah database nokos orders
  SCRIPTS_DIR: path.join(DB_DIR, 'scripts'),
};

// Inisialisasi file DB
if (!fs.existsSync(DB_FILES.script)) writeJSON(DB_FILES.script, []);
if (!fs.existsSync(DB_FILES.pricing)) writeJSON(DB_FILES.pricing, DEFAULT_PRICING);
if (!fs.existsSync(DB_FILES.orders)) writeJSON(DB_FILES.orders, []);
if (!fs.existsSync(DB_FILES.warranty)) writeJSON(DB_FILES.warranty, []);
if (!fs.existsSync(DB_FILES.users)) writeJSON(DB_FILES.users, []);
if (!fs.existsSync(DB_FILES.saldo)) writeJSON(DB_FILES.saldo, {}); // Inisialisasi saldo
if (!fs.existsSync(DB_FILES.nokos)) writeJSON(DB_FILES.nokos, []); // Inisialisasi nokos

// Perbaikan untuk variabel yang hilang
const SCRIPTS_DIR = path.join(__dirname, 'scripts');

// Pastikan folder scripts exists
if (!fs.existsSync(SCRIPTS_DIR)) {
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  console.log('[SCRIPTS] Folder scripts created');
}

function saveUserToDB(userInfo) {
  try {
    const users = readJSON(DB_FILES.users, []);
    const existingUser = users.find(user => user.id === userInfo.id);
    
    if (!existingUser) {
      const userData = {
        id: userInfo.id,
        firstName: userInfo.first_name,
        lastName: userInfo.last_name || '',
        username: userInfo.username || '',
        languageCode: userInfo.language_code || 'id',
        firstSeen: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        active: true
      };
      
      users.push(userData);
      writeJSON(DB_FILES.users, users);
      console.log(`[USER DB] New user saved: ${userInfo.first_name} (${userInfo.id})`);
      return userData;
    } else {
      // Update last active
      const userIndex = users.findIndex(user => user.id === userInfo.id);
      users[userIndex].lastActive = new Date().toISOString();
      users[userIndex].active = true;
      writeJSON(DB_FILES.users, users);
      return users[userIndex];
    }
  } catch (e) {
    console.error("saveUserToDB error:", e.message);
    return null;
  }
}

// Default harga awal (boleh kamu ubah manual juga)
const DEFAULT_PRICING = {
  panel: {
    "1gb": 1000,
    "2gb": 2000,
    "3gb": 3000,
    "4gb": 4000,
    "5gb": 5000,
    "6gb": 6000,
    "7gb": 7000,
    "8gb": 8000,
    "9gb": 9000,
    "10gb": 10000,
    "unli": 11000,
  },
  reseller: 15000,
  pt: 15000,
  nokos: 9000, // Harga default nokos
};

// Resource panel per paket (RAM/Disk/CPU)
const PANEL_PLANS = {
  "1gb": { ram: "1000", disk: "1000", cpu: "40" },
  "2gb": { ram: "2000", disk: "1000", cpu: "60" },
  "3gb": { ram: "3000", disk: "2000", cpu: "80" },
  "4gb": { ram: "4000", disk: "2000", cpu: "100" },
  "5gb": { ram: "5000", disk: "3000", cpu: "120" },
  "6gb": { ram: "6000", disk: "3000", cpu: "140" },
  "7gb": { ram: "7000", disk: "4000", cpu: "160" },
  "8gb": { ram: "8000", disk: "4000", cpu: "180" },
  "9gb": { ram: "9000", disk: "5000", cpu: "200" },
  "10gb": { ram: "10000", disk: "5000", cpu: "220" },
  "unli": { ram: "0", disk: "0", cpu: "0" },
};

// Urutan tampil di /buypanel & /listharga
const PANEL_PLAN_ORDER = [
  "1gb",
  "2gb",
  "3gb",
  "4gb",
  "5gb",
  "6gb",
  "7gb",
  "8gb",
  "9gb",
  "10gb",
  "unli",
];

// === ORDER DATABASE HELPER ===
function saveOrderToDB(orderData) {
  try {
    const orders = readJSON(DB_FILES.orders, []);
    const order = {
      id: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: orderData.userId,
      chatId: orderData.chatId,
      type: orderData.type,
      price: orderData.price,
      total: orderData.total,
      paymentId: orderData.paymentId,
      reffId: orderData.reffId,
      username: orderData.payload?.username || orderData.payload?.scriptName || 'N/A',
      status: 'completed',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      payload: orderData.payload,
      warranty: {
        eligible: orderData.type === 'panel' || orderData.type === 'adp',
        claimed: false,
        claimCount: 0,
        maxClaims: 1,
        validUntil: new Date(Date.now() + (15 * 24 * 60 * 60 * 1000)).toISOString() // 15 hari
      }
    };
    
    orders.push(order);
    writeJSON(DB_FILES.orders, orders);
    console.log(`[ORDER DB] Order saved: ${order.id}`);
    return order;
  } catch (e) {
    console.error("saveOrderToDB error:", e.message);
    return null;
  }
}


// === NOTIFICATION TO CHANNEL ===
async function sendToChannel(message, options = {}) {
  try {
    if (!Notification.enabled || !Notification.channel_username) {
      console.log("[CHANNEL] Notification disabled or channel_username not set");
      return null;
    }

    const defaultOptions = {
      parse_mode: "HTML",
      disable_web_page_preview: true
    };

    const sentMessage = await bot.sendMessage(Notification.channel_username, message, {
      ...defaultOptions,
      ...options
    });

    console.log("[CHANNEL] Notification sent successfully");
    return sentMessage;

  } catch (error) {
    console.error("[CHANNEL] Error sending notification:", error.message);
    
    // Jika error karena bot belum join channel, beri warning
    if (error.message.includes('chat not found') || error.message.includes('FORBIDDEN')) {
      console.error("[CHANNEL] Bot must be added as admin to the channel first!");
    }
    
    return null;
  }
}

// === NOTIFICATION TEMPLATES ===
async function notifyOrderCompleted(order) {
  const message = `
🛒 <b>TRANSAKSI BERHASIL</b>

📦 <b>Jenis:</b> ${order.type.toUpperCase()}
👤 <b>User:</b> xxxxx
💰 <b>Total:</b> ${formatRupiah(order.total)}
🆔 <b>Order ID:</b> <code>${order.id}</code>
📅 <b>Waktu:</b> ${nowID()}

${getOrderDetails(order)}
  `.trim();

  await sendToChannel(message);
}

async function notifyNokosCompleted(nokosOrder) {
  const message = `
📱 <b>NOKOS BERHASIL</b>

🛒 <b>Layanan:</b> ${nokosOrder.layanan}
👤 <b>User:</b> xxxxxx
💰 <b>Harga:</b> ${formatRupiah(nokosOrder.harga)}
📞 <b>Nomor:</b> ${nokosOrder.target}
🆔 <b>Order ID:</b> <code>${nokosOrder.id}</code>
📅 <b>Waktu:</b> ${new Date(nokosOrder.completedAt).toLocaleString('id-ID')}

${nokosOrder.keterangan ? `📝 <b>Keterangan:</b> ${nokosOrder.keterangan}` : ''}
  `.trim();

  await sendToChannel(message);
}

async function notifyDepositCompleted(deposit) {
  const message = `
💰 <b>DEPOSIT BERHASIL</b>

👤 <b>User:</b> ${deposit.userId}
💵 <b>Nominal:</b> ${formatRupiah(deposit.nominal)}
🆔 <b>Trx ID:</b> <code>${deposit.paymentId}</code>
📅 <b>Waktu:</b> ${nowID()}

💳 <b>Saldo Baru:</b> ${formatRupiah(deposit.newSaldo)}
  `.trim();

  await sendToChannel(message);
}


// Helper function untuk detail order
function getOrderDetails(order) {
  switch (order.type) {
    case 'panel':
      return `
🔌 <b>Detail Panel:</b>
• Username: ${order.payload.username}
• RAM: ${order.payload.ram} MB
• Disk: ${order.payload.disk} MB
• CPU: ${order.payload.cpu}%
      `.trim();
    
    case 'adp':
      return `
🛠 <b>Detail Admin Panel:</b>
• Username: ${order.payload.username}
      `.trim();
    
    case 'script':
      return `
📜 <b>Detail Script:</b>
• Nama: ${order.payload.scriptName}
      `.trim();
    
    case 'reseller':
      return `
🤝 <b>Reseller Panel</b>
      `.trim();
    
    case 'userbot':
      return `
🏷 <b>Userbot / PT</b>
      `.trim();
    
    default:
      return '';
  }
}

async function downloadAndSaveScript(fileUrl, scriptName) {
  try {
    const scriptsDir = path.join(__dirname, 'scripts');
    if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir, { recursive: true });
    }
    
    const localPath = path.join(scriptsDir, `${scriptName}.zip`);
    
    const response = await axios({
      method: 'GET',
      url: fileUrl,
      responseType: 'stream',
      timeout: 30000
    });
    
    const writer = fs.createWriteStream(localPath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(localPath));
      writer.on('error', reject);
    });
    
  } catch (error) {
    console.error('Download script error:', error.message);
    throw new Error(`Gagal download script: ${error.message}`);
  }
}

// Tambahkan di bagian FUNGSI PENDUKUNG
function getActiveUsers() {
  try {
    const users = readJSON(DB_FILES.users, []);
    return users.filter(user => user.active === true);
  } catch (e) {
    return [];
  }
}

function getAllUsers() {
  return readJSON(DB_FILES.users, []);
}

function getUserCount() {
  return getAllUsers().length;
}

function getActiveUserCount() {
  return getActiveUsers().length;
}

// Hapus script lokal yang sudah tidak perlu
function cleanupOldScripts() {
  try {
    const scripts = readJSON(DB_FILES.script, []);
    const scriptsDir = path.join(__dirname, 'scripts');
    
    scripts.forEach(script => {
      if (script.localPath && !fs.existsSync(script.localPath)) {
        // Hapus dari database jika file lokal hilang
        const updatedScripts = scripts.filter(s => s.nama !== script.nama);
        writeJSON(DB_FILES.script, updatedScripts);
        console.log(`[CLEANUP] Removed missing script: ${script.nama}`);
      }
    });
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Jalankan cleanup periodically
setInterval(cleanupOldScripts, 24 * 60 * 60 * 1000); // Setiap 24 jam

//sistem nokos & saldo
// === UPDATE: handleDepositSuccess - Tambah notifikasi ===
async function handleDepositSuccess(order, payData) {
  const { chatId, userId, payload } = order;
  
  try {
    // Tambah saldo user
    const nominal = payload.nominal;
    const newSaldo = updateUserSaldo(userId, nominal);
    
    const successMessage = `
✅ *DEPOSIT BERHASIL*

💰 Nominal: ${formatRupiah(nominal)}
📊 Saldo Ditambahkan: ${formatRupiah(nominal)}
💳 Saldo Sekarang: ${formatRupiah(newSaldo)}

🆔 ID Transaksi: \`${order.paymentId}\`

Terima kasih telah melakukan deposit! 🎉
    `.trim();

    await sendText(chatId, successMessage, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📱 Beli Nokos", callback_data: "menu_buynokos" },
            { text: "💰 Cek Saldo", callback_data: "menu_saldo" }
          ]
        ]
      }
    });

    // KIRIM NOTIFIKASI KE CHANNEL
    await notifyDepositCompleted({
      userId: userId,
      nominal: nominal,
      paymentId: order.paymentId,
      newSaldo: newSaldo
    });

    // Hapus dari active orders
    delete activeOrders[userId];

  } catch (e) {
    console.error("handleDepositSuccess error:", e.message);
    
    const errorMessage = `
⚠️ Pembayaran sudah masuk, tapi terjadi error saat proses:

${e.message}

Silakan hubungi owner: ${Owner.username}
    `.trim();
    
    await sendText(chatId, errorMessage);
  }
}

// === HANDLE DEPOSIT FAILED ===
async function handleDepositFailed(order, reason) {
  const { chatId, userId } = order;
  
  try {
    await sendText(
      chatId,
      `${UI.no} Deposit *gagal*.\n` +
      `${UI.dot} Alasan: ${reason}`
    );
    
    delete activeOrders[userId];
  } catch {}
}

// === NOTIFICATION TO OWNER ===
async function notifyOwnerNewUser(userInfo) {
  try {
    const owners = Array.isArray(Owner.ids) ? Owner.ids : [Owner.ids];
    const ownerUsername = Owner.username || 'Owner';
    
    const notificationMessage = `
👤 *NEW USER STARTED BOT*

• Name: ${userInfo.first_name} ${userInfo.last_name || ''}
• Username: @${userInfo.username || 'N/A'}
• User ID: \`${userInfo.id}\`
• Language: ${userInfo.language_code || 'N/A'}
• Time: ${nowID()}

Total users today: ${getTodayUsersCount()}
    `.trim();

    for (const ownerId of owners) {
      try {
        await sendText(ownerId, notificationMessage, {
          reply_markup: {
            inline_keyboard: [
              [
                { 
                  text: "📊 Stats", 
                  callback_data: "owner_stats" 
                },
                { 
                  text: "👥 Users Today", 
                  callback_data: "owner_todayusers" 
                }
              ]
            ]
          }
        });
      } catch (e) {
        console.error(`Gagal kirim notifikasi ke owner ${ownerId}:`, e.message);
      }
    }
  } catch (e) {
    console.error("notifyOwnerNewUser error:", e.message);
  }
}

//sistem saldo
// === SALDO SYSTEM ===
function getUserSaldo(userId) {
  try {
    const saldoData = readJSON(DB_FILES.saldo, {});
    return Number(saldoData[userId] || 0);
  } catch (e) {
    return 0;
  }
}

function updateUserSaldo(userId, amount) {
  try {
    const saldoData = readJSON(DB_FILES.saldo, {});
    const currentSaldo = Number(saldoData[userId] || 0);
    const newSaldo = currentSaldo + Number(amount);
    
    saldoData[userId] = newSaldo;
    writeJSON(DB_FILES.saldo, saldoData);
    
    return newSaldo;
  } catch (e) {
    console.error("updateUserSaldo error:", e.message);
    return null;
  }
}

function setUserSaldo(userId, amount) {
  try {
    const saldoData = readJSON(DB_FILES.saldo, {});
    saldoData[userId] = Number(amount);
    writeJSON(DB_FILES.saldo, saldoData);
    return Number(amount);
  } catch (e) {
    console.error("setUserSaldo error:", e.message);
    return null;
  }
}

function getAllSaldos() {
  return readJSON(DB_FILES.saldo, {});
}

//sistem Nokos (Jangan di Ubah Aja !)
// === ARIE PULSA API HELPER ===
async function ariePulsaRequest(action, params = {}) {
  try {
    const baseParams = {
      api_key: "N3Jb5smKIVPRE7LJS0WkgWjHe4HVgRWk",
      action: action
    };

    const requestParams = { ...baseParams, ...params };

    console.log(`[AriePulsa ${action}] REQUEST =>`, requestParams);

    const response = await axios.post("https://ariepulsa.com/api/produk-otp", qs.stringify(requestParams), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 30000
    });

    console.log(`[AriePulsa ${action}] RESPONSE =>`, response.data);
    return response.data;

  } catch (error) {
    console.error(`[AriePulsa ${action}] ERROR =>`, error.message);
    throw new Error(`API Error: ${error.message}`);
  }
}

// === PERBAIKAN: GET NOKOS SERVICES ===
async function getNokosServices() {
  try {
    const result = await ariePulsaRequest("layanan");
    if (result.status && Array.isArray(result.data)) {
      return result.data.filter(service => service.tipe === "OTP");
    }
    throw new Error(result.data?.pesan || "Gagal mengambil layanan");
  } catch (error) {
    throw new Error(`Gagal mengambil layanan nokos: ${error.message}`);
  }
}

// Fungsi baru untuk mendapatkan layanan populer saja
async function getPopularNokosServices() {
  try {
    const result = await ariePulsaRequest("layanan");
    if (result.status && Array.isArray(result.data)) {
      const allServices = result.data.filter(service => service.tipe === "OTP");
      
      // Filter hanya layanan populer (Indonesia + beberapa global)
      const popularServices = allServices.filter(service => 
        service.kode_negara === "6" || // Indonesia
        [
          'ig', 'fb', 'wa', 'go', 'tw', 'mm', 'ok', 'vk', 
          'tg', 'wb', 'mb', 'uk', 'me', 'we', 'ma', 'yw'
        ].includes(service.kode_layanan)
      );
      
      return popularServices.slice(0, 50); // Maksimal 50 layanan
    }
    throw new Error(result.data?.pesan || "Gagal mengambil layanan");
  } catch (error) {
    throw new Error(`Gagal mengambil layanan nokos: ${error.message}`);
  }
}

// Fungsi untuk search layanan
async function searchNokosService(query) {
  try {
    const result = await ariePulsaRequest("layanan");
    if (result.status && Array.isArray(result.data)) {
      const allServices = result.data.filter(service => service.tipe === "OTP");
      
      return allServices.filter(service => 
        service.layanan.toLowerCase().includes(query.toLowerCase()) ||
        service.kode_layanan.toLowerCase().includes(query.toLowerCase())
      );
    }
    throw new Error(result.data?.pesan || "Gagal mencari layanan");
  } catch (error) {
    throw new Error(`Gagal mencari layanan: ${error.message}`);
  }
}

// Pesan nokos
// === PERBAIKAN: ORDER NOKOS ===
async function orderNokos(layanan, operator, kode_negara, target = "") {
  try {
    const params = {
      layanan: layanan,
      operator: operator,
      kode_negara: kode_negara
    };

    if (target) {
      params.target = target;
    }

    const result = await ariePulsaRequest("pemesanan", params);
    
    if (result.status) {
      return result.data;
    }
    throw new Error(result.data?.pesan || "Pemesanan gagal");
  } catch (error) {
    // Jika error, coba dengan operator any
    if (operator !== "any") {
      console.log(`[Nokos] Retry with operator any...`);
      try {
        const retryParams = {
          layanan: layanan,
          operator: "any",
          kode_negara: kode_negara
        };
        
        const retryResult = await ariePulsaRequest("pemesanan", retryParams);
        if (retryResult.status) {
          return retryResult.data;
        }
      } catch (retryError) {
        throw new Error(`Gagal memesan nokos: ${retryError.message}`);
      }
    }
    throw new Error(`Gagal memesan nokos: ${error.message}`);
  }
}

// Cek status nokos
async function checkNokosStatus(orderId) {
  try {
    const result = await ariePulsaRequest("status", { id: orderId });
    
    if (result.status) {
      return result.data;
    }
    throw new Error(result.data?.pesan || "Gagal cek status");
  } catch (error) {
    throw new Error(`Gagal cek status nokos: ${error.message}`);
  }
}

// Cancel nokos
async function cancelNokos(orderId) {
  try {
    const result = await ariePulsaRequest("cancel", { id: orderId });
    return result;
  } catch (error) {
    throw new Error(`Gagal cancel nokos: ${error.message}`);
  }
}

// === BROADCAST DOCUMENT FUNCTION ===
async function broadcastDocumentToAllUsers(fileId, fileName, caption, options = {}) {
  const { showProgressTo, testMode = false, testUserId = null } = options;
  const users = testMode && testUserId ? [getAllUsers().find(u => u.id == testUserId)].filter(Boolean) : getActiveUsers();
  
  let successCount = 0;
  let failCount = 0;
  const totalUsers = users.length;

  if (showProgressTo) {
    await sendText(showProgressTo, `📄 Starting document broadcast: ${fileName} to ${totalUsers} users...`);
  }

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    
    try {
      await bot.sendDocument(user.id, fileId, {
        caption: caption,
        parse_mode: null
      });
      successCount++;
      
      // Update progress
      if (showProgressTo && (i + 1) % 3 === 0) { // Lebih lambat untuk document
        await sendText(showProgressTo, 
          `📊 Progress: ${i + 1}/${totalUsers}\n` +
          `✅ Success: ${successCount}\n` +
          `❌ Failed: ${failCount}`
        );
      }
      
      // Delay lebih lama untuk document
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`Document broadcast failed to user ${user.id}:`, error.message);
      failCount++;
      
      // Mark user as inactive if blocked bot
      if (error.message.includes('blocked') || error.message.includes('deactivated')) {
        const users = getAllUsers();
        const userIndex = users.findIndex(u => u.id === user.id);
        if (userIndex !== -1) {
          users[userIndex].active = false;
          writeJSON(DB_FILES.users, users);
        }
      }
    }
  }

  const result = {
    total: totalUsers,
    success: successCount,
    failed: failCount,
    successRate: totalUsers > 0 ? ((successCount / totalUsers) * 100).toFixed(2) : 0
  };

  if (showProgressTo) {
    const resultMessage = testMode ? 
      `🧪 *TEST DOCUMENT BROADCAST COMPLETE*\n\n` +
      `📄 File: ${fileName}\n` +
      `✅ Sent to: 1 user (test mode)\n` +
      `📊 Status: ${successCount > 0 ? 'SUCCESS' : 'FAILED'}` :
      
      `📄 *DOCUMENT BROADCAST COMPLETE*\n\n` +
      `📁 File: ${fileName}\n` +
      `👥 Total Users: ${totalUsers}\n` +
      `✅ Success: ${successCount}\n` +
      `❌ Failed: ${failCount}\n` +
      `📊 Success Rate: ${result.successRate}%`;

    await sendText(showProgressTo, resultMessage);
  }

  return result;
}

// Tambahkan fungsi warranty yang hilang
function saveWarrantyClaim(claimData) {
  try {
    const claims = readJSON(DB_FILES.warranty, []);
    const claim = {
      id: `claim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...claimData,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    
    claims.push(claim);
    writeJSON(DB_FILES.warranty, claims);
    return claim;
  } catch (e) {
    console.error("saveWarrantyClaim error:", e.message);
    return null;
  }
}

function getPendingWarrantyClaims() {
  const claims = readJSON(DB_FILES.warranty, []);
  return claims.filter(claim => claim.status === 'pending');
}

function updateWarrantyClaim(claimId, updates) {
  const claims = readJSON(DB_FILES.warranty, []);
  const claimIndex = claims.findIndex(claim => claim.id === claimId);
  if (claimIndex !== -1) {
    claims[claimIndex] = { ...claims[claimIndex], ...updates };
    writeJSON(DB_FILES.warranty, claims);
    return true;
  }
  return false;
}

// === UPDATE: startNokosPolling - Tambah notifikasi ketika selesai ===
function startNokosPolling(nokosOrder) {
  let done = false;
  let count = 0;
  const maxPoll = 30;

  const poll = async () => {
    if (done || count >= maxPoll) return;
    count++;

    try {
      const status = await checkNokosStatus(nokosOrder.id);
      
      console.log(`[Nokos Status ${nokosOrder.id}] =>`, status.status);

      if (status.status === "Success") {
        done = true;
        
        // Update status di database
        const nokosOrders = readJSON(DB_FILES.nokos, []);
        const orderIndex = nokosOrders.findIndex(order => order.id === nokosOrder.id);
        
        if (orderIndex !== -1) {
          nokosOrders[orderIndex].status = "success";
          nokosOrders[orderIndex].keterangan = status.keterangan;
          nokosOrders[orderIndex].completedAt = new Date().toISOString();
          writeJSON(DB_FILES.nokos, nokosOrders);

          // KIRIM NOTIFIKASI KE CHANNEL
          await notifyNokosCompleted(nokosOrders[orderIndex]);
        }

        // Kirim notifikasi ke user
        const successMessage = `
✅ *OTP DITERIMA*

📱 Layanan: ${nokosOrder.layanan}
🎯 Nomor: ${nokosOrder.target}
🆔 Order ID: \`${nokosOrder.id}\`

📝 *Kode OTP:*
${status.keterangan}

💡 Simpan kode OTP dengan baik!
        `.trim();

        await sendText(nokosOrder.chatId, successMessage);
        return;
      }

      if (status.status === "Cancel" || status.status === "Error") {
        done = true;
        
        // Update status di database
        const nokosOrders = readJSON(DB_FILES.nokos, []);
        const orderIndex = nokosOrders.findIndex(order => order.id === nokosOrder.id);
        
        if (orderIndex !== -1) {
          nokosOrders[orderIndex].status = "failed";
          nokosOrders[orderIndex].keterangan = status.keterangan;
          writeJSON(DB_FILES.nokos, nokosOrders);
        }

        await sendText(nokosOrder.chatId, `❌ Order gagal: ${status.keterangan}`);
        return;
      }

      // Polling berikutnya
      const delay = Math.min(10000 * Math.pow(1.2, Math.floor(count / 3)), 30000);
      setTimeout(poll, delay);

    } catch (error) {
      console.error("nokos polling error:", error.message);
      const delay = Math.min(15000 * Math.pow(1.2, Math.floor(count / 3)), 45000);
      setTimeout(poll, delay);
    }
  };

  setTimeout(poll, 5000);
}

// === USER TRACKING ===
function getTodayUsersCount() {
  try {
    const today = new Date().toDateString();
    const usersFile = path.join(DB_DIR, "daily_users.json");
    const dailyUsers = readJSON(usersFile, {});
    
    return dailyUsers[today] || 0;
  } catch (e) {
    return 0;
  }
}

function incrementTodayUsers() {
  try {
    const today = new Date().toDateString();
    const usersFile = path.join(DB_DIR, "daily_users.json");
    const dailyUsers = readJSON(usersFile, {});
    
    dailyUsers[today] = (dailyUsers[today] || 0) + 1;
    writeJSON(usersFile, dailyUsers);
    
    return dailyUsers[today];
  } catch (e) {
    console.error("incrementTodayUsers error:", e.message);
    return 0;
  }
}

// === WARRANTY CLAIM SYSTEM ===
// === FUNGSI PENDUKUNG ===
function incrementTodayUsers() {
  try {
    const today = new Date().toDateString();
    const usersFile = path.join(DB_DIR, "daily_users.json");
    const dailyUsers = readJSON(usersFile, {});
    
    dailyUsers[today] = (dailyUsers[today] || 0) + 1;
    writeJSON(usersFile, dailyUsers);
    
    return dailyUsers[today];
  } catch (e) {
    console.error("incrementTodayUsers error:", e.message);
    return 0;
  }
}

async function notifyOwnerNewUser(userInfo) {
  try {
    const owners = Array.isArray(Owner.ids) ? Owner.ids : [Owner.ids];
    
    const notificationMessage = `
👤 NEW USER STARTED BOT

• Name: ${userInfo.first_name} ${userInfo.last_name || ''}
• Username: @${userInfo.username || 'N/A'}
• User ID: ${userInfo.id}
• Language: ${userInfo.language_code || 'N/A'}
• Time: ${nowID()}

Total users today: ${getTodayUsersCount()}
    `.trim();

    for (const ownerId of owners) {
      try {
        await sendText(ownerId, notificationMessage);
      } catch (e) {
        console.error(`Gagal kirim notifikasi ke owner ${ownerId}:`, e.message);
      }
    }
  } catch (e) {
    console.error("notifyOwnerNewUser error:", e.message);
  }
}

function getTodayUsersCount() {
  try {
    const today = new Date().toDateString();
    const usersFile = path.join(DB_DIR, "daily_users.json");
    const dailyUsers = readJSON(usersFile, {});
    
    return dailyUsers[today] || 0;
  } catch (e) {
    return 0;
  }
}

function saveUserToDB(userInfo) {
  try {
    const users = readJSON(DB_FILES.users, []);
    const existingUser = users.find(user => user.id === userInfo.id);
    
    if (!existingUser) {
      const userData = {
        id: userInfo.id,
        firstName: userInfo.first_name,
        lastName: userInfo.last_name || '',
        username: userInfo.username || '',
        languageCode: userInfo.language_code || 'id',
        firstSeen: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        active: true
      };
      
      users.push(userData);
      writeJSON(DB_FILES.users, users);
      console.log(`[USER DB] New user saved: ${userInfo.first_name} (${userInfo.id})`);
      return userData;
    } else {
      // Update last active
      const userIndex = users.findIndex(user => user.id === userInfo.id);
      users[userIndex].lastActive = new Date().toISOString();
      users[userIndex].active = true;
      writeJSON(DB_FILES.users, users);
      return users[userIndex];
    }
  } catch (e) {
    console.error("saveUserToDB error:", e.message);
    return null;
  }
}




function getOrdersByUser(userId) {
  const orders = readJSON(DB_FILES.orders, []);
  return orders.filter(order => order.userId === userId && order.status === 'completed');
}

function getOrderById(orderId) {
  const orders = readJSON(DB_FILES.orders, []);
  return orders.find(order => order.id === orderId);
}

function updateOrder(orderId, updates) {
  const orders = readJSON(DB_FILES.orders, []);
  const orderIndex = orders.findIndex(order => order.id === orderId);
  if (orderIndex !== -1) {
    orders[orderIndex] = { ...orders[orderIndex], ...updates };
    writeJSON(DB_FILES.orders, orders);
    return true;
  }
  return false;
}

function readJSON(file, def = []) {
  try {
    if (!fs.existsSync(file)) return def;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return def;
  }
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("writeJSON error:", e.message);
  }
}

// Generate URL gambar QR dari qr_string (fallback)
// Generate URL gambar QR dari qr_string (fallback)
async function generateLocalQr(qrString) {
  try {
    if (!qrString) {
      console.error("[QR GENERATOR] QR string kosong");
      return null;
    }

    const buffer = await QRCode.toBuffer(qrString, {
      errorCorrectionLevel: "M",
      type: 'png',
      quality: 0.8,
      scale: 8,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    console.log("[QR GENERATOR] QR berhasil digenerate");
    return buffer;
  } catch (err) {
    console.error("[QR GENERATOR ERROR]", err);
    return null;
  }
}

// === PTERODACTYL HELPER FUNCTIONS ===
async function pteroGetUsers() {
  try {
    const data = await pteroRequest("/api/application/users", "GET");
    return data.data || [];
  } catch (e) {
    throw new Error("Gagal mengambil data users: " + e.message);
  }
}

async function pteroGetServers() {
  try {
    const data = await pteroRequest("/api/application/servers", "GET");
    return data.data || [];
  } catch (e) {
    throw new Error("Gagal mengambil data servers: " + e.message);
  }
}

async function pteroDeleteServer(serverId) {
  try {
    await pteroRequest(`/api/application/servers/${serverId}`, "DELETE");
    return true;
  } catch (e) {
    throw new Error("Gagal menghapus server: " + e.message);
  }
}

async function pteroDeleteUser(userId) {
  try {
    await pteroRequest(`/api/application/users/${userId}`, "DELETE");
    return true;
  } catch (e) {
    throw new Error("Gagal menghapus user: " + e.message);
  }
}

async function pteroGetUserServers(userId) {
  try {
    const servers = await pteroGetServers();
    return servers.filter(server => server.attributes.user === userId);
  } catch (e) {
    throw new Error("Gagal mengambil server user: " + e.message);
  }
}

// Helper untuk format resources
function formatResources(server) {
  const s = server.attributes;
  const ram = s.limits.memory === 0 ? "Unlimited" : `${s.limits.memory} MB`;
  const disk = s.limits.disk === 0 ? "Unlimited" : `${s.limits.disk} MB`;
  const cpu = s.limits.cpu === 0 ? "Unlimited" : `${s.limits.cpu}%`;
  
  return { ram, disk, cpu };
}


// Inisialisasi file DB
if (!fs.existsSync(DB_FILES.script)) writeJSON(DB_FILES.script, []);
if (!fs.existsSync(DB_FILES.pricing)) writeJSON(DB_FILES.pricing, DEFAULT_PRICING);

// Helper ambil & simpan pricing
function getPricing() {
  const data = readJSON(DB_FILES.pricing, DEFAULT_PRICING);
  return {
    panel: { ...DEFAULT_PRICING.panel, ...(data.panel || {}) },
    reseller:
      typeof data.reseller === "number"
        ? data.reseller
        : DEFAULT_PRICING.reseller,
    pt: typeof data.pt === "number" ? data.pt : DEFAULT_PRICING.pt,
  };
}

function savePricing(p) {
  writeJSON(DB_FILES.pricing, p);
}


// === UI HELPER ===
const UI = {
  bTop: "╭" + "─".repeat(24) + "╮",
  bBot: "╰" + "─".repeat(24) + "╯",
  star: "✦",
  dot: "•",
  dash: "╌".repeat(34),
  ok: "✅",
  no: "❌",
  warn: "⚠️",

  box(title) {
    return [this.bTop, `│  ${this.star} *${title}*`, this.bBot].join("\n");
  },
  foot(note = "") {
    return `${note ? note + "\n" : ""}${this.dash}`;
  },
};

function nowID() {
  return momentTZ().tz("Asia/Jakarta").format("DD-MM-YYYY HH:mm:ss");
}

function formatRupiah(n = 0) {
  const num = Number(n) || 0;
  return "Rp" + num.toLocaleString("id-ID");
}

function isOwner(msg) {
  const id = msg.from?.id;
  if (!Owner.ids) return false;
  if (Array.isArray(Owner.ids)) return Owner.ids.includes(id);
  return id === Owner.ids;
}

function generateRandomUnique(min = 110, max = 250) {
  const diff = max - min;
  return min + Math.floor(Math.random() * (diff + 1));
}

// =====================
// ATLANTIC HELPERS
// =====================
const ATL_BASE = "https://atlantich2h.com";
const ATL_KEY  = Atlantic.ApiKey; // pastikan ini terisi di settings.js!

function form(x) {
  return new URLSearchParams(x).toString();
}

// Helper umum POST ke Atlantic
async function postAtl(path, params = {}) {
  try {
    const res = await axios.post(
      ATL_BASE + path,
      qs.stringify(params),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    console.log(`[postAtl ${path}] RESPONSE =>`, res.data);
    return res.data;
  } catch (e) {
    console.error(`[postAtl ${path}] ERROR =>`, e?.response?.data || e.message);
    return null;
  }
}


// === DEPOSIT CREATE ===
async function atlDepositCreate(reffId, nominal) {
  if (!ATL_KEY) throw new Error("Atlantic.ApiKey belum diisi di settings.js");

  const url = `${ATL_BASE}/deposit/create`;

  const body = {
    api_key: ATL_KEY,
    reff_id: String(reffId),
    nominal: Number(nominal),
    type: "ewallet",
    metode: "QRIS",
  };

  console.log("[Atlantic /deposit/create] REQUEST =>", body);

  try {
    const res = await axios.post(url, qs.stringify(body), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
      validateStatus: () => true,
    });

    console.log("[Atlantic /deposit/create] FULL RESPONSE =>", JSON.stringify(res.data, null, 2));

    if (!res.data?.data) {
      throw new Error(res.data?.message || "Create deposit gagal");
    }

    // Debug QR data
    const qrData = res.data.data;
    console.log("[QR DEBUG] QR Image URL:", qrData.qr_image);
    console.log("[QR DEBUG] QR String:", qrData.qr_string ? qrData.qr_string.substring(0, 100) + "..." : "NULL");
    console.log("[QR DEBUG] QR Data keys:", Object.keys(qrData));

    return res.data;
  } catch (e) {
    console.error("[Atlantic /deposit/create] ERROR =>", e?.response?.data || e.message);
    throw new Error(e?.response?.data?.message || e.message || "Gagal create deposit");
  }
}

// === DEPOSIT INSTANT (CORRECTED VERSION) ===
async function atlDepositInstant(id, instant = true) {
  if (!ATL_KEY) throw new Error("Atlantic.ApiKey kosong (belum dikonfigurasi).");
  
  const url = `${ATL_BASE}/deposit/instant`;
  const body = {
    api_key: ATL_KEY,
    id: String(id),
    action: instant ? 'true' : 'false'
  };

  console.log("[Atlantic /deposit/instant] REQUEST =>", body);

  try {
    const res = await axios.post(url, qs.stringify(body), {
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      timeout: 15000,
      validateStatus: () => true,
    });

    console.log("[Atlantic /deposit/instant] RESPONSE =>", res.data);

    if (res.data?.status === false) {
      throw new Error(res.data?.message || "Instant deposit gagal");
    }

    return res.data;
  } catch (e) {
    console.error("[Atlantic /deposit/instant] ERROR =>", e?.response?.data || e.message);
    throw new Error(e?.response?.data?.message || e.message || "Gagal proses instant deposit");
  }
}

// === DEPOSIT STATUS ===
async function atlDepositStatus(id) {
  if (!ATL_KEY) throw new Error("Atlantic.ApiKey kosong (belum dikonfigurasi).");
  
  const body = {
    api_key: ATL_KEY,
    id: String(id)
  };

  console.log("[Atlantic /deposit/status] REQUEST =>", body);

  try {
    const res = await axios.post(`${ATL_BASE}/deposit/status`, qs.stringify(body), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
      validateStatus: () => true,
    });

    console.log("[Atlantic /deposit/status] RESPONSE =>", res.data);
    return res.data;
  } catch (e) {
    console.error("[Atlantic /deposit/status] ERROR =>", e?.response?.data || e.message);
    throw new Error(e?.response?.data?.message || e.message || "Gagal cek status deposit");
  }
}

// === DEPOSIT CANCEL ===
async function atlDepositCancel(id) {
  if (!ATL_KEY) throw new Error("Atlantic.ApiKey kosong (belum dikonfigurasi).");
  
  const body = {
    api_key: ATL_KEY,
    id: String(id)
  };

  console.log("[Atlantic /deposit/cancel] REQUEST =>", body);

  try {
    const res = await axios.post(`${ATL_BASE}/deposit/cancel`, qs.stringify(body), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
      validateStatus: () => true,
    });

    console.log("[Atlantic /deposit/cancel] RESPONSE =>", res.data);
    return res.data;
  } catch (e) {
    console.error("[Atlantic /deposit/cancel] ERROR =>", e?.response?.data || e.message);
    throw new Error(e?.response?.data?.message || e.message || "Gagal cancel deposit");
  }
}

// === BROADCAST SYSTEM ===
async function broadcastTextToAllUsers(text, options = {}) {
  const { showProgressTo, testMode = false, testUserId = null } = options;
  const users = testMode && testUserId ? [getAllUsers().find(u => u.id == testUserId)].filter(Boolean) : getActiveUsers();
  
  let successCount = 0;
  let failCount = 0;
  const totalUsers = users.length;

  if (showProgressTo) {
    await sendText(showProgressTo, `📢 Starting broadcast to ${totalUsers} users...`);
  }

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    
    try {
      await sendText(user.id, text);
      successCount++;
      
      // Update progress every 10 users
      if (showProgressTo && (i + 1) % 10 === 0) {
        await sendText(showProgressTo, 
          `📊 Progress: ${i + 1}/${totalUsers}\n` +
          `✅ Success: ${successCount}\n` +
          `❌ Failed: ${failCount}`
        );
      }
      
      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`Broadcast failed to user ${user.id}:`, error.message);
      failCount++;
      
      // Mark user as inactive if blocked bot
      if (error.message.includes('blocked') || error.message.includes('deactivated')) {
        const users = getAllUsers();
        const userIndex = users.findIndex(u => u.id === user.id);
        if (userIndex !== -1) {
          users[userIndex].active = false;
          writeJSON(DB_FILES.users, users);
        }
      }
    }
  }

  const result = {
    total: totalUsers,
    success: successCount,
    failed: failCount,
    successRate: totalUsers > 0 ? ((successCount / totalUsers) * 100).toFixed(2) : 0
  };

  if (showProgressTo) {
    const resultMessage = testMode ? 
      `🧪 *TEST BROADCAST COMPLETE*\n\n` +
      `✅ Sent to: 1 user (test mode)\n` +
      `📊 Status: ${successCount > 0 ? 'SUCCESS' : 'FAILED'}` :
      
      `📢 *BROADCAST COMPLETE*\n\n` +
      `👥 Total Users: ${totalUsers}\n` +
      `✅ Success: ${successCount}\n` +
      `❌ Failed: ${failCount}\n` +
      `📊 Success Rate: ${result.successRate}%`;

    await sendText(showProgressTo, resultMessage);
  }

  return result;
}

//sistem
// === ATLANTIC TRANSFER HELPER ===
async function atlanticTransfer(nominal, note = "Withdraw Saldo Bot") {
  try {
    const reffId = `wd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const body = {
      api_key: Atlantic.ApiKey,
      ref_id: reffId,
      kode_bank: Atlantic.wd_balance.bank_code,
      nomor_akun: Atlantic.wd_balance.destination_number,
      nama_pemilik: Atlantic.wd_balance.destination_name,
      nominal: Number(nominal),
      email: "bot@telegram.com",
      phone: Atlantic.wd_balance.destination_number,
      note: note
    };

    console.log("[Atlantic Transfer] REQUEST =>", body);

    const response = await axios.post("https://atlantich2h.com/transfer/create", qs.stringify(body), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 15000
    });

    console.log("[Atlantic Transfer] RESPONSE =>", response.data);

    if (!response.data?.data) {
      throw new Error(response.data?.message || "Transfer gagal");
    }

    return response.data.data;

  } catch (error) {
    console.error("[Atlantic Transfer] ERROR =>", error.message);
    throw new Error(`Gagal membuat transfer: ${error.message}`);
  }
}

// Cek status transfer
async function atlanticTransferStatus(transferId) {
  try {
    const body = {
      api_key: Atlantic.ApiKey,
      id: String(transferId)
    };

    const response = await axios.post("https://atlantich2h.com/transfer/status", qs.stringify(body), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 15000
    });

    console.log("[Atlantic Transfer Status] RESPONSE =>", response.data);
    return response.data;

  } catch (error) {
    console.error("[Atlantic Transfer Status] ERROR =>", error.message);
    throw new Error(`Gagal cek status transfer: ${error.message}`);
  }
}

// Cek saldo Atlantic
async function atlanticCheckBalance() {
  try {
    const body = {
      api_key: Atlantic.ApiKey
    };

    const response = await axios.post("https://atlantich2h.com/get_profile", qs.stringify(body), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 15000
    });

    console.log("[Atlantic Balance] RESPONSE =>", response.data);

    if (!response.data?.data) {
      throw new Error(response.data?.message || "Gagal mengambil saldo");
    }

    return response.data.data;

  } catch (error) {
    console.error("[Atlantic Balance] ERROR =>", error.message);
    throw new Error(`Gagal cek saldo: ${error.message}`);
  }
}

async function broadcastPhotoToAllUsers(photoUrl, caption, options = {}) {
  const { showProgressTo, testMode = false, testUserId = null } = options;
  const users = testMode && testUserId ? [getAllUsers().find(u => u.id == testUserId)].filter(Boolean) : getActiveUsers();
  
  let successCount = 0;
  let failCount = 0;
  const totalUsers = users.length;

  if (showProgressTo) {
    await sendText(showProgressTo, `🖼️ Starting photo broadcast to ${totalUsers} users...`);
  }

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    
    try {
      await bot.sendPhoto(user.id, photoUrl, {
        caption: caption,
        parse_mode: null
      });
      successCount++;
      
      // Update progress
      if (showProgressTo && (i + 1) % 5 === 0) {
        await sendText(showProgressTo, 
          `📊 Progress: ${i + 1}/${totalUsers}\n` +
          `✅ Success: ${successCount}\n` +
          `❌ Failed: ${failCount}`
        );
      }
      
      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      console.error(`Photo broadcast failed to user ${user.id}:`, error.message);
      failCount++;
      
      // Mark user as inactive if blocked bot
      if (error.message.includes('blocked') || error.message.includes('deactivated')) {
        const users = getAllUsers();
        const userIndex = users.findIndex(u => u.id === user.id);
        if (userIndex !== -1) {
          users[userIndex].active = false;
          writeJSON(DB_FILES.users, users);
        }
      }
    }
  }

  const result = {
    total: totalUsers,
    success: successCount,
    failed: failCount,
    successRate: totalUsers > 0 ? ((successCount / totalUsers) * 100).toFixed(2) : 0
  };

  if (showProgressTo) {
    const resultMessage = testMode ? 
      `🧪 *TEST PHOTO BROADCAST COMPLETE*\n\n` +
      `✅ Sent to: 1 user (test mode)\n` +
      `📊 Status: ${successCount > 0 ? 'SUCCESS' : 'FAILED'}` :
      
      `🖼️ *PHOTO BROADCAST COMPLETE*\n\n` +
      `👥 Total Users: ${totalUsers}\n` +
      `✅ Success: ${successCount}\n` +
      `❌ Failed: ${failCount}\n` +
      `📊 Success Rate: ${result.successRate}%`;

    await sendText(showProgressTo, resultMessage);
  }

  return result;
}


// === PTERODACTYL HELPER ===
const PDomain = Panel.domain.replace(/\/+$/, "");
const PAppKey = Panel.appKey;
const PClientKey = Panel.clientKey;

async function pteroRequest(path, method = "GET", body = null, useClient = false) {
  const url = `${PDomain}${path}`;
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${useClient ? PClientKey : PAppKey}`,
  };

  try {
    const res = await axios({
      url,
      method,
      headers,
      data: body ? JSON.stringify(body) : undefined,
      timeout: 20000,
    });
    return res.data;
  } catch (e) {
    console.error("[Pterodactyl]", e.response?.data || e.message);
    throw new Error(JSON.stringify(e.response?.data || e.message));
  }
}

async function pteroCreateUser(username, firstName, lastName, root_admin = false) {
  const email = `${username}@gmail.com`;
  const password = `${username}001`;

  const body = {
    email,
    username: username.toLowerCase(),
    first_name: firstName,
    last_name: lastName,
    language: "en",
    password,
    root_admin,
  };

  const data = await pteroRequest("/api/application/users", "POST", body);
  return { user: data.attributes, password };
}

async function pteroCreateServer(userId, name, desc, resources) {
  const eggData = await pteroRequest(
    `/api/application/nests/${Panel.nestId}/eggs/${Panel.eggId}`,
    "GET"
  );
  const startup = eggData.attributes.startup;

  const body = {
    name,
    description: desc,
    user: userId,
    egg: parseInt(Panel.eggId),
    docker_image: "ghcr.io/parkervcp/yolks:nodejs_20",
    startup,
    environment: {
      INST: "npm",
      USER_UPLOAD: "0",
      AUTO_UPDATE: "0",
      CMD_RUN: "npm start",
    },
    limits: {
      memory: resources.ram,
      swap: 0,
      disk: resources.disk,
      io: 500,
      cpu: resources.cpu,
    },
    feature_limits: {
      databases: 5,
      backups: 5,
      allocations: 5,
    },
    deploy: {
      locations: [parseInt(Panel.location)],
      dedicated_ip: false,
      port_range: [],
    },
  };

  const data = await pteroRequest("/api/application/servers", "POST", body);
  return data.attributes;
}

// === ORDER STATE ===
/**
 * activeOrders[userId] = {
 *   userId,
 *   chatId,
 *   type: 'panel' | 'adp' | 'reseller' | 'pt' | 'script',
 *   price,
 *   total,
 *   paymentId,
 *   reffId,
 *   expireAt,
 *   payload,
 *   payMsg: { chatId, messageId }
 * }
 */
const activeOrders = {};

// === INIT TELEGRAM BOT ===
const bot = new TelegramBot(BotConfig.token, { polling: true });
console.log(`[BOT] ${BotConfig.name} connected. Polling started...`);

// Helper kirim text dengan error handling yang better
async function sendText(chatId, text, extra = {}) {
  try {
    // Default tanpa parse_mode untuk menghindari error
    const options = {
      parse_mode: null,
      ...extra,
    };
    
    return await bot.sendMessage(chatId, text, options);
  } catch (error) {
    console.error("sendText error:", error.message);
    
    // Jika masih error, coba dengan teks yang disederhanakan
    try {
      const cleanText = text
        .replace(/\*/g, '') // Hapus *
        .replace(/_/g, '')  // Hapus _
        .replace(/`/g, '')  // Hapus `
        .replace(/\[/g, '') // Hapus [
        .replace(/\]/g, '') // Hapus ]
        .replace(/\(/g, '') // Hapus (
        .replace(/\)/g, ''); // Hapus )
      
      return await bot.sendMessage(chatId, cleanText, {
        parse_mode: null,
        ...extra,
      });
    } catch (finalError) {
      console.error("Final sendText error:", finalError.message);
      throw finalError;
    }
  }
}

// === COMMANDS LIST ===
bot.setMyCommands([
  { command: "start", description: "Mulai bot" },
  { command: "buypanel", description: "Beli panel Pterodactyl" },
  { command: "buyadp", description: "Beli admin panel" },
  { command: "buyresellerpanel", description: "Beli reseller panel" },
  { command: "buyuserbot", description: "Beli Userbot (link grup)" },
  { command: "buysc", description: "Beli script bot" },
  { command: "ownermenu", description: "Menu owner (khusus owner)" },
]);

bot.onText(/\/(start|menu)/, async (msg) => {
  const chatId = msg.chat.id;
  const userInfo = msg.from;

  // Notifikasi ke owner untuk new user (hanya di /start)
  if (msg.text === '/start') {
    try {
      // Increment daily users counter
      const todayCount = incrementTodayUsers();
      
      // Kirim notifikasi ke owner
      await notifyOwnerNewUser(userInfo);
      
      console.log(`[NEW USER] ${userInfo.first_name} (${userInfo.id}) - Total today: ${todayCount}`);
    } catch (e) {
      console.error("Error in start handler:", e.message);
    }
  }

  // Save user to database
  saveUserToDB(userInfo);

  const nama = userInfo.first_name || "User";
  
  const captionText = `
✨ *${BotConfig.name}*

Halo ${nama} 👋

📋 *Layanan yang tersedia:*
• 🔌 Panel Pterodactyl Siap Pakai
• 🛠 Admin Panel (Full Root Access)  
• 🤝 Reseller Panel (khusus penjual)
• 🏷 Buy Userbot
• 📜 Script Bot (.zip) Siap Deploy

🆕 *Fitur Baru:*
• 🛡️ Garansi 15 Hari
• 📦 Database Order
• ⚡ Instant Processing

💳 *Metode Pembayaran:*
• QRIS Dinamis via Atlantic H2H

_Gunakan menu di bawah untuk mulai!_
  `.trim();

  // Dalam handler /start, update keyboard:
const keyboard = [
  [
    { text: "🔌 Beli Panel", callback_data: "menu_buypanel" },
    { text: "🛠 Admin Panel", callback_data: "menu_buyadp" },
  ],
  [
    { text: "🤝 Reseller", callback_data: "menu_buyreseller" },
    { text: "🏷 Beli Userbot", callback_data: "menu_buyuserbot" },
  ],
  [
    { text: "📜 Beli Script", callback_data: "menu_buysc" },
    { text: "📱 Beli Nokos", callback_data: "menu_buynokos" },
  ],
  [
    { text: "💰 Cek Saldo", callback_data: "menu_saldo" },
    { text: "📦 My Orders", callback_data: "menu_myorders" },
  ],
  [
    { text: "👤 Kontak Owner", callback_data: "menu_owner" },
  ],
];

  if (isOwner(msg)) {
    keyboard.push([{ text: "🧑‍💻 Owner Menu", callback_data: "menu_ownermenu" }]);
  }

  // === KIRIM DENGAN THUMBNAIL PNG LOCAL ===
  try {
    // Cek beberapa kemungkinan path untuk thumbnail
    const possiblePaths = [
      path.join(__dirname, 'default.png')
    ];

    let thumbnailSent = false;

    for (const thumbnailPath of possiblePaths) {
      if (fs.existsSync(thumbnailPath)) {
        try {
          await bot.sendPhoto(chatId, thumbnailPath, {
            caption: captionText,
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: keyboard },
          });
          thumbnailSent = true;
          console.log(`[THUMBNAIL] Success with local PNG: ${thumbnailPath}`);
          break; // Berhenti jika berhasil
        } catch (error) {
          console.log(`[THUMBNAIL] Failed with ${thumbnailPath}:`, error.message);
          continue; // Coba path berikutnya
        }
      }
    }

    // Jika tidak ada thumbnail yang berhasil, kirim text saja
    if (!thumbnailSent) {
      throw new Error("No thumbnail found");
    }

  } catch (error) {
    console.error("[THUMBNAIL] All methods failed:", error.message);
    
    // Fallback: kirim text saja
    await sendText(chatId, captionText, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    });
    console.log("[THUMBNAIL] Fallback to text only");
  }
});


// === OWNER STATS COMMANDS ===
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) return;

  try {
    const orders = readJSON(DB_FILES.orders, []);
    const today = new Date().toDateString();
    const todayUsers = getTodayUsersCount();
    
    // Hitung stats
    const totalOrders = orders.length;
    const todayOrders = orders.filter(order => 
      new Date(order.createdAt).toDateString() === today
    ).length;
    
    const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
    const todayRevenue = todayOrders.reduce((sum, order) => sum + order.total, 0);
    
    const panelOrders = orders.filter(order => order.type === 'panel').length;
    const adminOrders = orders.filter(order => order.type === 'adp').length;
    const scriptOrders = orders.filter(order => order.type === 'script').length;

    const statsMessage = `
📊 *BOT STATISTICS*

👥 Users Today: *${todayUsers}*
📦 Total Orders: *${totalOrders}*
🛒 Today Orders: *${todayOrders}*

💰 Total Revenue: *${formatRupiah(totalRevenue)}*
💸 Today Revenue: *${formatRupiah(todayRevenue)}*

📈 Order Breakdown:
• 🔌 Panel: *${panelOrders}*
• 🛠 Admin: *${adminOrders}* 
• 📜 Script: *${scriptOrders}*
• 🤝 Reseller: *${orders.filter(o => o.type === 'reseller').length}*
• 🏷 PT: *${orders.filter(o => o.type === 'pt').length}*

⏰ Last Update: ${nowID()}
    `.trim();

    await sendText(chatId, statsMessage, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔄 Refresh", callback_data: "owner_stats" },
            { text: "👥 Today Users", callback_data: "owner_todayusers" }
          ]
        ]
      }
    });

  } catch (e) {
    console.error("stats error:", e.message);
    await sendText(chatId, "❌ Gagal mengambil statistics.");
  }
});

// === /buypanel username ===
bot.onText(/\/buypanel(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = (match[1] || "").trim().toLowerCase();

  if (!username) {
    return sendText(
      chatId,
      `${UI.box("🔌 PEMBELIAN PANEL")}\n` +
        `${UI.dot} Format: /buypanel username\n` +
        `${UI.dot} Contoh: /buypanel skyzopedia\n\n` +
        UI.foot("Setelah itu bot akan minta kamu pilih RAM.")
    );
  }

  if (activeOrders[userId]) {
    return sendText(
      chatId,
      `${UI.warn} Kamu masih punya transaksi yang belum selesai.\n` +
        `Selesaikan atau batalkan transaksi sebelumnya dulu.`
    );
  }

      const pricing = getPricing();

    const ramOptions = PANEL_PLAN_ORDER.map((key) => {
      const plan = PANEL_PLANS[key];
      const harga = Number(
        pricing.panel[key] ?? DEFAULT_PRICING.panel[key] ?? 0
      );
      const label = key === "unli" ? "Unlimited" : key.toUpperCase();
      return {
        key,
        label,
        price: harga,
        ram: plan.ram,
        disk: plan.disk,
        cpu: plan.cpu,
      };
    });


  const keyboard = ramOptions.reduce((rows, opt, i) => {
    if (i % 2 === 0) rows.push([]);
    rows[rows.length - 1].push({
      text: `${opt.label} • ${formatRupiah(opt.price)}`,
      callback_data: `panel_ram:${opt.key}:${username}`,
    });
    return rows;
  }, []);

  await sendText(
    chatId,
    `${UI.box("🔌 PEMBELIAN PANEL")}\n` +
      `${UI.dot} Username: *${username}*\n` +
      `${UI.dot} Pilih paket RAM yang kamu mau:`,
    { reply_markup: { inline_keyboard: keyboard } }
  );
});

// === /buyadp username ===
bot.onText(/\/buyadp(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = (match[1] || "").trim().toLowerCase();

  if (!username) {
    return sendText(
      chatId,
      `${UI.box("🛠 PEMBELIAN ADMIN PANEL")}\n` +
        `${UI.dot} Format: /buyadp username\n` +
        `${UI.dot} Contoh: /buyadp skyzopedia\n\n` +
        `${UI.dot} Admin panel = akun *root_admin* Pterodactyl.\n` +
        UI.foot("Setelah bayar, kamu dapat akses full admin panel.")
    );
  }

  if (activeOrders[userId]) {
    return sendText(
      chatId,
      `${UI.warn} Kamu masih punya transaksi yang belum selesai.\n` +
        `Selesaikan atau batalkan transaksi sebelumnya dulu.`
    );
  }

  const harga = 20000;
  await createOrderPayment(msg, {
    type: "adp",
    price: harga,
    title: "Admin Panel Pterodactyl",
    payload: { username },
  });
});

// === /buyresellerpanel ===
bot.onText(/\/buyresellerpanel/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (activeOrders[userId]) {
    return sendText(
      chatId,
      `${UI.warn} Kamu masih punya transaksi yang belum selesai.\n` +
        `Selesaikan atau batalkan transaksi sebelumnya dulu.`
    );
  }

      const pricing = getPricing();
    const harga = Number(pricing.reseller ?? DEFAULT_PRICING.reseller);

    await createOrderPayment(msg, {
      type: "reseller",
      price: harga,
      title: "Reseller Panel",
      payload: {},
    });

});

// === /buyuserbot === (kirim link grup PT)
bot.onText(/\/buyuserbot/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (activeOrders[userId]) {
    return sendText(
      chatId,
      `${UI.warn} Kamu masih punya transaksi yang belum selesai.\n` +
        `Selesaikan atau batalkan transaksi sebelumnya dulu.`
    );
  }

      const pricing = getPricing();
    const harga = Number(pricing.pt ?? DEFAULT_PRICING.pt);

    await createOrderPayment(msg, {
      type: "userbot",
      price: harga,
      title: "Userbot",
      payload: {},
    });

});

// === /buysc [namaScript?] ===
bot.onText(/\/buysc(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (match[1] || "").trim();

  const scripts = readJSON(DB_FILES.script, []);
  if (!scripts.length) {
    return sendText(chatId, `${UI.warn} Belum ada script yang tersedia.`);
  }

  if (!text) {
    const keyboard = scripts.map((sc) => [
      {
        text: `${sc.nama} • ${formatRupiah(sc.harga)}`,
        callback_data: `sc_buy:${sc.nama}`,
      },
    ]);

    return sendText(
      chatId,
      `${UI.box("📜 PEMBELIAN SCRIPT")}\n` +
        `${UI.dot} Pilih script yang ingin kamu beli:`,
      { reply_markup: { inline_keyboard: keyboard } }
    );
  }

  if (activeOrders[userId]) {
    return sendText(
      chatId,
      `${UI.warn} Kamu masih punya transaksi yang belum selesai.\n` +
        `Selesaikan atau batalkan transaksi sebelumnya dulu.`
    );
  }

  const sc = scripts.find((s) => s.nama.toLowerCase() === text.toLowerCase());
  if (!sc) {
    return sendText(
      chatId,
      `${UI.no} Script tidak ditemukan.\n` +
        `Ketik /buysc tanpa nama untuk melihat list script.`
    );
  }

  await createOrderPayment(msg, {
    type: "script",
    price: Number(sc.harga),
    title: `Script: ${sc.nama}`,
    payload: { scriptName: sc.nama },
  });
});

// === OWNER: /addsc (reply .zip) ===
bot.onText(/\/addsc(?:\s+(.+))?/, async (msg, match) => {
  if (!isOwner(msg)) return;
  const chatId = msg.chat.id;
  const argText = (match[1] || "").trim();

  if (!argText || !msg.reply_to_message || !msg.reply_to_message.document) {
    return sendText(
      chatId,
      `${UI.box("📦 ADD SCRIPT")}\n` +
        `${UI.dot} Cara pakai:\n` +
        `1. Kirim file .zip script ke chat ini.\n` +
        `2. Reply file tersebut dengan format:\n` +
        `   /addsc namasc|deskripsi|harga\n\n` +
        `Contoh:\n` +
        `   /addsc BotShopV4|Script bot shop lengkap|50000`
    );
  }

  const [namasc, deskripsi, hargaStr] = argText.split("|").map((v) => (v || "").trim());
  const harga = Number(hargaStr || "0");

  if (!namasc || !deskripsi || !harga || isNaN(harga)) {
    return sendText(
      chatId,
      `${UI.warn} Format salah.\n` +
        `Contoh: /addsc BotShopV4|Script bot shop lengkap|50000 (reply ke file .zip)`
    );
  }

  const doc = msg.reply_to_message.document;
  if (!doc.mime_type || !/zip/.test(doc.mime_type)) {
    return sendText(chatId, `${UI.no} File harus berformat *.zip*`);
  }

  // Di handler /addsc, ganti bagian ini:
try {
  await sendText(chatId, "⏳ Mengupload script ke Telegram...");

  const file = await bot.getFile(doc.file_id);
  const fileLink = `https://api.telegram.org/file/bot${BotConfig.token}/${file.file_path}`;
  
  // Download dan simpan lokal
  await sendText(chatId, "⏳ Menyimpan script secara permanen...");
  const localPath = await downloadAndSaveScript(fileLink, namasc);

  const scripts = readJSON(DB_FILES.script, []);
  scripts.push({
    nama: namasc,
    deskripsi,
    harga: String(harga),
    url: fileLink, // tetap simpan URL asli
    localPath: localPath, // tambahkan path lokal
    fileId: doc.file_id // simpan file_id juga
  });
  writeJSON(DB_FILES.script, scripts);

  await sendText(chatId, `${UI.ok} Berhasil menambahkan script *${namasc}*`);
} catch (e) {
  console.error("addsc error:", e.message);
  await sendText(chatId, `${UI.no} Gagal menambahkan script: ${e.message}`);
}});

// === OWNER: /listsc ===
bot.onText(/\/listsc/, async (msg) => {
  if (!isOwner(msg)) return;
  const chatId = msg.chat.id;
  const scripts = readJSON(DB_FILES.script, []);

  if (!scripts.length) {
    return sendText(chatId, "Belum ada script yang tersimpan.");
  }

  let teks = `${UI.box("📜 LIST SCRIPT")}\n`;
  scripts.forEach((sc, i) => {
    teks += `\n${i + 1}. *${sc.nama}*\n`;
    teks += `   Harga : ${formatRupiah(sc.harga)}\n`;
    teks += `   Desk  : ${sc.deskripsi}\n`;
  });

  teks += `\n${UI.foot(`Total: ${scripts.length} script`)}`;
  await sendText(chatId, teks);
});

// === OWNER: /delsc namasc ===
bot.onText(/\/delsc(?:\s+(.+))?/, async (msg, match) => {
  if (!isOwner(msg)) return;
  const chatId = msg.chat.id;
  const name = (match[1] || "").trim();

  if (!name) {
    return sendText(chatId, "Format: /delsc namasc");
  }

  const scripts = readJSON(DB_FILES.script, []);
  const idx = scripts.findIndex((s) => s.nama.toLowerCase() === name.toLowerCase());
  if (idx === -1) {
    return sendText(chatId, `${UI.no} Script tidak ditemukan.`);
  }

  const removed = scripts.splice(idx, 1)[0];
  writeJSON(DB_FILES.script, scripts);
  await sendText(chatId, `${UI.ok} Script *${removed.nama}* berhasil dihapus.`);
});

// === CORE: CREATE ORDER PAYMENT ===
async function createOrderPayment(msg, orderData) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const nama = msg.from.first_name || "Customer";

  const harga = Number(orderData.price);
  const unik = generateRandomUnique(110, 250);
  const totalBayar = harga + unik;
  const reffId = `${orderData.type}-${userId}-${Date.now()}`;
  const expireAt = Date.now() + (15 * 60 * 1000); // 15 menit

  if (!Atlantic.ApiKey) {
    return sendText(
      chatId,
      `${UI.no} Atlantic.ApiKey belum dikonfigurasi di settings.js`
    );
  }

  try {
    await sendText(chatId, "⏳ Membuat invoice pembayaran...");

    const createRes = await atlDepositCreate(reffId, totalBayar);

    if (!createRes?.data) {
      throw new Error(createRes?.message || "Tidak ada data dari payment gateway.");
    }

    const paymentData = createRes.data;

    // Buat caption untuk pesan pembayaran
    const captionText = [
      UI.box("💰 INVOICE PEMBAYARAN"),
      `${UI.dot} Order : *${orderData.title}*`,
      `${UI.dot} Harga : ${formatRupiah(harga)}`,
      `${UI.dot} Unik  : ${formatRupiah(unik)}`,
      `${UI.dot} Total : *${formatRupiah(totalBayar)}*`,
      "",
      `${UI.dot} Reff ID: \`${reffId}\``,
      `${UI.dot} Pay ID : \`${paymentData.id}\``,
      `${UI.dot} Expire : ${moment(expireAt).format("HH:mm:ss")}`,
      "",
      `${UI.dot} *Cara Bayar:*`,
      `1. Scan QRIS di atas`,
      `2. Bayar tepat sampai 3 digit terakhir`,
      `3. Tekan tombol "Cek Status"`,
      "",
      UI.foot("Pembayaran otomatis diverifikasi oleh sistem"),
    ].join("\n");

    let payMsg;

    // Priority 1: Gunakan qr_string untuk generate QR lokal
    if (paymentData.qr_string) {
      try {
        console.log("[QR] Generating QR from string...");
        const qrBuffer = await generateLocalQr(paymentData.qr_string);
        if (qrBuffer) {
          payMsg = await bot.sendPhoto(chatId, qrBuffer, {
            caption: captionText,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔄 Cek Status", callback_data: `order_check:${paymentData.id}` }],
                [{ text: "✖️ Batalkan", callback_data: `order_cancel:${paymentData.id}` }],
              ],
            },
          });
          console.log("[QR] QR berhasil dikirim dari buffer");
        } else {
          throw new Error("Gagal generate QR dari string");
        }
      } catch (qrError) {
        console.error("[QR] Error generate from string:", qrError);
        // Fallback ke URL atau text only
        await handleQrFallback(chatId, paymentData, captionText, orderData, totalBayar, reffId);
        return;
      }
    }
    // Priority 2: Coba download QR dari URL jika qr_string tidak ada
    else if (paymentData.qr_image) {
      try {
        console.log("[QR] Downloading QR from URL...");
        const qrBuffer = await downloadQrFromUrl(paymentData.qr_image);
        if (qrBuffer) {
          payMsg = await bot.sendPhoto(chatId, qrBuffer, {
            caption: captionText,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔄 Cek Status", callback_data: `order_check:${paymentData.id}` }],
                [{ text: "✖️ Batalkan", callback_data: `order_cancel:${paymentData.id}` }],
              ],
            },
          });
          console.log("[QR] QR berhasil dikirim dari downloaded URL");
        } else {
          throw new Error("Gagal download QR dari URL");
        }
      } catch (urlError) {
        console.error("[QR] Error download from URL:", urlError);
        await handleQrFallback(chatId, paymentData, captionText, orderData, totalBayar, reffId);
        return;
      }
    }
    // Priority 3: Jika tidak ada QR sama sekali
    else {
      await handleQrFallback(chatId, paymentData, captionText, orderData, totalBayar, reffId);
      return;
    }

    // Simpan order ke activeOrders hanya jika berhasil kirim QR
    activeOrders[userId] = {
      userId,
      chatId,
      type: orderData.type,
      price: harga,
      total: paymentData.nominal || totalBayar,
      paymentId: paymentData.id,
      reffId,
      expireAt,
      payload: orderData.payload || {},
      payMsg: {
        chatId: payMsg.chat.id,
        messageId: payMsg.message_id,
      },
    };

    // Mulai polling status pembayaran
    startOrderPolling(activeOrders[userId]);

  } catch (e) {
    console.error("createOrderPayment error:", e.message);
    await sendText(chatId, `${UI.no} Gagal membuat invoice: ${e.message}`);
  }
}

// === FUNGSI BANTUAN UNTUK QR ===
async function downloadQrFromUrl(url) {
  try {
    console.log("[QR DOWNLOAD] Downloading from:", url);
    
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (response.status === 200 && response.data) {
      console.log("[QR DOWNLOAD] Download successful");
      return Buffer.from(response.data);
    } else {
      console.log("[QR DOWNLOAD] Download failed, status:", response.status);
      return null;
    }
  } catch (error) {
    console.error("[QR DOWNLOAD] Error:", error.message);
    return null;
  }
}

async function handleQrFallback(chatId, paymentData, captionText, orderData, totalBayar, reffId) {
  console.log("[QR FALLBACK] Using fallback method");
  
  // Coba kirim tanpa QR dulu
  const fallbackText = [
    captionText,
    "",
    `${UI.warn} *QR Code tidak tersedia*`,
    `${UI.dot} Silakan gunakan data berikut untuk pembayaran:`,
    `${UI.dot} Reff ID: \`${reffId}\``,
    `${UI.dot} Total: *${formatRupiah(totalBayar)}*`,
    "",
    `Hubungi owner jika butuh bantuan: ${Owner.username}`
  ].join("\n");

  const fallbackMsg = await sendText(chatId, fallbackText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔄 Cek Status", callback_data: `order_check:${paymentData.id}` }],
        [{ text: "✖️ Batalkan", callback_data: `order_cancel:${paymentData.id}` }],
        [{ text: "👤 Hubungi Owner", url: `https://t.me/${Owner.username.replace('@', '')}` }]
      ],
    },
  });

  // Simpan order tanpa QR
  activeOrders[msg.from.id] = {
    userId: msg.from.id,
    chatId,
    type: orderData.type,
    price: orderData.price,
    total: totalBayar,
    paymentId: paymentData.id,
    reffId,
    expireAt: Date.now() + (15 * 60 * 1000),
    payload: orderData.payload || {},
    payMsg: {
      chatId: fallbackMsg.chat.id,
      messageId: fallbackMsg.message_id,
    },
  };

  startOrderPolling(activeOrders[msg.from.id]);
}

// === PERBAIKI generateLocalQr ===
async function generateLocalQr(qrString) {
  try {
    if (!qrString) {
      console.error("[QR GENERATOR] QR string is empty");
      return null;
    }

    console.log("[QR GENERATOR] Generating QR from string:", qrString.substring(0, 50) + "...");

    return new Promise((resolve, reject) => {
      QRCode.toBuffer(qrString, {
        errorCorrectionLevel: 'H',
        type: 'png',
        width: 400,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      }, (err, buffer) => {
        if (err) {
          console.error("[QR GENERATOR] Error:", err);
          reject(err);
        } else {
          console.log("[QR GENERATOR] QR generated successfully, size:", buffer.length, "bytes");
          resolve(buffer);
        }
      });
    });

  } catch (err) {
    console.error("[QR GENERATOR ERROR]", err);
    return null;
  }
}

// === POLLING ORDER ===
// === POLLING ORDER ===
function startOrderPolling(order) {
  let done = false;
  let count = 0;
  const maxPoll = 60; // ~5-10 menit

  const poll = async () => {
    if (done || count >= maxPoll) return;
    count++;

    if (Date.now() >= order.expireAt) {
      done = true;
      return handleOrderExpired(order, "Waktu pembayaran habis.");
    }

    try {
      const statRes = await atlDepositStatus(order.paymentId);
      const sdata = statRes?.data;
      const status = String(sdata?.status || "").toLowerCase();

      console.log(`Atlantic status [${order.paymentId}] =>`, status);

      // 🔁 Kalau masih processing & belum pernah instant → proses ke saldo
      if (status === "processing" && !order.instantDone) {
        try {
          const inst = await atlDepositInstant(order.paymentId, true);
          console.log("[Atlantic Instant] OK =>", inst.data || inst);
          order.instantDone = true;
          order.instantInfo = inst.data || inst;
        } catch (err) {
          console.error("[Atlantic Instant] error =>", err.message);
        }
      }

      if (status === "success") {
        done = true;
        return handleOrderSuccess(order, sdata);
      }

      if (status === "failed" || status === "cancel") {
        done = true;
        return handleOrderFailed(order, "Pembayaran gagal / dibatalkan.");
      }

      const delay = Math.min(5000 * Math.pow(1.2, Math.floor(count / 6)), 30000);
      setTimeout(poll, delay);
    } catch (e) {
      console.error("polling error:", e.message);
      const delay = Math.min(10000 * Math.pow(1.2, Math.floor(count / 3)), 60000);
      setTimeout(poll, delay);
    }
  };

  setTimeout(poll, 4000);
}


async function handleOrderExpired(order, reason) {
  const { chatId, userId, type } = order;
  try {
    await sendText(
      chatId,
      `${UI.no} Pembayaran *expired*.\n` +
        `${UI.dot} Order : *${String(type).toUpperCase()}*\n` +
        `${UI.dot} Alasan: ${reason}`
    );
    delete activeOrders[userId];
  } catch {}
}

async function handleOrderFailed(order, reason) {
  const { chatId, userId, type } = order;
  try {
    await sendText(
      chatId,
      `${UI.no} Pembayaran *gagal/dibatalkan*.\n` +
        `${UI.dot} Order : *${String(type).toUpperCase()}*\n` +
        `${UI.dot} Alasan: ${reason}`
    );
    delete activeOrders[userId];
  } catch {}
}

// === UPDATE: handleOrderSuccess - Tambah notifikasi ===
async function handleOrderSuccess(order, payData) {
  const { chatId, userId, type } = order;
  try {
    const successMessage = `
✅ *PEMBAYARAN BERHASIL*

• Order : ${String(type).toUpperCase()}
• Nominal: ${formatRupiah(order.total)}
• ID Pay : \`${order.paymentId}\`
• Reff ID: \`${order.reffId}\`

Pembayaran sudah diterima dan akan segera diproses.
    `.trim();

    await sendText(chatId, successMessage);

    // SIMPAN KE DATABASE
    const savedOrder = saveOrderToDB(order);
    if (!savedOrder) {
      console.error("Gagal menyimpan order ke database");
    }

    // KIRIM NOTIFIKASI KE CHANNEL
    await notifyOrderCompleted(savedOrder);

    // Proses order berdasarkan type
    if (type === "panel") {
      await processPanelOrder(order);
    } else if (type === "adp") {
      await processAdpOrder(order);
    } else if (type === "reseller") {
      await processResellerOrder(order);
    } else if (type === "userbot") {
      await processPtOrder(order);
    } else if (type === "script") {
      await processScriptOrder(order);
    }

    // Update order dengan informasi tambahan jika needed
    if (savedOrder) {
      updateOrder(savedOrder.id, { 
        processed: true,
        processedAt: new Date().toISOString()
      });
    }

    delete activeOrders[userId];
  } catch (e) {
    console.error("handleOrderSuccess error:", e.message);
    
    const errorMessage = `
⚠️ Pembayaran sudah masuk, tapi terjadi error saat proses:

${e.message}

Silakan hubungi owner: ${Owner.username}
    `.trim();
    
    await sendText(chatId, errorMessage);
  }
}

// === PROSES ORDER TIAP TIPE ===
async function processPanelOrder(order) {
  const { chatId, payload } = order;
  const { username, ram, disk, cpu } = payload;

  try {
    console.log(`[PROCESS PANEL] Membuat panel untuk: ${username}`);
    
    const uname = username.toLowerCase();
    const niceName = uname.charAt(0).toUpperCase() + uname.slice(1);

    // Buat user di Pterodactyl
    const { user, password } = await pteroCreateUser(uname, niceName, "Server", false);
    console.log(`[PROCESS PANEL] User created: ${user.username}`);

    // Buat server
    const server = await pteroCreateServer(user.id, `${niceName} Server`, nowID(), {
      ram: parseInt(ram),
      disk: parseInt(disk),
      cpu: parseInt(cpu)
    });
    console.log(`[PROCESS PANEL] Server created: ${server.id}`);

    const ramTxt = ram === "0" ? "Unlimited" : (parseInt(ram) / 1000) + "GB";
    const diskTxt = disk === "0" ? "Unlimited" : (parseInt(disk) / 1000) + "GB";
    const cpuTxt = cpu === "0" ? "Unlimited" : cpu + "%";

    // Gunakan format teks yang lebih aman
    const panelMessage = `
📡 DETAIL PANEL

• Server ID: ${server.id}
• Username: ${user.username}
• Password: ${password}
• Email: ${user.email}
• Panel: ${Panel.domain}

Spesifikasi:
- RAM: ${ramTxt}
- Disk: ${diskTxt}
- CPU: ${cpuTxt}

Tanggal Aktivasi: ${nowID()} WIB

Rules Pembelian Panel:
• Masa aktif 30 hari
• Data bersifat pribadi, simpan baik-baik
• Garansi 15 hari (1x replace)
• Klaim garansi wajib menyertakan bukti chat pembelian

${BotConfig.name}
    `.trim();

    await sendText(chatId, panelMessage);

  } catch (e) {
    console.error("processPanelOrder error:", e.message);
    throw new Error(`Gagal membuat panel: ${e.message}`);
  }
}

async function processAdpOrder(order) {
  const { chatId, payload } = order;
  const { username } = payload;

  try {
    console.log(`[PROCESS ADP] Membuat admin panel untuk: ${username}`);
    
    const uname = username.toLowerCase();
    const niceName = uname.charAt(0).toUpperCase() + uname.slice(1);

    const { user, password } = await pteroCreateUser(uname, niceName, "Admin", true);
    console.log(`[PROCESS ADP] Admin user created: ${user.username}`);

    const adminMessage = `
🛠 DETAIL ADMIN PANEL

• User ID: ${user.id}
• Username: ${user.username}
• Password: ${password}
• Email: ${user.email}
• Panel: ${Panel.domain}

Tanggal Aktivasi: ${nowID()} WIB

Syarat & Ketentuan:
• Expired akun 1 bulan
• Data bersifat pribadi, simpan baik-baik
• Jangan sembarangan hapus server
• Maling SC / abuse bisa dihapus permanen

${BotConfig.name}
    `.trim();

    await sendText(chatId, adminMessage);

  } catch (e) {
    console.error("processAdpOrder error:", e.message);
    throw new Error(`Gagal membuat admin panel: ${e.message}`);
  }
}

async function processResellerOrder(order) {
  const { chatId } = order;
  const teks = [
    UI.box("🤝 RESELLER PANEL"),
    `${UI.dot} Terima kasih sudah membeli *Reseller Panel*`,
    "",
    `${UI.dot} Link Grup Reseller:`,
    `${Links.ResellerPanel}`,
    "",
    `${UI.dot} Kontak Owner: ${Owner.username}`,
    UI.foot(BotConfig.name),
  ].join("\n");

  await sendText(chatId, teks);
}

async function processPtOrder(order) {
  const { chatId } = order;
  const teks = [
    UI.box("🏷 AKSES GRUP PT"),
    `${UI.dot} Terima kasih sudah membeli *PT*`,
    "",
    `${UI.dot} Link Grup PT:`,
    `${Links.Pt}`,
    "",
    `${UI.dot} Kontak Owner: ${Owner.username}`,
    UI.foot(BotConfig.name),
  ].join("\n");

  await sendText(chatId, teks);
}

async function processScriptOrder(order) {
  const { chatId, payload } = order;
  const { scriptName } = payload;

  const scripts = readJSON(DB_FILES.script, []);
  const sc = scripts.find((s) => s.nama === scriptName);

  if (!sc) {
    return sendText(
      chatId,
      `${UI.warn} Pembayaran berhasil, tapi script *${scriptName}* tidak ditemukan di database.\n` +
        `Segera hubungi owner: ${Owner.username}`
    );
  }

  await sendText(chatId, `${UI.ok} Mengirim script *${sc.nama}*...`);

  try {
    // Priority 1: Coba kirim via file_id (paling reliable)
    if (sc.fileId) {
      await bot.sendDocument(chatId, sc.fileId, {
        caption: sc.deskripsi || sc.nama,
      });
      console.log(`[SCRIPT] Sent via file_id: ${sc.nama}`);
      return;
    }

    // Priority 2: Coba kirim via local file
    if (sc.localPath && fs.existsSync(sc.localPath)) {
      await bot.sendDocument(chatId, sc.localPath, {
        caption: sc.deskripsi || sc.nama,
      });
      console.log(`[SCRIPT] Sent via local file: ${sc.nama}`);
      return;
    }

    // Priority 3: Fallback ke URL (bisa error)
    if (sc.url) {
      await bot.sendDocument(chatId, sc.url, {
        caption: sc.deskripsi || sc.nama,
      });
      console.log(`[SCRIPT] Sent via URL: ${sc.nama}`);
      return;
    }

    throw new Error("Tidak ada metode pengiriman yang tersedia");

  } catch (error) {
    console.error("Kirim script error:", error.message);
    
    // Notifikasi ke owner
    const owners = Array.isArray(Owner.ids) ? Owner.ids : [Owner.ids];
    for (const ownerId of owners) {
      await sendText(ownerId, 
        `❌ GAGAL KIRIM SCRIPT\n\n` +
        `Script: ${sc.nama}\n` +
        `User: ${chatId}\n` +
        `Error: ${error.message}\n\n` +
        `Segera perbaiki!`
      );
    }

    // Notifikasi ke user
    await sendText(chatId,
      `❌ Gagal mengirim script *${sc.nama}*\n\n` +
      `Error: ${error.message}\n\n` +
      `Owner telah dinotifikasi dan akan segera memperbaiki.\n` +
      `Silakan tunggu atau hubungi ${Owner.username}`
    );
  }
}

bot.onText(/\/ownermenu/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) {
    return sendText(chatId, `${UI.no} Menu ini hanya untuk *Owner Bot*.`);
  }

  const teks = [
    UI.box("🧑‍💻 OWNER MENU"),
    `${UI.dot} *Quick Access Menu*`,
    "",
    "Pilih kategori yang ingin dikelola:",
    "",
    UI.foot("Gunakan dengan bijak! 🔐"),
  ].join("\n");

  await sendText(chatId, teks, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📜 Script", callback_data: "owner_menu_script" },
          { text: "💰 Pricing", callback_data: "owner_menu_pricing" },
        ],
        [
          { text: "🛠️ Panel", callback_data: "owner_menu_panel" },
          { text: "📊 Stats", callback_data: "owner_menu_stats" },
        ],
        [
          { text: "🛡️ Warranty", callback_data: "owner_menu_warranty" },
          { text: "📢 Broadcast", callback_data: "owner_menu_broadcast" },
        ],
        [
          { text: "⚙️ System", callback_data: "owner_menu_system" },
          { text: "ℹ️ Info", callback_data: "owner_botinfo" },
        ],
        // Dalam keyboard owner menu utama, tambahkan:
        [
          { text: "💰 Financial", callback_data: "owner_menu_financial" },
        ],
      ],
    },
  });
});


// === /listusers - List semua user panel ===
bot.onText(/\/listusers/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) {
    return sendText(chatId, `${UI.no} Command ini hanya untuk owner.`);
  }

  try {
    await sendText(chatId, "⏳ Mengambil data users...");
    
    const users = await pteroGetUsers();
    const regularUsers = users.filter(user => !user.attributes.root_admin);
    
    if (regularUsers.length === 0) {
      return sendText(chatId, `${UI.ok} Tidak ada user panel biasa.`);
    }

    let teks = `${UI.box("👥 LIST USER PANEL")}\n`;
    teks += `${UI.dot} Total: ${regularUsers.length} user\n\n`;

    regularUsers.forEach((user, index) => {
      const u = user.attributes;
      teks += `${index + 1}. *${u.username}*\n`;
      teks += `   ID: ${u.id}\n`;
      teks += `   Email: ${u.email}\n`;
      teks += `   Created: ${u.created_at.split('T')[0]}\n\n`;
    });

    teks += UI.foot(`Gunakan /deluser <id> untuk menghapus`);
    await sendText(chatId, teks);

  } catch (e) {
    await sendText(chatId, `${UI.no} Error: ${e.message}`);
  }
});

// === /listadmins - List admin panel ===
bot.onText(/\/listadmins/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) {
    return sendText(chatId, `${UI.no} Command ini hanya untuk owner.`);
  }

  try {
    await sendText(chatId, "⏳ Mengambil data admins...");
    
    const users = await pteroGetUsers();
    const adminUsers = users.filter(user => user.attributes.root_admin);
    
    if (adminUsers.length === 0) {
      return sendText(chatId, `${UI.ok} Tidak ada admin panel.`);
    }

    let teks = `${UI.box("🛠 LIST ADMIN PANEL")}\n`;
    teks += `${UI.dot} Total: ${adminUsers.length} admin\n\n`;

    adminUsers.forEach((user, index) => {
      const u = user.attributes;
      teks += `${index + 1}. *${u.username}*\n`;
      teks += `   ID: ${u.id}\n`;
      teks += `   Email: ${u.email}\n`;
      teks += `   Name: ${u.first_name} ${u.last_name}\n\n`;
    });

    teks += UI.foot("Admin memiliki akses penuh ke panel");
    await sendText(chatId, teks);

  } catch (e) {
    await sendText(chatId, `${UI.no} Error: ${e.message}`);
  }
});

// === /listservers - List semua server ===
bot.onText(/\/listservers/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) {
    return sendText(chatId, `${UI.no} Command ini hanya untuk owner.`);
  }

  try {
    await sendText(chatId, "⏳ Mengambil data servers...");
    
    const servers = await pteroGetServers();
    
    if (servers.length === 0) {
      return sendText(chatId, `${UI.ok} Tidak ada server panel.`);
    }

    let teks = `${UI.box("📡 LIST SERVER PANEL")}\n`;
    teks += `${UI.dot} Total: ${servers.length} server\n\n`;

    servers.forEach((server, index) => {
      const s = server.attributes;
      const { ram, disk, cpu } = formatResources(server);
      
      teks += `${index + 1}. *${s.name}*\n`;
      teks += `   ID: ${s.id}\n`;
      teks += `   User ID: ${s.user}\n`;
      teks += `   RAM: ${ram} | Disk: ${disk} | CPU: ${cpu}\n`;
      teks += `   Created: ${s.created_at.split('T')[0]}\n\n`;
    });

    teks += UI.foot(`Gunakan /delserver <id> untuk menghapus`);
    await sendText(chatId, teks);

  } catch (e) {
    await sendText(chatId, `${UI.no} Error: ${e.message}`);
  }
});

// === /delserver - Hapus server ===
bot.onText(/\/delserver(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) {
    return sendText(chatId, `${UI.no} Command ini hanya untuk owner.`);
  }

  const serverId = (match[1] || "").trim();
  if (!serverId) {
    return sendText(chatId, 
      `${UI.box("🗑️ DELETE SERVER")}\n` +
      `${UI.dot} Format: /delserver <server_id>\n` +
      `${UI.dot} Contoh: /delserver 15\n\n` +
      `${UI.dot} Gunakan /listservers untuk melihat ID server`
    );
  }

  try {
    await sendText(chatId, `⏳ Menghapus server ${serverId}...`);
    await pteroDeleteServer(serverId);
    await sendText(chatId, `${UI.ok} Server *${serverId}* berhasil dihapus.`);
  } catch (e) {
    await sendText(chatId, `${UI.no} Gagal menghapus server: ${e.message}`);
  }
});

// === /deluser - Hapus user ===
bot.onText(/\/deluser(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) {
    return sendText(chatId, `${UI.no} Command ini hanya untuk owner.`);
  }

  const userId = (match[1] || "").trim();
  if (!userId) {
    return sendText(chatId, 
      `${UI.box("🗑️ DELETE USER")}\n` +
      `${UI.dot} Format: /deluser <user_id>\n` +
      `${UI.dot} Contoh: /deluser 25\n\n` +
      `${UI.dot} Gunakan /listusers untuk melihat ID user`
    );
  }

  try {
    await sendText(chatId, `⏳ Menghapus user ${userId}...`);
    
    // Hapus semua server user terlebih dahulu
    const userServers = await pteroGetUserServers(userId);
    for (const server of userServers) {
      await pteroDeleteServer(server.attributes.id);
    }
    
    // Hapus user
    await pteroDeleteUser(userId);
    
    await sendText(chatId, 
      `${UI.ok} User *${userId}* berhasil dihapus.\n` +
      `${UI.dot} Terhapus: ${userServers.length} server`
    );
  } catch (e) {
    await sendText(chatId, `${UI.no} Gagal menghapus user: ${e.message}`);
  }
});

// === /delallnonadmin - Hapus semua non-admin ===
bot.onText(/\/delallnonadmin/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) {
    return sendText(chatId, `${UI.no} Command ini hanya untuk owner.`);
  }

  try {
    await sendText(chatId, "⏳ Memproses penghapusan semua user & server non-admin...");
    
    const users = await pteroGetUsers();
    const regularUsers = users.filter(user => !user.attributes.root_admin);
    
    if (regularUsers.length === 0) {
      return sendText(chatId, `${UI.ok} Tidak ada user non-admin untuk dihapus.`);
    }

    let totalServersDeleted = 0;
    let totalUsersDeleted = 0;

    for (const user of regularUsers) {
      const userId = user.attributes.id;
      const username = user.attributes.username;
      
      try {
        // Hapus semua server user
        const userServers = await pteroGetUserServers(userId);
        for (const server of userServers) {
          await pteroDeleteServer(server.attributes.id);
          totalServersDeleted++;
        }
        
        // Hapus user
        await pteroDeleteUser(userId);
        totalUsersDeleted++;
        
      } catch (e) {
        console.error(`Error menghapus user ${username}:`, e.message);
      }
    }

    await sendText(chatId,
      `${UI.ok} *Pembersihan Selesai*\n\n` +
      `${UI.dot} User dihapus: ${totalUsersDeleted}\n` +
      `${UI.dot} Server dihapus: ${totalServersDeleted}\n` +
      `${UI.dot} Waktu: ${nowID()}`
    );

  } catch (e) {
    await sendText(chatId, `${UI.no} Error: ${e.message}`);
  }
});

// === /createadmin - Buat admin panel ===
bot.onText(/\/createadmin(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) {
    return sendText(chatId, `${UI.no} Command ini hanya untuk owner.`);
  }

  const text = (match[1] || "").trim();
  if (!text) {
    return sendText(chatId,
      `${UI.box("🛠 CREATE ADMIN PANEL")}\n` +
      `${UI.dot} Format: /createadmin username\n` +
      `${UI.dot} Contoh: /createadmin skyzopedia\n\n` +
      `${UI.dot} Akan dibuat akun admin dengan root access`
    );
  }

  const username = text.toLowerCase();
  
  try {
    await sendText(chatId, `⏳ Membuat admin panel untuk *${username}*...`);
    
    const { user, password } = await pteroCreateUser(username, username, "Admin", true);
    
    const teks = [
      UI.box("🛠 ADMIN PANEL CREATED"),
      `${UI.dot} User ID: *${user.id}*`,
      `${UI.dot} Username: \`${user.username}\``,
      `${UI.dot} Password: \`${password}\``,
      `${UI.dot} Email: ${user.email}`,
      `${UI.dot} Root Admin: ✅ Yes`,
      "",
      `${UI.dot} Panel URL: ${Panel.domain}`,
      `${UI.dot} Created: ${nowID()}`,
      UI.foot("Admin memiliki akses penuh ke seluruh panel"),
    ].join("\n");

    await sendText(chatId, teks);

  } catch (e) {
    await sendText(chatId, `${UI.no} Gagal membuat admin: ${e.message}`);
  }
});

// === /createpanel - Buat panel user biasa ===
bot.onText(/\/createpanel(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) {
    return sendText(chatId, `${UI.no} Command ini hanya untuk owner.`);
  }

  const text = (match[1] || "").trim();
  if (!text) {
    return sendText(chatId,
      `${UI.box("🔌 CREATE USER PANEL")}\n` +
      `${UI.dot} Format: /createpanel username,ram\n` +
      `${UI.dot} Contoh: /createpanel skyzopedia,1gb\n\n` +
      `${UI.dot} Paket RAM: 1gb, 2gb, 3gb, 4gb, 5gb, 6gb, 7gb, 8gb, 9gb, 10gb, unli`
    );
  }

  const [usernameRaw, ramRaw] = text.split(",").map(s => s.trim());
  const username = usernameRaw.toLowerCase();
  const ramKey = ramRaw.toLowerCase();
  
  if (!username || !ramKey) {
    return sendText(chatId, `${UI.no} Format salah. Contoh: /createpanel username,1gb`);
  }

  const plan = PANEL_PLANS[ramKey];
  if (!plan) {
    return sendText(chatId, 
      `${UI.no} Paket RAM tidak valid.\n` +
      `Paket tersedia: ${PANEL_PLAN_ORDER.join(", ")}`
    );
  }

  try {
    await sendText(chatId, `⏳ Membuat panel *${username}* dengan RAM ${ramKey}...`);
    
    // Buat user
    const { user, password } = await pteroCreateUser(username, username, "Server", false);
    
    // Buat server
    const server = await pteroCreateServer(user.id, `${username} Server`, nowID(), plan);
    
    const ramTxt = plan.ram === "0" ? "Unlimited" : plan.ram / 1000 + "GB";
    const diskTxt = plan.disk === "0" ? "Unlimited" : plan.disk / 1000 + "GB";
    const cpuTxt = plan.cpu === "0" ? "Unlimited" : plan.cpu + "%";

    const teks = [
      UI.box("🔌 PANEL CREATED"),
      `${UI.dot} Server ID: *${server.id}*`,
      `${UI.dot} User ID: *${user.id}*`,
      `${UI.dot} Username: \`${user.username}\``,
      `${UI.dot} Password: \`${password}\``,
      `${UI.dot} Email: ${user.email}`,
      "",
      `${UI.dot} Spesifikasi:`,
      `  • RAM: ${ramTxt}`,
      `  • Disk: ${diskTxt}`,
      `  • CPU: ${cpuTxt}`,
      "",
      `${UI.dot} Panel URL: ${Panel.domain}`,
      `${UI.dot} Created: ${nowID()}`,
      UI.foot("Panel user biasa tanpa akses admin"),
    ].join("\n");

    await sendText(chatId, teks);

  } catch (e) {
    await sendText(chatId, `${UI.no} Gagal membuat panel: ${e.message}`);
  }
});
  // === OWNER: /setharga_sc namasc|harga ===
  bot.onText(/\/setharga_sc(?:\s+(.+))?/, async (msg, match) => {
    if (!isOwner(msg)) return;
    const chatId = msg.chat.id;
    const argText = (match[1] || "").trim();

    if (!argText || !argText.includes("|")) {
      return sendText(
        chatId,
        `${UI.box("⚙️ SET HARGA SCRIPT")}\n` +
        `${UI.dot} Format:\n` +
        `  /setharga_sc namasc|harga\n\n` +
        `Contoh:\n` +
        `  /setharga_sc BotShopV4|55000`
      );
    }

    const [namascRaw, hargaRaw] = argText.split("|").map((v) => v.trim());
    if (!namascRaw || !hargaRaw) {
      return sendText(chatId, `${UI.no} Format tidak valid.`);
    }

    const harga = Number(hargaRaw);
    if (!harga || harga < 0) {
      return sendText(chatId, `${UI.no} Harga tidak valid.`);
    }

    const scripts = readJSON(DB_FILES.script, []);
    const idx = scripts.findIndex(
      (s) => s.nama.toLowerCase() === namascRaw.toLowerCase()
    );

    if (idx === -1) {
      return sendText(chatId, `${UI.no} Script *${namascRaw}* tidak ditemukan.`);
    }

    scripts[idx].harga = String(harga);
    writeJSON(DB_FILES.script, scripts);

    await sendText(
      chatId,
      `${UI.ok} Harga script *${scripts[idx].nama}* diupdate menjadi ${formatRupiah(harga)}`
    );
  });

    // === OWNER: /setharga_pt harga ===
  bot.onText(/\/setharga_pt(?:\s+(.+))?/, async (msg, match) => {
    if (!isOwner(msg)) return;
    const chatId = msg.chat.id;
    const argText = (match[1] || "").trim();

    if (!argText) {
      return sendText(
        chatId,
        `${UI.box("⚙️ SET HARGA PT")}\n` +
        `${UI.dot} Format:\n` +
        `  /setharga_pt <harga>\n\n` +
        `Contoh:\n` +
        `  /setharga_pt 10000`
      );
    }

    const harga = Number(argText);
    if (!harga || harga < 0) {
      return sendText(chatId, `${UI.no} Harga tidak valid.`);
    }

    const pricing = getPricing();
    pricing.pt = harga;
    savePricing(pricing);

    await sendText(
      chatId,
      `${UI.ok} Harga *PT / Grup* diupdate menjadi ${formatRupiah(harga)}`
    );
  });

    // === OWNER: /setharga_reseller harga ===
  bot.onText(/\/setharga_reseller(?:\s+(.+))?/, async (msg, match) => {
    if (!isOwner(msg)) return;
    const chatId = msg.chat.id;
    const argText = (match[1] || "").trim();

    if (!argText) {
      return sendText(
        chatId,
        `${UI.box("⚙️ SET HARGA RESELLER")}\n` +
        `${UI.dot} Format:\n` +
        `  /setharga_reseller <harga>\n\n` +
        `Contoh:\n` +
        `  /setharga_reseller 25000`
      );
    }

    const harga = Number(argText);
    if (!harga || harga < 0) {
      return sendText(chatId, `${UI.no} Harga tidak valid.`);
    }

    const pricing = getPricing();
    pricing.reseller = harga;
    savePricing(pricing);

    await sendText(
      chatId,
      `${UI.ok} Harga *Reseller Panel* diupdate menjadi ${formatRupiah(harga)}`
    );
  });

    // === OWNER: /setharga_panel paket harga ===
  bot.onText(/\/setharga_panel(?:\s+(.+))?/, async (msg, match) => {
    if (!isOwner(msg)) return;
    const chatId = msg.chat.id;
    const argText = (match[1] || "").trim();

    if (!argText) {
      return sendText(
        chatId,
        `${UI.box("⚙️ SET HARGA PANEL")}\n` +
        `${UI.dot} Format:\n` +
        `  /setharga_panel <paket> <harga>\n\n` +
        `Contoh:\n` +
        `  /setharga_panel 1gb 1500\n` +
        `  /setharga_panel unli 20000\n\n` +
        `${UI.dot} Paket tersedia: ${PANEL_PLAN_ORDER.join(", ")}`
      );
    }

    const [keyRaw, hargaRaw] = argText.split(/\s+/);
    const key = (keyRaw || "").toLowerCase();
    const targetKey = key === "unlimited" ? "unli" : key;

    if (!PANEL_PLANS[targetKey]) {
      return sendText(
        chatId,
        `${UI.no} Paket tidak dikenal.\n` +
        `Paket valid: ${PANEL_PLAN_ORDER.join(", ")}`
      );
    }

    const harga = Number(hargaRaw);
    if (!harga || harga < 0) {
      return sendText(chatId, `${UI.no} Harga tidak valid.`);
    }

    const pricing = getPricing();
    pricing.panel[targetKey] = harga;
    savePricing(pricing);

    await sendText(
      chatId,
      `${UI.ok} Harga panel *${targetKey.toUpperCase()}* diupdate menjadi ${formatRupiah(harga)}`
    );
  });

    // === OWNER: /listharga ===
  bot.onText(/\/listharga/, async (msg) => {
    if (!isOwner(msg)) return;
    const chatId = msg.chat.id;
    const pricing = getPricing();

    let teks = `${UI.box("💰 DAFTAR HARGA")}\n`;

    teks += `\n${UI.dot} *Panel Pterodactyl:*\n`;
    PANEL_PLAN_ORDER.forEach((key) => {
      const label = key === "unli" ? "Unlimited" : key.toUpperCase();
      const harga = pricing.panel[key] ?? DEFAULT_PRICING.panel[key];
      teks += `  • ${label.padEnd(9)} : ${formatRupiah(harga)}\n`;
    });

    teks += `\n${UI.dot} *Reseller Panel* : ${formatRupiah(pricing.reseller ?? DEFAULT_PRICING.reseller)}`;
    teks += `\n${UI.dot} *PT / Grup*     : ${formatRupiah(pricing.pt ?? DEFAULT_PRICING.pt)}`;

    teks += `\n\n${UI.foot("Edit harga: /setharga_panel, /setharga_reseller, /setharga_pt, /setharga_sc")}`;

    await sendText(chatId, teks);
  });

  // === COMMAND: /claim - Klaim garansi ===
bot.onText(/\/claim(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const orderId = (match[1] || "").trim();

  if (!orderId) {
    return sendText(chatId,
      `🛡️ *CLAIM GARANSI*\n\n` +
      `Format: /claim <order_id>\n\n` +
      `Contoh: /claim order_123456789\n\n` +
      `Gunakan /myorders untuk melihat order ID Anda`
    );
  }

  try {
    const order = getOrderById(orderId);
    
    if (!order) {
      return sendText(chatId, "❌ Order tidak ditemukan.");
    }

    if (order.userId !== userId) {
      return sendText(chatId, "❌ Ini bukan order Anda.");
    }

    if (!order.warranty.eligible) {
      return sendText(chatId, "❌ Order ini tidak eligible untuk garansi.");
    }

    if (order.warranty.claimed) {
      return sendText(chatId, "❌ Garansi untuk order ini sudah digunakan.");
    }

    if (order.warranty.claimCount >= order.warranty.maxClaims) {
      return sendText(chatId, "❌ Kuota klaim garansi sudah habis.");
    }

    // Cek masa berlaku garansi
    const validUntil = new Date(order.warranty.validUntil);
    if (validUntil < new Date()) {
      return sendText(chatId, "❌ Masa garansi sudah habis.");
    }

    // Buat warranty claim
    const claim = saveWarrantyClaim({
      orderId: order.id,
      userId: userId,
      chatId: chatId,
      orderType: order.type,
      username: order.username,
      reason: "Replace panel/server"
    });

    if (!claim) {
      return sendText(chatId, "❌ Gagal membuat klaim garansi.");
    }

    // Kirim notifikasi ke owner
    const ownerMessage = `
🛡️ *NEW WARRANTY CLAIM*

• Order ID: \`${order.id}\`
• User: ${userId}
• Type: ${order.type}
• Username: ${order.username}
• Claim ID: \`${claim.id}\`

/grant_${claim.id} - Approve claim
/reject_${claim.id} - Reject claim
    `.trim();

    // Kirim ke semua owner
    if (Owner.ids && Array.isArray(Owner.ids)) {
      for (const ownerId of Owner.ids) {
        try {
          await sendText(ownerId, ownerMessage, {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Approve", callback_data: `warranty_approve:${claim.id}` },
                  { text: "❌ Reject", callback_data: `warranty_reject:${claim.id}` }
                ],
                [
                  { text: "📋 Detail Order", callback_data: `order_detail:${order.id}` }
                ]
              ]
            }
          });
        } catch (e) {
          console.error("Gagal kirim notifikasi ke owner:", e.message);
        }
      }
    }

    await sendText(chatId,
      `✅ *CLAIM DIAJUKAN*\n\n` +
      `Klaim garansi Anda telah diajukan dan menunggu persetujuan owner.\n\n` +
      `📋 Detail:\n` +
      `• Order ID: \`${order.id}\`\n` +
      `• Claim ID: \`${claim.id}\`\n` +
      `• Status: ⏳ Pending\n\n` +
      `Owner akan menghubungi Anda segera.`
    );

  } catch (e) {
    console.error("claim error:", e.message);
    await sendText(chatId, "❌ Gagal mengajukan klaim garansi.");
  }
});


// === OWNER COMMANDS: WARRANTY MANAGEMENT ===

// Command untuk list pending claims
bot.onText(/\/pending_claims/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) return;

  try {
    const pendingClaims = getPendingWarrantyClaims();
    
    if (pendingClaims.length === 0) {
      return sendText(chatId, "✅ Tidak ada klaim garansi yang pending.");
    }

    let teks = `🛡️ *PENDING WARRANTY CLAIMS*\n\n`;
    
    pendingClaims.forEach((claim, index) => {
      const claimDate = new Date(claim.createdAt).toLocaleDateString('id-ID');
      teks += `${index + 1}. *${claim.orderType}* - ${claim.username}\n`;
      teks += `   👤 User: ${claim.userId}\n`;
      teks += `   🆔 Claim: \`${claim.id}\`\n`;
      teks += `   📅 Date: ${claimDate}\n`;
      teks += `   🆔 Order: \`${claim.orderId}\`\n\n`;
    });

    teks += `ℹ️ Gunakan buttons di bawah untuk action:`;

    const keyboard = pendingClaims.map(claim => [
      { 
        text: `✅ ${claim.username} (${claim.orderType})`, 
        callback_data: `warranty_approve:${claim.id}` 
      },
      { 
        text: `❌ ${claim.username} (${claim.orderType})`, 
        callback_data: `warranty_reject:${claim.id}` 
      }
    ]);

    await sendText(chatId, teks, {
      reply_markup: {
        inline_keyboard: keyboard
      }
    });

  } catch (e) {
    console.error("pending_claims error:", e.message);
    await sendText(chatId, "❌ Gagal mengambil data claims.");
  }
});

// === BROADCAST DOCUMENT COMMANDS ===

// Broadcast document dengan reply
bot.onText(/\/bcdoc(?:\s+(.+))?/, async (msg, match) => {
  if (!isOwner(msg)) return sendText(msg.chat.id, `${UI.no} Owner only.`);

  const caption = (match?.[1] || "").trim() || "📄 Broadcast Document";
  
  // Harus reply ke document
  if (!msg.reply_to_message || !msg.reply_to_message.document) {
    return sendText(msg.chat.id,
      `📄 *DOCUMENT BROADCAST*\n\n` +
      `Cara penggunaan:\n` +
      `1. Kirim file/document ke chat\n` +
      `2. Reply file tersebut\n` +
      `3. Ketik: /bcdoc <caption>\n\n` +
      `Contoh:\n` +
      `/bcdoc Download file penting ini\n\n` +
      `🧪 Test: /bcdoctest`
    );
  }

  const docFileId = msg.reply_to_message.document.file_id;
  const fileName = msg.reply_to_message.document.file_name || "document";
  
  await sendText(msg.chat.id, `📄 Starting document broadcast: ${fileName}...`);
  await broadcastDocumentToAllUsers(docFileId, fileName, caption, { 
    showProgressTo: msg.chat.id
  });
});

// Test broadcast document
bot.onText(/\/bcdoctest(?:\s+(.+))?/, async (msg, match) => {
  if (!isOwner(msg)) return sendText(msg.chat.id, `${UI.no} Owner only.`);

  const caption = (match?.[1] || "").trim() || "🧪 Test Document Broadcast";
  
  // Harus reply ke document
  if (!msg.reply_to_message || !msg.reply_to_message.document) {
    return sendText(msg.chat.id,
      `🧪 *TEST DOCUMENT BROADCAST*\n\n` +
      `Cara penggunaan:\n` +
      `1. Kirim file/document ke chat\n` +
      `2. Reply file tersebut\n` +
      `3. Ketik: /bcdoctest <caption>\n\n` +
      `Contoh:\n` +
      `/bcdoctest Ini test document broadcast`
    );
  }

  const docFileId = msg.reply_to_message.document.file_id;
  const fileName = msg.reply_to_message.document.file_name || "document";
  
  await sendText(msg.chat.id, `🧪 Starting test document broadcast: ${fileName}...`);
  await broadcastDocumentToAllUsers(docFileId, fileName, caption, { 
    showProgressTo: msg.chat.id,
    testMode: true,
    testUserId: msg.from.id
  });
});

bot.onText(/\/myorders/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const userOrders = getOrdersByUser(userId);
    
    if (userOrders.length === 0) {
      return sendText(chatId, "📭 Anda belum memiliki order yang selesai.");
    }

    let teks = `📦 *ORDER HISTORY*\n\n`;
    
    userOrders.forEach((order, index) => {
      const orderDate = new Date(order.createdAt).toLocaleDateString('id-ID');
      const warrantyStatus = order.warranty.eligible ? 
        (order.warranty.claimed ? `❌ Used` : `✅ Available (${order.warranty.claimCount}/${order.warranty.maxClaims})`) : 
        `❌ Not eligible`;
      
      teks += `${index + 1}. *${order.type.toUpperCase()}* - ${order.username}\n`;
      teks += `   💰 ${formatRupiah(order.total)} | 📅 ${orderDate}\n`;
      teks += `   🛡️ Garansi: ${warrantyStatus}\n`;
      teks += `   🆔 \`${order.id}\`\n\n`;
    });

    teks += `ℹ️ Gunakan /claim <order_id> untuk klaim garansi`;

    await sendText(chatId, teks);

  } catch (e) {
    console.error("myorders error:", e.message);
    await sendText(chatId, "❌ Gagal mengambil data order.");
  }
});

// Command manual approve/reject
bot.onText(/\/grant_(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) return;
  
  const claimId = match[1];
  await processWarrantyApproval(claimId, true, msg.from.id);
});

bot.onText(/\/reject_(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) return;
  
  const claimId = match[1];
  await processWarrantyApproval(claimId, false, msg.from.id);
});

// === BROADCAST COMMANDS ===

// Broadcast teks
bot.onText(/\/bc(?:\s+([\s\S]+))?/, async (msg, match) => {
  if (!isOwner(msg)) return sendText(msg.chat.id, `${UI.no} Owner only.`);

  const text = (match?.[1] || "").trim();
  if (!text) {
    return sendText(msg.chat.id,
      `📢 *BROADCAST SYSTEM*\n\n` +
      `Format: /bc <pesan>\n\n` +
      `Contoh:\n` +
      `/bc Halo semua! Ada update baru nih...\n\n` +
      `🧪 Test: /bctest <pesan>\n` +
      `🖼️ Photo: /bcphoto <url>|<caption>\n` +
      `📊 Stats: /bcstats`
    );
  }

  const payload = `📢 *BROADCAST*\n\n${text}\n\n_— ${BotConfig.name}_`;
  
  await broadcastTextToAllUsers(payload, { 
    showProgressTo: msg.chat.id
  });
});

// Test broadcast (ke owner saja)
bot.onText(/\/bctest(?:\s+([\s\S]+))?/, async (msg, match) => {
  if (!isOwner(msg)) return sendText(msg.chat.id, `${UI.no} Owner only.`);

  const text = (match?.[1] || "").trim();
  if (!text) {
    return sendText(msg.chat.id,
      `🧪 *TEST BROADCAST*\n\n` +
      `Format: /bctest <pesan>\n\n` +
      `Contoh:\n` +
      `/bctest Ini pesan test broadcast`
    );
  }

  const payload = `🧪 *TEST BROADCAST*\n\n${text}\n\n_— Test dari ${BotConfig.name}_`;
  
  await broadcastTextToAllUsers(payload, { 
    showProgressTo: msg.chat.id,
    testMode: true,
    testUserId: msg.from.id
  });
});

// === BROADCAST PHOTO COMMANDS (UPDATE) ===

// Broadcast photo dengan reply atau URL
bot.onText(/\/bcphoto(?:\s+([\s\S]+))?/, async (msg, match) => {
  if (!isOwner(msg)) return sendText(msg.chat.id, `${UI.no} Owner only.`);

  const args = (match?.[1] || "").trim();
  
  // Jika reply ke foto
  if (msg.reply_to_message && msg.reply_to_message.photo) {
    const caption = args || "📢 Broadcast";
    const photoFileId = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1].file_id;
    
    await sendText(msg.chat.id, `🖼️ Starting photo broadcast (from reply)...`);
    await broadcastPhotoFileToAllUsers(photoFileId, caption, { 
      showProgressTo: msg.chat.id
    });
    return;
  }
  
  // Jika pakai URL
  if (args) {
    const [photoUrl, caption = "📢 Broadcast"] = args.split('|').map(s => s.trim());
    
    if (!photoUrl) {
      return sendText(msg.chat.id, "❌ URL gambar tidak boleh kosong.");
    }

    await sendText(msg.chat.id, `🖼️ Starting photo broadcast (from URL)...`);
    await broadcastPhotoToAllUsers(photoUrl, caption, { 
      showProgressTo: msg.chat.id
    });
    return;
  }

  // Jika tidak ada args dan tidak reply
  return sendText(msg.chat.id,
    `🖼️ *PHOTO BROADCAST*\n\n` +
    `*Cara 1:* Reply foto dengan caption:\n` +
    `1. Kirim foto ke chat\n` +
    `2. Reply foto tersebut\n` +
    `3. Ketik: /bcphoto <caption>\n\n` +
    `*Cara 2:* Pakai URL:\n` +
    `/bcphoto <url_gambar>|<caption>\n\n` +
    `Contoh:\n` +
    `/bcphoto https://example.com/image.jpg|Halo semua! Lihat gambar ini\n\n` +
    `🧪 Test: /bcphototest`
  );
});

// Test broadcast photo dengan reply atau URL
bot.onText(/\/bcphototest(?:\s+([\s\S]+))?/, async (msg, match) => {
  if (!isOwner(msg)) return sendText(msg.chat.id, `${UI.no} Owner only.`);

  const args = (match?.[1] || "").trim();
  
  // Jika reply ke foto
  if (msg.reply_to_message && msg.reply_to_message.photo) {
    const caption = args || "🧪 Test Broadcast";
    const photoFileId = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1].file_id;
    
    await sendText(msg.chat.id, `🧪 Starting test photo broadcast (from reply)...`);
    await broadcastPhotoFileToAllUsers(photoFileId, caption, { 
      showProgressTo: msg.chat.id,
      testMode: true,
      testUserId: msg.from.id
    });
    return;
  }
  
  // Jika pakai URL
  if (args) {
    const [photoUrl, caption = "🧪 Test Broadcast"] = args.split('|').map(s => s.trim());
    
    if (!photoUrl) {
      return sendText(msg.chat.id, "❌ URL gambar tidak boleh kosong.");
    }

    await sendText(msg.chat.id, `🧪 Starting test photo broadcast (from URL)...`);
    await broadcastPhotoToAllUsers(photoUrl, caption, { 
      showProgressTo: msg.chat.id,
      testMode: true,
      testUserId: msg.from.id
    });
    return;
  }

  // Jika tidak ada args dan tidak reply
  return sendText(msg.chat.id,
    `🧪 *TEST PHOTO BROADCAST*\n\n` +
    `*Cara 1:* Reply foto dengan caption:\n` +
    `1. Kirim foto ke chat\n` +
    `2. Reply foto tersebut\n` +
    `3. Ketik: /bcphototest <caption>\n\n` +
    `*Cara 2:* Pakai URL:\n` +
    `/bcphototest <url_gambar>|<caption>\n\n` +
    `Contoh:\n` +
    `/bcphototest https://example.com/image.jpg|Ini test photo broadcast`
  );
});

// === BROADCAST WITH FILE ID ===
async function broadcastPhotoFileToAllUsers(fileId, caption, options = {}) {
  // Implementasi yang sama dengan broadcastPhotoToAllUsers
  // tapi menggunakan fileId instead of URL
  const { showProgressTo, testMode = false, testUserId = null } = options;
  const users = testMode && testUserId ? [getAllUsers().find(u => u.id == testUserId)].filter(Boolean) : getActiveUsers();
  
  let successCount = 0;
  let failCount = 0;
  const totalUsers = users.length;

  if (showProgressTo) {
    await sendText(showProgressTo, `🖼️ Starting photo broadcast to ${totalUsers} users...`);
  }

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    
    try {
      await bot.sendPhoto(user.id, fileId, {
        caption: caption,
        parse_mode: null
      });
      successCount++;
      
      if (showProgressTo && (i + 1) % 5 === 0) {
        await sendText(showProgressTo, 
          `📊 Progress: ${i + 1}/${totalUsers}\n` +
          `✅ Success: ${successCount}\n` +
          `❌ Failed: ${failCount}`
        );
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      console.error(`Photo broadcast failed to user ${user.id}:`, error.message);
      failCount++;
      
      if (error.message.includes('blocked') || error.message.includes('deactivated')) {
        const users = getAllUsers();
        const userIndex = users.findIndex(u => u.id === user.id);
        if (userIndex !== -1) {
          users[userIndex].active = false;
          writeJSON(DB_FILES.users, users);
        }
      }
    }
  }

  const result = {
    total: totalUsers,
    success: successCount,
    failed: failCount,
    successRate: totalUsers > 0 ? ((successCount / totalUsers) * 100).toFixed(2) : 0
  };

  if (showProgressTo) {
    const resultMessage = testMode ? 
      `🧪 *TEST PHOTO BROADCAST COMPLETE*\n\n` +
      `✅ Sent to: 1 user (test mode)\n` +
      `📊 Status: ${successCount > 0 ? 'SUCCESS' : 'FAILED'}` :
      
      `🖼️ *PHOTO BROADCAST COMPLETE*\n\n` +
      `👥 Total Users: ${totalUsers}\n` +
      `✅ Success: ${successCount}\n` +
      `❌ Failed: ${failCount}\n` +
      `📊 Success Rate: ${result.successRate}%`;

    await sendText(showProgressTo, resultMessage);
  }

  return result;
}

// Update /bcstats command
bot.onText(/\/bcstats/, async (msg) => {
  if (!isOwner(msg)) return sendText(msg.chat.id, `${UI.no} Owner only.`);

  const totalUsers = getUserCount();
  const activeUsers = getActiveUserCount();
  const inactiveUsers = totalUsers - activeUsers;

  const statsMessage = `
📊 *BROADCAST STATISTICS*

👥 Total Users: ${totalUsers}
✅ Active Users: ${activeUsers}
❌ Inactive Users: ${inactiveUsers}
📈 Active Rate: ${totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(2) : 0}%

📢 *Available Commands:*
• /bc <text> - Broadcast text
• /bcphoto - Broadcast photo (reply/URL)
• /bcdoc - Broadcast document (reply)
• /bctest - Test text broadcast  
• /bcphototest - Test photo broadcast
• /bcdoctest - Test document broadcast

💡 *Usage Tips:*
• Reply ke foto/document untuk broadcast
• Atau gunakan URL untuk photo
• Test dulu sebelum broadcast ke semua
  `.trim();

  await sendText(msg.chat.id, statsMessage, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🧪 Test Text", callback_data: "bc_test_text" },
          { text: "🖼️ Test Photo", callback_data: "bc_test_photo" },
          { text: "📄 Test Doc", callback_data: "bc_test_doc" }
        ],
        [
          { text: "📢 Broadcast Text", callback_data: "bc_start_text" },
          { text: "🖼️ Broadcast Photo", callback_data: "bc_start_photo" },
          { text: "📄 Broadcast Doc", callback_data: "bc_start_doc" }
        ]
      ]
    }
  });
});

// === WARRANTY APPROVAL PROCESS ===
async function processWarrantyApproval(claimId, approved, processedBy) {
  try {
    const claim = getPendingWarrantyClaims().find(c => c.id === claimId);
    if (!claim) {
      return sendText(processedBy, "❌ Claim tidak ditemukan atau sudah diproses.");
    }

    const order = getOrderById(claim.orderId);
    if (!order) {
      return sendText(processedBy, "❌ Order tidak ditemukan.");
    }

    if (approved) {
      // Update claim status
      updateWarrantyClaim(claimId, {
        status: 'approved',
        processedAt: new Date().toISOString(),
        processedBy: processedBy
      });

      // Update order warranty info
      updateOrder(order.id, {
        warranty: {
          ...order.warranty,
          claimed: true,
          claimCount: order.warranty.claimCount + 1
        }
      });

      // Notify user
      await sendText(claim.chatId,
        `✅ *CLAIM GARANSI DISETUJUI*\n\n` +
        `Klaim garansi Anda untuk order \`${order.id}\` telah disetujui.\n\n` +
        `Owner akan memproses replacement panel/server Anda segera.\n\n` +
        `Terima kasih! 🛡️`
      );

      // Notify owner
      await sendText(processedBy,
        `✅ Claim \`${claimId}\` telah disetujui.\n` +
        `User telah dinotifikasi.`
      );

    } else {
      // Reject claim
      updateWarrantyClaim(claimId, {
        status: 'rejected',
        processedAt: new Date().toISOString(),
        processedBy: processedBy
      });

      // Notify user
      await sendText(claim.chatId,
        `❌ *CLAIM GARANSI DITOLAK*\n\n` +
        `Klaim garansi Anda untuk order \`${order.id}\` telah ditolak.\n\n` +
        `Silakan hubungi owner untuk informasi lebih lanjut.`
      );

      // Notify owner
      await sendText(processedBy,
        `❌ Claim \`${claimId}\` telah ditolak.\n` +
        `User telah dinotifikasi.`
      );
    }

  } catch (e) {
    console.error("processWarrantyApproval error:", e.message);
    await sendText(processedBy, "❌ Gagal memproses claim.");
  }
}

// === CUSTOM THUMBNAIL UPLOAD ===
bot.onText(/\/setthumbnail/, async (msg) => {
  if (!isOwner(msg)) return sendText(msg.chat.id, `${UI.no} Owner only.`);

  if (msg.reply_to_message && msg.reply_to_message.photo) {
    const photoFileId = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1].file_id;
    
    // Simpan file_id ke database atau config
    const thumbnailFile = path.join(DB_DIR, "thumbnail.json");
    writeJSON(thumbnailFile, { file_id: photoFileId, setAt: new Date().toISOString() });
    
    await sendText(msg.chat.id, "✅ Thumbnail berhasil diatur! Mulai sekarang bot akan menggunakan thumbnail ini.");
  } else {
    await sendText(msg.chat.id,
      "📸 *SET CUSTOM THUMBNAIL*\n\n" +
      "Cara penggunaan:\n" +
      "1. Kirim foto yang ingin dijadikan thumbnail\n" +
      "2. Reply foto tersebut\n" +
      "3. Ketik: /setthumbnail\n\n" +
      "Foto akan digunakan di start menu."
    );
  }
});

// Fungsi untuk get custom thumbnail
function getCustomThumbnail() {
  try {
    const thumbnailFile = path.join(DB_DIR, "thumbnail.json");
    const data = readJSON(thumbnailFile, null);
    return data ? data.file_id : null;
  } catch (e) {
    return null;
  }
}


//Sistem Nokos & Deposit/Saldo
// === PERBAIKAN: /buynokos - Beli nomor kosong ===
bot.onText(/\/buynokos(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const args = (match[1] || "").trim();

  if (!args) {
    return sendText(chatId,
      `📱 *BELI NOMOR KOSONG (NOKOS)*\n\n` +
      `Format: /buynokos <layanan>\n\n` +
      `Contoh:\n` +
      `/buynokos whatsapp\n` +
      `/buynokos instagram\n\n` +
      `Gunakan /layanannokos untuk melihat list layanan`
    );
  }

  try {
    await sendText(chatId, `🔍 Mencari layanan *${args}*...`);
    
    const services = await searchNokosService(args);
    
    if (services.length === 0) {
      return sendText(chatId,
        `❌ Layanan *${args}* tidak ditemukan.\n\n` +
        `Gunakan /layanannokos untuk melihat list layanan yang tersedia.\n` +
        `Atau gunakan /layanannokos <kata_kunci> untuk mencari.`
      );
    }

    // Jika hanya ada 1 hasil, langsung proses
    if (services.length === 1) {
      const service = services[0];
      await processNokosOrder(msg, service);
      return;
    }

    // Jika banyak hasil, tampilkan pilihan
    const keyboard = services.slice(0, 10).map(service => [{
      text: `${service.layanan} - ${formatRupiah(service.harga)} (${service.negara || service.catatan || 'Global'})`,
      callback_data: `nokos_buy_direct:${service.kode_layanan}`
    }]);

    if (services.length > 10) {
      keyboard.push([{
        text: `🔍 Tampilkan ${services.length - 10} layanan lainnya...`,
        callback_data: `nokos_search_more:${args}`
      }]);
    }

    await sendText(chatId,
      `📱 *Ditemukan ${services.length} layanan untuk "*${args}*"*\n\n` +
      `Pilih salah satu layanan di bawah:`,
      { reply_markup: { inline_keyboard: keyboard } }
    );

  } catch (error) {
    console.error("buynokos error:", error.message);
    await sendText(chatId, `❌ Gagal memesan nokos: ${error.message}`);
  }
});

// === PROCESS NOKOS ORDER ===
async function processNokosOrder(msg, service) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    // Cek saldo user
    const userSaldo = getUserSaldo(userId);
    const servicePrice = Number(service.harga);
    
    if (userSaldo < servicePrice) {
      return sendText(chatId,
        `❌ Saldo tidak cukup!\n\n` +
        `💰 Layanan: ${service.layanan}\n` +
        `💵 Harga: ${formatRupiah(servicePrice)}\n` +
        `📊 Saldo Anda: ${formatRupiah(userSaldo)}\n\n` +
        `Silakan deposit terlebih dahulu menggunakan /deposit`
      );
    }

    // Proses pemesanan nokos
    await sendText(chatId, `⏳ Memesan ${service.layanan}...`);
    
    const orderResult = await orderNokos(
      service.kode_layanan,
      service.kode_operator || "any",
      service.kode_negara
    );

    // Kurangi saldo user
    const newSaldo = updateUserSaldo(userId, -servicePrice);
    
    // Simpan order nokos ke database
    const nokosOrders = readJSON(DB_FILES.nokos, []);
    const nokosOrder = {
      id: orderResult.id,
      userId: userId,
      chatId: chatId,
      layanan: service.layanan,
      kode_layanan: service.kode_layanan,
      harga: servicePrice,
      target: orderResult.target,
      status: "pending",
      createdAt: new Date().toISOString(),
      saldoDipotong: servicePrice,
      saldoSisa: newSaldo
    };
    
    nokosOrders.push(nokosOrder);
    writeJSON(DB_FILES.nokos, nokosOrders);

    // Kirim informasi order
    const orderMessage = `
✅ *PEMESANAN NOKOS BERHASIL*

📱 Layanan: ${service.layanan}
💰 Harga: ${formatRupiah(servicePrice)}
🎯 Nomor: ${orderResult.target}
🆔 Order ID: \`${orderResult.id}\`

⏳ Menunggu OTP...
Bot akan otomatis mengirim OTP ketika tersedia

💳 Saldo terpotong: ${formatRupiah(servicePrice)}
💰 Sisa saldo: ${formatRupiah(newSaldo)}
    `.trim();

    await sendText(chatId, orderMessage, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔄 Cek Status", callback_data: `nokos_status:${orderResult.id}` },
            { text: "❌ Batalkan", callback_data: `nokos_cancel:${orderResult.id}` }
          ],
          [
            { text: "📋 Riwayat", callback_data: "menu_historynokos" }
          ]
        ]
      }
    });

    // Mulai polling status
    startNokosPolling(nokosOrder);

  } catch (error) {
    console.error("processNokosOrder error:", error.message);
    await sendText(chatId, `❌ Gagal memesan nokos: ${error.message}`);
  }
}

// === PERBAIKAN: /layanannokos - List layanan nokos ===
bot.onText(/\/layanannokos(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const searchQuery = (match[1] || "").trim();

  try {
    await sendText(chatId, "⏳ Mengambil data layanan nokos...");
    
    let services;
    if (searchQuery) {
      // Jika ada query search
      services = await searchNokosService(searchQuery);
      
      if (services.length === 0) {
        return sendText(chatId, 
          `❌ Tidak ditemukan layanan dengan kata kunci "*${searchQuery}*"\n\n` +
          `Coba gunakan kata kunci yang lebih umum atau lihat layanan populer dengan /layanannokos`
        );
      }
    } else {
      // Jika tidak ada query, tampilkan layanan populer
      services = await getPopularNokosServices();
    }

    if (!services.length) {
      return sendText(chatId, "❌ Tidak ada layanan nokos yang tersedia.");
    }

    // Buat keyboard dengan layanan
    const keyboard = [];
    const servicesPerRow = 2;
    
    for (let i = 0; i < services.length; i += servicesPerRow) {
      const row = [];
      for (let j = 0; j < servicesPerRow && i + j < services.length; j++) {
        const service = services[i + j];
        const buttonText = `${service.layanan} - ${formatRupiah(service.harga)}`;
        row.push({
          text: buttonText,
          callback_data: `nokos_buy_direct:${service.kode_layanan}`
        });
      }
      keyboard.push(row);
    }

    // Tambahkan button untuk melihat lebih banyak
    if (!searchQuery) {
      keyboard.push([
        { text: "🔍 Cari Layanan", callback_data: "nokos_search" },
        { text: "🌍 Semua Negara", callback_data: "nokos_all_countries" }
      ]);
    }

    let message = `📱 *LAYANAN NOKOS ${searchQuery ? `- "${searchQuery}"` : 'POPULER'}*\n\n`;
    message += `*Total:* ${services.length} layanan\n\n`;
    message += `💡 *Pilih layanan di bawah atau ketik:*\n`;
    message += `/buynokos <nama_layanan>\n\n`;
    message += `🔍 *Contoh:*\n`;
    message += `/buynokos whatsapp\n`;
    message += `/buynokos instagram\n`;
    message += `/buynokos tiktok`;

    await sendText(chatId, message, {
      reply_markup: {
        inline_keyboard: keyboard
      }
    });

  } catch (error) {
    console.error("layanannokos error:", error.message);
    await sendText(chatId, `❌ Gagal mengambil layanan: ${error.message}`);
  }
});

// === /statusnokos - Cek status order nokos ===
bot.onText(/\/statusnokos(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const orderId = (match[1] || "").trim();

  if (!orderId) {
    return sendText(chatId,
      `📊 *CEK STATUS NOKOS*\n\n` +
      `Format: /statusnokos <order_id>\n\n` +
      `Contoh:\n` +
      `/statusnokos 809244431\n\n` +
      `Gunakan /historynokos untuk melihat riwayat order`
    );
  }

  try {
    await sendText(chatId, `⏳ Mengecek status order ${orderId}...`);
    
    const status = await checkNokosStatus(orderId);
    
    const statusMessage = `
📊 *STATUS ORDER NOKOS*

🆔 Order ID: \`${orderId}\`
📊 Status: ${status.status}
📝 Keterangan: ${status.keterangan}

${status.status === 'Success' ? '✅ OTP telah diterima' : '⏳ Menunggu OTP...'}
    `.trim();

    await sendText(chatId, statusMessage);

  } catch (error) {
    console.error("statusnokos error:", error.message);
    await sendText(chatId, `❌ Gagal cek status: ${error.message}`);
  }
});

// === /deposit - Deposit saldo ===
bot.onText(/\/deposit(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const nominalStr = (match[1] || "").trim();

  if (!nominalStr) {
    return sendText(chatId,
      `💰 *DEPOSIT SALDO*\n\n` +
      `Format: /deposit <nominal>\n\n` +
      `Contoh:\n` +
      `/deposit 10000\n` +
      `/deposit 50000\n\n` +
      `Minimal deposit: Rp 5,000`
    );
  }

  const nominal = Number(nominalStr);
  if (isNaN(nominal) || nominal < 5000) {
    return sendText(chatId, "❌ Nominal tidak valid. Minimal deposit Rp 5,000");
  }

  if (activeOrders[userId]) {
    return sendText(chatId, `${UI.warn} Kamu masih punya transaksi yang belum selesai.`);
  }

  await createDepositPayment(msg, nominal);
});

async function createDepositPayment(msg, nominal) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const nama = msg.from.first_name || "Customer";

  const unik = generateRandomUnique(110, 250);
  const totalBayar = nominal + unik;
  const reffId = `deposit-${userId}-${Date.now()}`;
  const expireAt = Date.now() + (15 * 60 * 1000); // 15 menit

  if (!Atlantic.ApiKey) {
    return sendText(chatId, `${UI.no} Atlantic.ApiKey belum dikonfigurasi di settings.js`);
  }

  try {
    await sendText(chatId, "⏳ Membuat invoice deposit...");

    const createRes = await atlDepositCreate(reffId, totalBayar);

    if (!createRes?.data) {
      throw new Error(createRes?.message || "Tidak ada data dari payment gateway.");
    }

    const paymentData = createRes.data;

    const captionText = [
      UI.box("💰 DEPOSIT SALDO"),
      `${UI.dot} Nominal : ${formatRupiah(nominal)}`,
      `${UI.dot} Unik    : ${formatRupiah(unik)}`,
      `${UI.dot} Total   : *${formatRupiah(totalBayar)}*`,
      "",
      `${UI.dot} Reff ID: \`${reffId}\``,
      `${UI.dot} Pay ID : \`${paymentData.id}\``,
      `${UI.dot} Expire : ${moment(expireAt).format("HH:mm:ss")}`,
      "",
      `${UI.dot} *Cara Bayar:*`,
      `1. Scan QRIS di atas`,
      `2. Bayar tepat sampai 3 digit terakhir`,
      `3. Tekan tombol "Cek Status"`,
      "",
      UI.foot("Saldo akan otomatis ditambahkan setelah pembayaran"),
    ].join("\n");

    let payMsg;

    // Generate QR dari string
    if (paymentData.qr_string) {
      try {
        const qrBuffer = await generateLocalQr(paymentData.qr_string);
        if (qrBuffer) {
          payMsg = await bot.sendPhoto(chatId, qrBuffer, {
            caption: captionText,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔄 Cek Status", callback_data: `deposit_check:${paymentData.id}` }],
                [{ text: "✖️ Batalkan", callback_data: `deposit_cancel:${paymentData.id}` }],
              ],
            },
          });
        }
      } catch (qrError) {
        console.error("[QR] Error generate from string:", qrError);
      }
    }

    // Simpan deposit order
    activeOrders[userId] = {
      userId,
      chatId,
      type: "deposit",
      price: nominal,
      total: totalBayar,
      paymentId: paymentData.id,
      reffId,
      expireAt,
      payload: { nominal },
      payMsg: payMsg ? {
        chatId: payMsg.chat.id,
        messageId: payMsg.message_id,
      } : null,
    };

    // Mulai polling status
    startOrderPolling(activeOrders[userId]);

  } catch (e) {
    console.error("createDepositPayment error:", e.message);
    await sendText(chatId, `${UI.no} Gagal membuat invoice deposit: ${e.message}`);
  }
}

// === /saldo - Cek saldo ===
bot.onText(/\/saldo/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const saldo = getUserSaldo(userId);
  
  const saldoMessage = `
💰 *SALDO ANDA*

📊 Saldo: *${formatRupiah(saldo)}*

💡 *Fitur yang bisa digunakan:*
• Beli Nokos (/buynokos)
• Layanan lainnya

💳 Deposit: /deposit
📋 Riwayat: /historynokos
  `.trim();

  await sendText(chatId, saldoMessage, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "💰 Deposit", callback_data: "menu_deposit" },
          { text: "📱 Beli Nokos", callback_data: "menu_buynokos" }
        ]
      ]
    }
  });
});

// === /historynokos - Riwayat order nokos ===
bot.onText(/\/historynokos/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const nokosOrders = readJSON(DB_FILES.nokos, []);
    const userOrders = nokosOrders.filter(order => order.userId === userId).slice(-10); // 10 order terakhir

    if (userOrders.length === 0) {
      return sendText(chatId, "📭 Anda belum memiliki riwayat order nokos.");
    }

    let message = `📋 *RIWAYAT ORDER NOKOS*\n\n`;
    
    userOrders.reverse().forEach((order, index) => {
      const orderDate = new Date(order.createdAt).toLocaleDateString('id-ID');
      const statusIcon = order.status === 'success' ? '✅' : order.status === 'pending' ? '⏳' : '❌';
      
      message += `${index + 1}. ${statusIcon} ${order.layanan}\n`;
      message += `   💰 ${formatRupiah(order.harga)} | 📅 ${orderDate}\n`;
      message += `   🆔 \`${order.id}\` | 📱 ${order.target}\n\n`;
    });

    await sendText(chatId, message);

  } catch (error) {
    console.error("historynokos error:", error.message);
    await sendText(chatId, "❌ Gagal mengambil riwayat order.");
  }
});

// === OWNER: /addsaldo - Tambah saldo user ===
bot.onText(/\/addsaldo(?:\s+(.+))?/, async (msg, match) => {
  if (!isOwner(msg)) return;
  const chatId = msg.chat.id;
  const args = (match[1] || "").trim();

  if (!args) {
    return sendText(chatId,
      `💰 *TAMBAH SALDO USER*\n\n` +
      `Format: /addsaldo <user_id> <nominal>\n\n` +
      `Contoh:\n` +
      `/addsaldo 123456789 50000`
    );
  }

  const [userIdStr, nominalStr] = args.split(/\s+/);
  const userId = Number(userIdStr);
  const nominal = Number(nominalStr);

  if (!userId || !nominal || isNaN(userId) || isNaN(nominal)) {
    return sendText(chatId, "❌ Format salah. Contoh: /addsaldo 123456789 50000");
  }

  try {
    const newSaldo = updateUserSaldo(userId, nominal);
    
    if (newSaldo !== null) {
      await sendText(chatId,
        `✅ *SALDO BERHASIL DITAMBAHKAN*\n\n` +
        `👤 User ID: ${userId}\n` +
        `💰 Nominal: ${formatRupiah(nominal)}\n` +
        `📊 Saldo Baru: ${formatRupiah(newSaldo)}`
      );

      // Notify user
      try {
        await sendText(userId,
          `💰 *SALDO ANDA DITAMBAHKAN*\n\n` +
          `Admin telah menambahkan saldo ke akun Anda:\n\n` +
          `💵 Nominal: ${formatRupiah(nominal)}\n` +
          `📊 Saldo Sekarang: ${formatRupiah(newSaldo)}\n\n` +
          `Terima kasih! 🎉`
        );
      } catch (e) {
        console.error("Gagal notify user:", e.message);
      }
    } else {
      await sendText(chatId, "❌ Gagal menambah saldo.");
    }

  } catch (error) {
    console.error("addsaldo error:", error.message);
    await sendText(chatId, "❌ Gagal menambah saldo.");
  }
});

// === OWNER: /delsaldo - Kurangi saldo user ===
bot.onText(/\/delsaldo(?:\s+(.+))?/, async (msg, match) => {
  if (!isOwner(msg)) return;
  const chatId = msg.chat.id;
  const args = (match[1] || "").trim();

  if (!args) {
    return sendText(chatId,
      `💰 *KURANGI SALDO USER*\n\n` +
      `Format: /delsaldo <user_id> <nominal>\n\n` +
      `Contoh:\n` +
      `/delsaldo 123456789 50000`
    );
  }

  const [userIdStr, nominalStr] = args.split(/\s+/);
  const userId = Number(userIdStr);
  const nominal = Number(nominalStr);

  if (!userId || !nominal || isNaN(userId) || isNaN(nominal)) {
    return sendText(chatId, "❌ Format salah. Contoh: /delsaldo 123456789 50000");
  }

  try {
    const currentSaldo = getUserSaldo(userId);
    if (currentSaldo < nominal) {
      return sendText(chatId, `❌ Saldo user tidak cukup. Saldo saat ini: ${formatRupiah(currentSaldo)}`);
    }

    const newSaldo = updateUserSaldo(userId, -nominal);
    
    if (newSaldo !== null) {
      await sendText(chatId,
        `✅ *SALDO BERHASIL DIKURANGI*\n\n` +
        `👤 User ID: ${userId}\n` +
        `💰 Nominal: ${formatRupiah(nominal)}\n` +
        `📊 Saldo Baru: ${formatRupiah(newSaldo)}`
      );
    } else {
      await sendText(chatId, "❌ Gagal mengurangi saldo.");
    }

  } catch (error) {
    console.error("delsaldo error:", error.message);
    await sendText(chatId, "❌ Gagal mengurangi saldo.");
  }
});

// === OWNER: /listsaldo - List semua saldo ===
bot.onText(/\/listsaldo/, async (msg) => {
  if (!isOwner(msg)) return;
  const chatId = msg.chat.id;

  try {
    const allSaldos = getAllSaldos();
    const users = readJSON(DB_FILES.users, []);
    
    let message = `💰 *LIST SALDO USER*\n\n`;
    let totalSaldo = 0;
    let userCount = 0;

    Object.keys(allSaldos).forEach(userId => {
      const saldo = allSaldos[userId];
      if (saldo > 0) {
        const user = users.find(u => u.id == userId);
        const username = user ? `@${user.username}` : 'N/A';
        const name = user ? `${user.firstName}` : 'Unknown';
        
        message += `👤 ${name} (${username})\n`;
        message += `🆔 ${userId} | 💰 ${formatRupiah(saldo)}\n\n`;
        
        totalSaldo += saldo;
        userCount++;
      }
    });

    message += `📊 *Total:* ${userCount} user\n`;
    message += `💰 *Total Saldo:* ${formatRupiah(totalSaldo)}`;

    await sendText(chatId, message);

  } catch (error) {
    console.error("listsaldo error:", error.message);
    await sendText(chatId, "❌ Gagal mengambil data saldo.");
  }
});

// === /withdraw - Transfer saldo Atlantic ===
bot.onText(/^\/(withdraw|wd|transfer|tf)(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) {
    return sendText(chatId, `${UI.no} Command ini hanya untuk owner.`);
  }

  const nominalStr = (match[2] || "").trim();

  if (!nominalStr) {
    return sendText(chatId,
      `💰 *WITHDRAW SALDO ATLANTIC*\n\n` +
      `Format: /withdraw <nominal>\n\n` +
      `Contoh:\n` +
      `/withdraw 10000\n` +
      `/wd 50000\n\n` +
      `Minimal withdraw: Rp 1,000\n` +
      `Tujuan: ${Atlantic.wd_balance.destination_name} (${Atlantic.wd_balance.destination_number})`
    );
  }

  const nominal = Number(nominalStr);
  if (isNaN(nominal) || nominal < 1000) {
    return sendText(chatId, "❌ Nominal tidak valid. Minimal withdraw Rp 1,000");
  }

  try {
    await sendText(chatId, `⏳ Memproses withdraw Rp ${nominal.toLocaleString('id-ID')}...`);

    const transferData = await atlanticTransfer(nominal, `Withdraw dari ${BotConfig.name}`);
    
    const transferMessage = `
✅ *PERMINTANAN WITHDRAW DIBUAT*

📊 Detail Transfer:
• Reff ID: \`${transferData.reff_id}\`
• Transfer ID: \`${transferData.id}\`
• Nama: ${transferData.nama}
• No Tujuan: ${transferData.nomor_tujuan}
• Nominal: ${formatRupiah(transferData.nominal)}
• Fee: ${formatRupiah(transferData.fee)}
• Total: ${formatRupiah(transferData.total)}
• Dibuat: ${transferData.created_at}

⏳ Menunggu konfirmasi transfer...
    `.trim();

    const sentMsg = await sendText(chatId, transferMessage, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔄 Cek Status", callback_data: `wd_status:${transferData.id}` },
            { text: "💰 Cek Saldo", callback_data: "atlantic_balance" }
          ]
        ]
      }
    });

    // Mulai polling status transfer
    startTransferPolling(transferData.id, chatId, sentMsg.message_id);

  } catch (error) {
    console.error("withdraw error:", error.message);
    await sendText(chatId, `❌ Gagal melakukan withdraw: ${error.message}`);
  }
});

// === /balance - Cek saldo Atlantic ===
bot.onText(/^\/(balance|saldoatlantic|atlanticsaldo)$/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) {
    return sendText(chatId, `${UI.no} Command ini hanya untuk owner.`);
  }

  try {
    await sendText(chatId, "⏳ Mengecek saldo Atlantic...");

    const balanceData = await atlanticCheckBalance();
    
    const balanceMessage = `
💰 *SALDO ATLANTIC*

📊 Saldo: *${formatRupiah(balanceData.balance)}*

👤 Profile:
• Nama: ${balanceData.name}
• Email: ${balanceData.email}
• Phone: ${balanceData.phone}

💳 Tujuan Withdraw:
• Bank: ${Atlantic.wd_balance.bank_code}
• Nomor: ${Atlantic.wd_balance.destination_number}
• Nama: ${Atlantic.wd_balance.destination_name}
    `.trim();

    await sendText(chatId, balanceMessage, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔄 Refresh", callback_data: "atlantic_balance" },
            { text: "💸 Withdraw", callback_data: "menu_withdraw" }
          ]
        ]
      }
    });

  } catch (error) {
    console.error("balance error:", error.message);
    await sendText(chatId, `❌ Gagal cek saldo: ${error.message}`);
  }
});

// === POLLING TRANSFER STATUS ===
function startTransferPolling(transferId, chatId, messageId) {
  let done = false;
  let count = 0;
  const maxPoll = 30; // 30x polling (~2.5 menit)

  const poll = async () => {
    if (done || count >= maxPoll) return;
    count++;

    try {
      const statusData = await atlanticTransferStatus(transferId);
      const transferStatus = statusData.data?.status;

      console.log(`[Transfer Status ${transferId}] =>`, transferStatus);

      if (transferStatus === "success") {
        done = true;
        
        await sendText(chatId,
          `✅ *TRANSFER BERHASIL*\n\n` +
          `Transfer ID: \`${transferId}\`\n` +
          `Status: ${transferStatus}\n\n` +
          `Dana telah berhasil dikirim ke tujuan.`
        );
        return;
      }

      if (transferStatus === "failed" || transferStatus === "cancel") {
        done = true;
        
        await sendText(chatId,
          `❌ *TRANSFER GAGAL*\n\n` +
          `Transfer ID: \`${transferId}\`\n` +
          `Status: ${transferStatus}\n\n` +
          `Silakan coba lagi atau hubungi support.`
        );
        return;
      }

      // Update status message setiap 5x polling
      if (count % 5 === 0) {
        try {
          await bot.editMessageText(
            `⏳ *STATUS TRANSFER* - Polling ke-${count}\n\n` +
            `Transfer ID: \`${transferId}\`\n` +
            `Status: ${transferStatus || 'processing'}\n\n` +
            `Tunggu konfirmasi...`,
            {
              chat_id: chatId,
              message_id: messageId,
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "🔄 Cek Status", callback_data: `wd_status:${transferId}` },
                    { text: "💰 Cek Saldo", callback_data: "atlantic_balance" }
                  ]
                ]
              }
            }
          );
        } catch (editError) {
          console.error("Edit message error:", editError.message);
        }
      }

      // Polling berikutnya
      const delay = 5000; // 5 detik
      setTimeout(poll, delay);

    } catch (error) {
      console.error("transfer polling error:", error.message);
      const delay = Math.min(10000 * Math.pow(1.2, Math.floor(count / 3)), 30000);
      setTimeout(poll, delay);
    }
  };

  setTimeout(poll, 5000);
}

// === /testnotif - Test notifikasi ke channel ===
bot.onText(/\/testnotif/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) {
    return sendText(chatId, `${UI.no} Command ini hanya untuk owner.`);
  }

  try {
    await sendText(chatId, "🧪 Mengirim test notifikasi ke channel...");

    const testMessage = `
🧪 <b>TEST NOTIFIKASI</b>

Ini adalah test notifikasi dari bot.
Bot berhasil terhubung dengan channel!

📅 Waktu: ${nowID()}
🤖 Bot: ${BotConfig.name}
    `.trim();

    const result = await sendToChannel(testMessage);

    if (result) {
      await sendText(chatId, "✅ Test notifikasi berhasil dikirim ke channel!");
    } else {
      await sendText(chatId, "❌ Gagal mengirim test notifikasi. Pastikan:\n• Bot sudah jadi admin di channel\n• Username channel sudah benar di settings.js");
    }

  } catch (error) {
    console.error("testnotif error:", error.message);
    await sendText(chatId, `❌ Error: ${error.message}`);
  }
});

// === CALLBACK QUERY HANDLER ===
bot.on("callback_query", async (q) => {
  const data = String(q.data || "");
  const chatId = q.message.chat.id;
  const userId = q.from.id;

  try {

    // Dalam callback_query handler, tambahkan:
if (data.startsWith("wd_status:")) {
  const transferId = data.split(":")[1];
  await bot.answerCallbackQuery(q.id);
  
  if (!isOwner({ from: { id: userId } })) {
    return sendText(chatId, `${UI.no} Hanya owner yang bisa cek status transfer.`);
  }

  try {
    await sendText(chatId, `⏳ Mengecek status transfer ${transferId}...`);
    
    const statusData = await atlanticTransferStatus(transferId);
    const transferStatus = statusData.data?.status;
    
    const statusMessage = `
📊 *STATUS TRANSFER*

🆔 Transfer ID: \`${transferId}\`
📊 Status: *${transferStatus || 'processing'}*

${transferStatus === 'success' ? '✅ Transfer berhasil' : 
  transferStatus === 'failed' ? '❌ Transfer gagal' : '⏳ Sedang diproses...'}
    `.trim();

    await sendText(chatId, statusMessage);

  } catch (error) {
    await sendText(chatId, `❌ Gagal cek status: ${error.message}`);
  }
  return;
}

if (data === "atlantic_balance") {
  await bot.answerCallbackQuery(q.id);
  
  if (!isOwner({ from: { id: userId } })) {
    return sendText(chatId, `${UI.no} Hanya owner yang bisa cek saldo.`);
  }

  // Panggil command balance
  const dummyMsg = { 
    chat: { id: chatId }, 
    from: { id: userId },
    text: '/balance'
  };
  bot.emit('text', dummyMsg);
  return;
}

if (data === "menu_withdraw") {
  await bot.answerCallbackQuery(q.id);
  
  if (!isOwner({ from: { id: userId } })) {
    return sendText(chatId, `${UI.no} Hanya owner yang bisa withdraw.`);
  }

  return sendText(chatId,
    `💰 *WITHDRAW SALDO ATLANTIC*\n\n` +
    `Format: /withdraw <nominal>\n\n` +
    `Contoh:\n` +
    `/withdraw 10000\n` +
    `/wd 50000\n\n` +
    `Minimal withdraw: Rp 1,000`
  );
}

    if (data === "menu_buypanel") {
      await bot.answerCallbackQuery(q.id);
      return sendText(
        chatId,
        `Untuk beli panel, gunakan perintah:\n\n` +
          `*/buypanel username*\n\n` +
          `Contoh:\n` +
          `*/buypanel skyzopedia*`
      );
    }

    if (data === "menu_buyadp") {
      await bot.answerCallbackQuery(q.id);
      return sendText(
        chatId,
        `Untuk beli admin panel, gunakan perintah:\n\n` +
          `*/buyadp username*`
      );
    }

    // Dalam callback_query handler, tambahkan:
if (data.startsWith("warranty_approve:")) {
  const claimId = data.split(":")[1];
  await bot.answerCallbackQuery(q.id);
  
  if (!isOwner({ from: { id: userId } })) {
    return sendText(chatId, `${UI.no} Hanya owner yang bisa approve claim.`);
  }
  
  await processWarrantyApproval(claimId, true, userId);
  return;
}

if (data.startsWith("nokos_status:")) {
      const orderId = data.split(":")[1];
      await bot.answerCallbackQuery(q.id);
      
      try {
        await sendText(chatId, `⏳ Mengecek status order ${orderId}...`);
        const status = await checkNokosStatus(orderId);
        
        const statusMessage = `
📊 *STATUS ORDER NOKOS*

🆔 Order ID: \`${orderId}\`
📊 Status: ${status.status}
📝 Keterangan: ${status.keterangan}

${status.status === 'Success' ? '✅ OTP telah diterima' : '⏳ Menunggu OTP...'}
        `.trim();

        await sendText(chatId, statusMessage);
      } catch (error) {
        await sendText(chatId, `❌ Gagal cek status: ${error.message}`);
      }
      return;
    }

    // Callback untuk nokos cancel
    if (data.startsWith("nokos_cancel:")) {
      const orderId = data.split(":")[1];
      await bot.answerCallbackQuery(q.id);
      
      try {
        await sendText(chatId, `⏳ Membatalkan order ${orderId}...`);
        await cancelNokos(orderId);
        
        // Update status di database
        const nokosOrders = readJSON(DB_FILES.nokos, []);
        const orderIndex = nokosOrders.findIndex(order => order.id === orderId && order.userId === userId);
        
        if (orderIndex !== -1) {
          // Kembalikan saldo jika order dibatalkan
          const order = nokosOrders[orderIndex];
          if (order.status === "pending") {
            updateUserSaldo(userId, order.harga);
            nokosOrders[orderIndex].status = "cancelled";
            nokosOrders[orderIndex].saldoDikembalikan = order.harga;
            nokosOrders[orderIndex].saldoSisa = getUserSaldo(userId);
            writeJSON(DB_FILES.nokos, nokosOrders);
          }
        }
        
        await sendText(chatId, `✅ Order ${orderId} berhasil dibatalkan. Saldo telah dikembalikan.`);
      } catch (error) {
        await sendText(chatId, `❌ Gagal membatalkan order: ${error.message}`);
      }
      return;
    }

    // Callback untuk deposit check
    if (data.startsWith("deposit_check:")) {
      const payId = data.split(":")[1];
      await bot.answerCallbackQuery(q.id);
      
      const order = Object.values(activeOrders).find(
        (o) => o.paymentId === payId && o.userId === userId
      );
      
      if (!order) {
        await sendText(chatId, "❌ Transaksi tidak ditemukan / sudah selesai.");
        return;
      }

      try {
        const statRes = await atlDepositStatus(payId);
        const sdata = statRes?.data;
        const status = String(sdata?.status || "").toLowerCase();

        await sendText(chatId, `Status deposit: *${status.toUpperCase()}*`);

        if (status === "success") {
          await handleDepositSuccess(order, sdata);
        } else if (status === "failed" || status === "cancel") {
          await handleDepositFailed(order, "Deposit gagal / dibatalkan.");
        }
      } catch (e) {
        await sendText(chatId, `❌ Gagal cek status: ${e.message}`);
      }
      return;
    }

    // Callback untuk deposit cancel
    if (data.startsWith("deposit_cancel:")) {
      const payId = data.split(":")[1];
      await bot.answerCallbackQuery(q.id);
      
      const order = Object.values(activeOrders).find(
        (o) => o.paymentId === payId && o.userId === userId
      );
      
      if (!order) {
        await sendText(chatId, "❌ Transaksi tidak ditemukan / sudah selesai.");
        return;
      }

      try {
        await atlDepositCancel(payId);
      } catch {}

      await handleDepositFailed(order, "Dibatalkan oleh user.");
      try {
        if (order.payMsg) {
          await bot.deleteMessage(order.payMsg.chatId, order.payMsg.messageId);
        }
      } catch {}
      return;
    }

    // Menu deposit
    if (data === "menu_deposit") {
      await bot.answerCallbackQuery(q.id);
      return sendText(chatId,
        `💰 *DEPOSIT SALDO*\n\n` +
        `Format: /deposit <nominal>\n\n` +
        `Contoh:\n` +
        `/deposit 10000\n` +
        `/deposit 50000\n\n` +
        `Minimal deposit: Rp 5,000`
      );
    }

    // Menu beli nokos
    if (data === "menu_buynokos") {
      await bot.answerCallbackQuery(q.id);
      return sendText(chatId,
        `📱 *BELI NOMOR KOSONG (NOKOS)*\n\n` +
        `Format: /buynokos <layanan>\n\n` +
        `Contoh:\n` +
        `/buynokos whatsapp\n` +
        `/buynokos gopay\n\n` +
        `Gunakan /layanannokos untuk melihat list layanan`
      );
    }

if (data.startsWith("warranty_reject:")) {
  const claimId = data.split(":")[1];
  await bot.answerCallbackQuery(q.id);
  
  if (!isOwner({ from: { id: userId } })) {
    return sendText(chatId, `${UI.no} Hanya owner yang bisa reject claim.`);
  }
  
  await processWarrantyApproval(claimId, false, userId);
  return;
}

    if (data === "menu_buyreseller") {
      await bot.answerCallbackQuery(q.id);
      return sendText(
        chatId,
        `Untuk beli Reseller Panel, gunakan perintah:\n\n` +
          `*/buyresellerpanel*`
      );
    }

    // Dalam callback_query handler, tambahkan:
if (data === "owner_cleanpanel") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) {
    return sendText(chatId, `${UI.no} Hanya owner yang bisa pakai tombol ini.`);
  }
  
  const teks = [
    UI.box("🗑️ CLEAN PANEL"),
    `${UI.dot} *Peringatan!* Fitur ini akan menghapus:`,
    `  • Semua user non-admin`,
    `  • Semua server milik user non-admin`,
    "",
    `${UI.dot} *Data yang aman:*`,
    `  • User admin (root_admin=true)`,
    `  • Server milik admin`,
    "",
    `${UI.dot} Gunakan command:`,
    `  /delallnonadmin`,
    "",
    UI.foot("Hati-hati dalam menggunakan fitur ini!"),
  ].join("\n");
  
  return sendText(chatId, teks);
}

// Dalam callback_query handler, tambahkan:
if (data === "menu_myorders") {
  await bot.answerCallbackQuery(q.id);
  
  const userOrders = getOrdersByUser(userId);
  
  if (userOrders.length === 0) {
    return sendText(chatId, "📭 Anda belum memiliki order yang selesai.");
  }

  let teks = `📦 *ORDER HISTORY*\n\n`;
  
  userOrders.forEach((order, index) => {
    const orderDate = new Date(order.createdAt).toLocaleDateString('id-ID');
    const warrantyStatus = order.warranty.eligible ? 
      (order.warranty.claimed ? `❌ Used` : `✅ Available`) : 
      `❌ Not eligible`;
    
    teks += `${index + 1}. *${order.type.toUpperCase()}* - ${order.username}\n`;
    teks += `   💰 ${formatRupiah(order.total)} | 📅 ${orderDate}\n`;
    teks += `   🛡️ Garansi: ${warrantyStatus}\n\n`;
  });

  teks += `ℹ️ Gunakan /claim <order_id> untuk klaim garansi`;

  return sendText(chatId, teks);
}

if (data === "owner_todayusers") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) return;
  
  const todayCount = getTodayUsersCount();
  await sendText(chatId, `👥 Users today: *${todayCount}*`);
  return;
}

if (data === "owner_listservers") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) {
    return sendText(chatId, `${UI.no} Hanya owner yang bisa pakai tombol ini.`);
  }

  // Dalam callback_query handler, tambahkan:
if (data === "bc_test_doc") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) return;
  
  await sendText(chatId,
    `🧪 *TEST DOCUMENT BROADCAST*\n\n` +
    `Untuk test document broadcast:\n` +
    `1. Kirim file/document ke chat ini\n` +
    `2. Reply file tersebut\n` +
    `3. Ketik: /bcdoctest <caption>\n\n` +
    `Contoh:\n` +
    `/bcdoctest Ini test document broadcast`
  );
  return;
}

if (data === "bc_start_doc") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) return;
  
  await sendText(chatId,
    `📄 *START DOCUMENT BROADCAST*\n\n` +
    `Untuk document broadcast:\n` +
    `1. Kirim file/document ke chat ini\n` +
    `2. Reply file tersebut\n` +
    `3. Ketik: /bcdoc <caption>\n\n` +
    `Contoh:\n` +
    `/bcdoc Download file penting ini`
  );
  return;
}
  
  try {
    await sendText(chatId, "⏳ Mengambil data servers...");
    const servers = await pteroGetServers();
    
    if (servers.length === 0) {
      return sendText(chatId, `${UI.ok} Tidak ada server panel.`);
    }

    let teks = `${UI.box("📡 LIST SERVER PANEL")}\n`;
    teks += `${UI.dot} Total: ${servers.length} server\n\n`;

    servers.slice(0, 10).forEach((server, index) => {
      const s = server.attributes;
      const { ram, disk, cpu } = formatResources(server);
      
      teks += `${index + 1}. *${s.name}*\n`;
      teks += `   ID: ${s.id} | User: ${s.user}\n`;
      teks += `   RAM: ${ram} | Disk: ${disk}\n\n`;
    });

    if (servers.length > 10) {
      teks += `... dan ${servers.length - 10} server lainnya\n\n`;
    }

    teks += UI.foot(`Gunakan /listservers untuk melihat lengkap`);
    return sendText(chatId, teks);

  } catch (e) {
    return sendText(chatId, `${UI.no} Error: ${e.message}`);
  }
}

    if (data === "menu_buyuserbot") {
      await bot.answerCallbackQuery(q.id);
      return sendText(
        chatId,
        `Untuk Beli Userbot (akses grup), gunakan perintah:\n\n` +
          `*/buyuserbot*`
      );
    }

    if (data === "menu_buysc") {
      await bot.answerCallbackQuery(q.id);
      return sendText(
        chatId,
        `Untuk beli script, gunakan perintah:\n\n` +
          `*/buysc*\n` +
          `Lalu pilih script yang tersedia.`
      );
    }

    if (data === "owner_listsc") {
      await bot.answerCallbackQuery(q.id);
      if (!isOwner({ from: { id: userId } })) {
        return sendText(chatId, `${UI.no} Hanya owner yang bisa pakai tombol ini.`);
      }
      const scripts = readJSON(DB_FILES.script, []);
      if (!scripts.length) {
        return sendText(chatId, "Belum ada script yang tersimpan.");
      }
      let teks = `${UI.box("📜 LIST SCRIPT")}\n`;
      scripts.forEach((sc, i) => {
        teks += `\n${i + 1}. *${sc.nama}*\n`;
        teks += `   Harga : ${formatRupiah(sc.harga)}\n`;
        teks += `   Desk  : ${sc.deskripsi}\n`;
      });
      teks += `\n${UI.foot(`Total: ${scripts.length} script`)}`;
      return sendText(chatId, teks);
    }

    if (data === "owner_help_addsc") {
      await bot.answerCallbackQuery(q.id);
      if (!isOwner({ from: { id: userId } })) {
        return sendText(chatId, `${UI.no} Hanya owner yang bisa pakai tombol ini.`);
      }
      const teksHelp = [
        UI.box("➕ CARA ADD SCRIPT"),
        `${UI.dot} 1. Kirim file *.zip* script ke bot.`,
        `${UI.dot} 2. Reply file tersebut dengan format:`,
        "",
        "   `/addsc namasc|deskripsi|harga`",
        "",
        `Contoh:`,
        "   `/addsc BotShopV4|Script bot shop lengkap|50000`",
        "",
        `${UI.dot} Bot akan menyimpan script di database dan bisa dibeli lewat /buysc.`,
        UI.foot(BotConfig.name),
      ].join("\n");
      return sendText(chatId, teksHelp);
    }

    if (data === "menu_owner") {
      await bot.answerCallbackQuery(q.id);
      return sendText(
        chatId,
        `${UI.box("👤 KONTAK OWNER")}\n` +
          `${UI.dot} Owner: ${Owner.username}\n` +
          `${UI.dot} Silakan chat jika butuh bantuan.`
      );
    }

    // Dalam callback_query handler, tambahkan:
        if (data === "bc_test_text") {
          await bot.answerCallbackQuery(q.id);
          if (!isOwner({ from: { id: userId } })) return;
          
          const testMessage = `🧪 *TEST BROADCAST*\n\nIni adalah pesan test broadcast.\n\nJika Anda menerima ini, berarti broadcast system bekerja dengan baik! ✅\n\n_— ${BotConfig.name}_`;
          
          await broadcastTextToAllUsers(testMessage, { 
            showProgressTo: chatId,
            testMode: true,
            testUserId: userId
          });
          return;
        }

        if (data === "bc_test_photo") {
          await bot.answerCallbackQuery(q.id);
          if (!isOwner({ from: { id: userId } })) return;
          
          const testPhotoUrl = "https://via.placeholder.com/400x200/2C3E50/FFFFFF?text=Test+Broadcast";
          const testCaption = `🧪 TEST PHOTO BROADCAST\n\nIni adalah test broadcast dengan photo.\n\nJika Anda menerima ini, berarti photo broadcast system bekerja dengan baik! ✅`;
          
          await broadcastPhotoToAllUsers(testPhotoUrl, testCaption, { 
            showProgressTo: chatId,
            testMode: true,
            testUserId: userId
          });
          return;
        }

        if (data === "bc_start_text") {
          await bot.answerCallbackQuery(q.id);
          if (!isOwner({ from: { id: userId } })) return;
          
          await sendText(chatId, 
            `📢 *START TEXT BROADCAST*\n\n` +
            `Silakan ketik pesan broadcast Anda:\n\n` +
            `Format: /bc <pesan>\n\n` +
            `Contoh:\n` +
            `/bc Halo semua member! Ada update fitur baru nih...`
          );
          return;
        }

        if (data === "bc_start_photo") {
          await bot.answerCallbackQuery(q.id);
          if (!isOwner({ from: { id: userId } })) return;
          
          await sendText(chatId,
            `🖼️ *START PHOTO BROADCAST*\n\n` +
            `Silakan kirim perintah photo broadcast:\n\n` +
            `Format: /bcphoto <url_gambar>|<caption>\n\n` +
            `Contoh:\n` +
            `/bcphoto https://example.com/image.jpg|Halo semua! Lihat gambar ini`
          );
          return;
        }

        // Dalam callback_query handler, tambahkan sub-menu:
if (data === "owner_menu_script") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) return;
  
  const teks = [
    UI.box("📜 SCRIPT MANAGEMENT"),
    `${UI.dot} *Available Commands:*`,
    "",
    "• /addsc namasc|deskripsi|harga",
    "  (reply file .zip)",
    "",
    "• /listsc",
    "  → list semua script",
    "",
    "• /delsc namasc",
    "  → hapus script",
    "",
    "• /setharga_sc namasc|harga",
    "  → ubah harga script",
    "",
    UI.foot("Gunakan buttons untuk aksi cepat"),
  ].join("\n");

  await sendText(chatId, teks, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📋 List Script", callback_data: "owner_listsc" },
          { text: "➕ Add Script", callback_data: "owner_help_addsc" },
        ],
        [
          { text: "🔙 Back", callback_data: "owner_menu_back" },
        ],
      ],
    },
  });
  return;
}

if (data === "owner_menu_pricing") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) return;
  
  const teks = [
    UI.box("💰 PRICING MANAGEMENT"),
    `${UI.dot} *Available Commands:*`,
    "",
    "• /listharga",
    "  → lihat semua harga",
    "",
    "• /setharga_panel paket harga",
    "  → ubah harga panel",
    "  Contoh: /setharga_panel 1gb 1500",
    "",
    "• /setharga_reseller harga",
    "  → ubah harga reseller",
    "",
    "• /setharga_pt harga",
    "  → ubah harga PT/grup",
    "",
    UI.foot("Paket: 1gb, 2gb, 3gb, ..., unli"),
  ].join("\n");

  await sendText(chatId, teks, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "💰 List Harga", callback_data: "owner_listharga" },
        ],
        [
          { text: "🔙 Back", callback_data: "owner_menu_back" },
        ],
      ],
    },
  });
  return;
}

if (data === "owner_menu_panel") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) return;
  
  const teks = [
    UI.box("🛠️ PANEL MANAGEMENT"),
    `${UI.dot} *Available Commands:*`,
    "",
    "• /listusers",
    "  → list semua user panel",
    "",
    "• /listadmins",
    "  → list admin panel",
    "",
    "• /listservers",
    "  → list semua server",
    "",
    "• /delserver server_id",
    "  → hapus server",
    "",
    "• /deluser user_id",
    "  → hapus user",
    "",
    "• /delallnonadmin",
    "  → hapus semua non-admin",
    "",
    "• /createadmin username",
    "  → buat admin panel",
    "",
    "• /createpanel username,ram",
    "  → buat panel user",
    "",
    UI.foot("Contoh: /createpanel user1,1gb"),
  ].join("\n");

  await sendText(chatId, teks, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "👥 Users", callback_data: "owner_listusers" },
          { text: "🛠️ Admins", callback_data: "owner_listadmins" },
        ],
        [
          { text: "📡 Servers", callback_data: "owner_listservers" },
          { text: "🗑️ Clean", callback_data: "owner_cleanpanel" },
        ],
        [
          { text: "🔙 Back", callback_data: "owner_menu_back" },
        ],
      ],
    },
  });
  return;
}

if (data === "owner_menu_stats") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) return;
  
  const teks = [
    UI.box("📊 STATISTICS & MONITORING"),
    `${UI.dot} *Available Commands:*`,
    "",
    "• /stats",
    "  → statistik lengkap bot",
    "",
    "• /activeorders",
    "  → order aktif",
    "",
    "• /saldo",
    "  → cek saldo Atlantic",
    "",
    "• /bcstats",
    "  → statistik broadcast",
    "",
    UI.foot("Pantau performa bot secara real-time"),
  ].join("\n");

  await sendText(chatId, teks, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📊 Stats", callback_data: "owner_stats" },
          { text: "🔄 Orders", callback_data: "owner_activeorders" },
        ],
        [
          { text: "📢 BC Stats", callback_data: "bc_stats_quick" },
        ],
        [
          { text: "🔙 Back", callback_data: "owner_menu_back" },
        ],
      ],
    },
  });
  return;
}

if (data === "owner_menu_warranty") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) return;
  
  const teks = [
    UI.box("🛡️ WARRANTY MANAGEMENT"),
    `${UI.dot} *Available Commands:*`,
    "",
    "• /pending_claims",
    "  → lihat klaim pending",
    "",
    "• /grant_claimid",
    "  → approve klaim",
    "  Contoh: /grant_claim_123",
    "",
    "• /reject_claimid",
    "  → reject klaim",
    "  Contoh: /reject_claim_123",
    "",
    UI.foot("Klaim garansi 15 hari untuk panel"),
  ].join("\n");

  await sendText(chatId, teks, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📋 Pending Claims", callback_data: "owner_pending_claims" },
        ],
        [
          { text: "🔙 Back", callback_data: "owner_menu_back" },
        ],
      ],
    },
  });
  return;
}

if (data === "owner_menu_broadcast") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) return;
  
  const teks = [
    UI.box("📢 BROADCAST SYSTEM"),
    `${UI.dot} *Available Commands:*`,
    "",
    "• /bc <pesan>",
    "  → broadcast teks",
    "",
    "• /bcphoto",
    "  → broadcast photo (reply/URL)",
    "",
    "• /bcdoc",
    "  → broadcast document (reply)",
    "",
    "• /bctest",
    "  → test broadcast teks",
    "",
    "• /bcphototest",
    "  → test broadcast photo",
    "",
    "• /bcdoctest",
    "  → test broadcast document",
    "",
    UI.foot("Test dulu sebelum broadcast ke semua"),
  ].join("\n");

  await sendText(chatId, teks, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🧪 Test Text", callback_data: "bc_test_text" },
          { text: "🖼️ Test Photo", callback_data: "bc_test_photo" },
        ],
        [
          { text: "📄 Test Doc", callback_data: "bc_test_doc" },
          { text: "📊 BC Stats", callback_data: "bc_stats_quick" },
        ],
        [
          { text: "🔙 Back", callback_data: "owner_menu_back" },
        ],
      ],
    },
  });
  return;
}

if (data === "owner_menu_system") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) return;
  
  const teks = [
    UI.box("⚙️ SYSTEM & MAINTENANCE"),
    `${UI.dot} *Available Commands:*`,
    "",
    "• /backupdb",
    "  → backup database",
    "",
    "• /restart",
    "  → restart bot",
    "",
    UI.foot("Hati-hati dalam menggunakan perintah ini"),
  ].join("\n");

  await sendText(chatId, teks, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔙 Back", callback_data: "owner_menu_back" },
        ],
      ],
    },
  });
  return;
}

if (data === "owner_menu_back") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) return;
  
  // Kembali ke main menu dengan memanggil ulang /ownermenu
  const dummyMsg = { 
    chat: { id: chatId }, 
    from: { id: userId } 
  };
  bot.emit('text', dummyMsg);
  return;
}

// Dalam owner menu, tambahkan opsi financial
if (data === "owner_menu_financial") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) return;
  
  const teks = [
    UI.box("💰 FINANCIAL MANAGEMENT"),
    `${UI.dot} *Available Commands:*`,
    "",
    "• /balance",
    "  → cek saldo Atlantic",
    "",
    "• /withdraw <nominal>",
    "  → withdraw saldo Atlantic",
    "  Contoh: /withdraw 10000",
    "",
    "• /wd <nominal>",
    "  → shortcut withdraw",
    "",
    UI.foot("Minimal withdraw: Rp 1,000"),
  ].join("\n");

  await sendText(chatId, teks, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "💰 Cek Saldo", callback_data: "atlantic_balance" },
          { text: "💸 Withdraw", callback_data: "menu_withdraw" },
        ],
        [
          { text: "🔙 Back", callback_data: "owner_menu_back" },
        ],
      ],
    },
  });
  return;
}

if (data === "owner_pending_claims") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) return;
  
  // Panggil command pending_claims
  const dummyMsg = { 
    chat: { id: chatId }, 
    from: { id: userId },
    text: '/pending_claims'
  };
  bot.emit('text', dummyMsg);
  return;
}

if (data === "bc_stats_quick") {
  await bot.answerCallbackQuery(q.id);
  if (!isOwner({ from: { id: userId } })) return;
  
  // Panggil command bcstats
  const dummyMsg = { 
    chat: { id: chatId }, 
    from: { id: userId },
    text: '/bcstats'
  };
  bot.emit('text', dummyMsg);
  return;
}


          if (data.startsWith("panel_ram:")) {
        const [, key, username] = data.split(":");
        const plan = PANEL_PLANS[key];
        if (!plan) {
          await bot.answerCallbackQuery(q.id, {
            text: "Pilihan RAM tidak valid.",
            show_alert: true,
          });
          return;
        }

        const pricing = getPricing();
        const harga = Number(
          pricing.panel[key] ?? DEFAULT_PRICING.panel[key] ?? 0
        );

        const opt = { ...plan, harga };


      await bot.answerCallbackQuery(q.id);
      const dummyMsg = { chat: { id: chatId }, from: q.from };

      await createOrderPayment(dummyMsg, {
        type: "panel",
        price: opt.harga,
        title: `Panel ${key.toUpperCase()}`,
        payload: {
          username,
          ram: opt.ram,
          disk: opt.disk,
          cpu: opt.cpu,
        },
      });
      return;
    }
    // === SOLUSI SIMPLE: TANPA THUMBNAIL ===
async function sendStartMessageSimple(chatId, userInfo) {
  const nama = userInfo.first_name || "User";
  
  const messageText = `
╭──────────────────────────╮
│         ✨ ${BotConfig.name} ✨         │
╰──────────────────────────╯

Halo ${nama} 👋

📋 *Layanan yang tersedia:*
• 🔌 Panel Pterodactyl Siap Pakai
• 🛠 Admin Panel (Full Root Access)  
• 🤝 Reseller Panel (khusus penjual)
• 🏷 PT / Akses Grup Khusus
• 📜 Script Bot (.zip) Siap Deploy

🆕 *Fitur Baru:*
• 🛡️ Garansi 15 Hari
• 📦 Database Order
• ⚡ Instant Processing

💳 *Metode Pembayaran:*
• QRIS Dinamis via Atlantic H2H

╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
Gunakan menu di bawah untuk mulai!
  `.trim();

  const keyboard = [
    [
      { text: "🔌 Beli Panel", callback_data: "menu_buypanel" },
      { text: "🛠 Admin Panel", callback_data: "menu_buyadp" },
    ],
    [
      { text: "🤝 Reseller", callback_data: "menu_buyreseller" },
      { text: "🏷 Beli Userbot", callback_data: "menu_buyuserbot" },
    ],
    [{ text: "📜 Beli Script", callback_data: "menu_buysc" }],
    [
      { text: "📦 My Orders", callback_data: "menu_myorders" },
      { text: "👤 Kontak Owner", callback_data: "menu_owner" },
    ],
  ];

  if (isOwner({ from: userInfo })) {
    keyboard.push([{ text: "🧑‍💻 Owner Menu", callback_data: "menu_ownermenu" }]);
  }

  await sendText(chatId, messageText, {
    parse_mode: null,
    reply_markup: { inline_keyboard: keyboard },
  });
}

    if (data.startsWith("sc_buy:")) {
      const name = data.replace("sc_buy:", "");
      await bot.answerCallbackQuery(q.id);

      const scripts = readJSON(DB_FILES.script, []);
      const sc = scripts.find((s) => s.nama === name);
      if (!sc) {
        return sendText(chatId, `${UI.no} Script tidak ditemukan.`);
      }

      const dummyMsg = { chat: { id: chatId }, from: q.from };

      await createOrderPayment(dummyMsg, {
        type: "script",
        price: Number(sc.harga),
        title: `Script: ${sc.nama}`,
        payload: { scriptName: sc.nama },
      });
      return;
    }

    if (data.startsWith("order_check:")) {
      const payId = data.split(":")[1];
      const order = Object.values(activeOrders).find(
        (o) => o.paymentId === payId && o.userId === userId
      );
      if (!order) {
        await bot.answerCallbackQuery(q.id, {
          text: "Transaksi tidak ditemukan / sudah selesai.",
          show_alert: true,
        });
        return;
      }

      await bot.answerCallbackQuery(q.id);

      try {
        const statRes = await atlDepositStatus(payId);
        const sdata = statRes?.data;
        const status = String(sdata?.status || "").toLowerCase();

        await sendText(chatId, `Status pembayaran: *${status.toUpperCase()}*`);

        if (status === "success") {
          await handleOrderSuccess(order, sdata);
        } else if (status === "failed" || status === "cancel") {
          await handleOrderFailed(order, "Pembayaran gagal / dibatalkan.");
        }
      } catch (e) {
        await sendText(chatId, `Gagal cek status: ${e.message}`);
      }

      return;
    }
    // Dalam callback_query handler, tambahkan:
if (data === "menu_saldo") {
  await bot.answerCallbackQuery(q.id);
  
  const saldo = getUserSaldo(userId);
  const saldoMessage = `
💰 *SALDO ANDA*

📊 Saldo: *${formatRupiah(saldo)}*

💡 *Fitur yang bisa digunakan:*
• Beli Nokos (/buynokos)

💳 Deposit: /deposit
📋 Riwayat: /historynokos
  `.trim();

  return sendText(chatId, saldoMessage, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "💰 Deposit", callback_data: "menu_deposit" },
          { text: "📱 Beli Nokos", callback_data: "menu_buynokos" }
        ]
      ]
    }
  });
}


// Dalam callback_query handler, tambahkan:
if (data.startsWith("nokos_buy_direct:")) {
  const kodeLayanan = data.split(":")[1];
  await bot.answerCallbackQuery(q.id);
  
  try {
    await sendText(chatId, "⏳ Mengambil info layanan...");
    
    const services = await searchNokosService(kodeLayanan);
    if (services.length === 0) {
      return sendText(chatId, "❌ Layanan tidak ditemukan.");
    }
    
    const service = services[0];
    const dummyMsg = { chat: { id: chatId }, from: q.from };
    await processNokosOrder(dummyMsg, service);
    
  } catch (error) {
    await sendText(chatId, `❌ Gagal memproses: ${error.message}`);
  }
  return;
}

if (data === "nokos_search") {
  await bot.answerCallbackQuery(q.id);
  return sendText(chatId,
    `🔍 *CARI LAYANAN NOKOS*\n\n` +
    `Ketik: /layanannokos <kata_kunci>\n\n` +
    `Contoh:\n` +
    `/layanannokos whatsapp\n` +
    `/layanannokos facebook\n` +
    `/layanannokos tiktok\n\n` +
    `Atau gunakan /buynokos <layanan> untuk langsung beli`
  );
}

if (data === "nokos_all_countries") {
  await bot.answerCallbackQuery(q.id);
  return sendText(chatId,
    `🌍 *SEMUA LAYANAN NEGARA*\n\n` +
    `Fitur ini sedang dalam pengembangan.\n\n` +
    `Untuk saat ini, gunakan:\n` +
    `/buynokos <nama_layanan>\n\n` +
    `Contoh:\n` +
    `/buynokos instagram\n` +
    `/buynokos whatsapp`
  );
}

if (data.startsWith("nokos_search_more:")) {
  const query = data.split(":")[1];
  await bot.answerCallbackQuery(q.id);
  
  // Panggil ulang command dengan query
  const dummyMsg = { 
    chat: { id: chatId }, 
    from: q.from,
    text: `/layanannokos ${query}`
  };
  bot.emit('text', dummyMsg);
  return;
}

if (data === "menu_historynokos") {
  await bot.answerCallbackQuery(q.id);
  
  // Panggil command history
  const dummyMsg = { 
    chat: { id: chatId }, 
    from: q.from,
    text: '/historynokos'
  };
  bot.emit('text', dummyMsg);
  return;
}

    if (data.startsWith("order_cancel:")) {
      const payId = data.split(":")[1];
      const order = Object.values(activeOrders).find(
        (o) => o.paymentId === payId && o.userId === userId
      );
      if (!order) {
        await bot.answerCallbackQuery(q.id, {
          text: "Transaksi tidak ditemukan / sudah selesai.",
          show_alert: true,
        });
        return;
      }

      await bot.answerCallbackQuery(q.id);

      try {
        await atlDepositCancel(payId);
      } catch {}

      await handleOrderFailed(order, "Dibatalkan oleh user.");
      try {
        await bot.deleteMessage(order.payMsg.chatId, order.payMsg.messageId);
      } catch {}

      return;
    }
  } catch (e) {
    console.error("callback_query error:", e.message);
    try {
      await bot.answerCallbackQuery(q.id, {
        text: "Terjadi error di sisi bot.",
        show_alert: true,
      });
    } catch {}
  }
});
