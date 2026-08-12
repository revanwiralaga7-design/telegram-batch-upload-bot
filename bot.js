require('dotenv').config();
const { Telegraf } = require('telegraf');

const token = process.env.BOT_TOKEN;
const targetChatId = process.env.TARGET_CHAT_ID;
const allowedUserIds = new Set(
  (process.env.ALLOWED_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
);

if (!token || !targetChatId) {
  throw new Error('BOT_TOKEN dan TARGET_CHAT_ID wajib diisi di file .env');
}

const bot = new Telegraf(token);

// Antrean file manual: Map<chatId, { fromChatId, messageIds: number[] }>
const queues = new Map();
// Buffer album: Map<mediaGroupId, { fromChatId, messageIds, chatId, timer }>
const albumBuffers = new Map();

function isAllowed(ctx) {
  // Perintah dari channel tidak mempunyai ctx.from; tolak agar aman.
  if (!ctx.from) return false;
  return allowedUserIds.size === 0 || allowedUserIds.has(String(ctx.from.id));
}

async function guard(ctx, next) {
  if (!isAllowed(ctx)) {
    await ctx.reply('⛔ Anda tidak memiliki akses ke bot ini.');
    return;
  }
  return next();
}

function fileLabel(message) {
  if (message.document) return message.document.file_name || 'dokumen';
  if (message.photo) return 'foto';
  if (message.video) return message.video.file_name || 'video';
  if (message.audio) return message.audio.file_name || 'audio';
  if (message.animation) return message.animation.file_name || 'animasi';
  if (message.voice) return 'pesan suara';
  if (message.video_note) return 'video note';
  return 'file';
}

function isFileMessage(message) {
  return Boolean(
    message.document || message.photo || message.video || message.audio ||
    message.animation || message.voice || message.video_note
  );
}

async function copyInChunks(fromChatId, messageIds) {
  // copyMessages Bot API maksimal 100 message_id per request.
  for (let index = 0; index < messageIds.length; index += 100) {
    const chunk = messageIds.slice(index, index + 100);
    await bot.telegram.callApi('copyMessages', {
      chat_id: targetChatId,
      from_chat_id: fromChatId,
      message_ids: chunk,
      disable_notification: true
    });
  }
}

async function sendAlbum(mediaGroupId) {
  const album = albumBuffers.get(mediaGroupId);
  if (!album) return;
  albumBuffers.delete(mediaGroupId);

  try {
    await copyInChunks(album.fromChatId, album.messageIds);
    await bot.telegram.sendMessage(
      album.chatId,
      `✅ Album ${album.messageIds.length} file sudah dikirim ke tujuan.`
    );
  } catch (error) {
    console.error('Gagal meneruskan album:', error.description || error.message);
    await bot.telegram.sendMessage(
      album.chatId,
      '❌ Album gagal dikirim. Periksa TARGET_CHAT_ID dan izin admin bot di chat/channel tujuan.'
    );
  }
}

bot.use(guard);

bot.start(async (ctx) => {
  await ctx.reply(
    '📦 *Bot Upload Batch siap.*\n\n' +
    '• Kirim file satuan sebanyak apa pun, lalu ketik /selesai untuk mengirim semuanya sekaligus.\n' +
    '• Kirim sebagai *album* untuk langsung diteruskan otomatis.\n' +
    '• /batal untuk mengosongkan antrean.',
    { parse_mode: 'Markdown' }
  );
});

bot.command('selesai', async (ctx) => {
  const key = String(ctx.chat.id);
  const queue = queues.get(key);

  if (!queue || queue.messageIds.length === 0) {
    await ctx.reply('Tidak ada file satuan dalam antrean. Kirim file dulu.');
    return;
  }

  queues.delete(key); // Hindari duplikasi bila perintah dikirim dua kali.
  const total = queue.messageIds.length;
  const status = await ctx.reply(`⏳ Mengirim ${total} file ke tujuan...`);

  try {
    await copyInChunks(queue.fromChatId, queue.messageIds);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      status.message_id,
      undefined,
      `✅ ${total} file berhasil dikirim ke tujuan.`
    );
  } catch (error) {
    console.error('Gagal meneruskan antrean:', error.description || error.message);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      status.message_id,
      undefined,
      '❌ Pengiriman gagal. File dikembalikan ke antrean; coba /selesai lagi setelah mengecek konfigurasi.'
    ).catch(() => {});
    queues.set(key, queue);
  }
});

bot.command('batal', async (ctx) => {
  queues.delete(String(ctx.chat.id));
  await ctx.reply('🗑️ Antrean file satuan dikosongkan.');
});

bot.on('message', async (ctx) => {
  const message = ctx.message;
  if (!isFileMessage(message)) return;

  // File yang dikirim melalui album diproses otomatis setelah Telegram selesai
  // mengirim semua bagian album (buffer 1,5 detik).
  if (message.media_group_id) {
    const groupId = String(message.media_group_id);
    let album = albumBuffers.get(groupId);

    if (!album) {
      album = {
        fromChatId: message.chat.id,
        chatId: message.chat.id,
        messageIds: [],
        timer: null
      };
      albumBuffers.set(groupId, album);
    }

    album.messageIds.push(message.message_id);
    clearTimeout(album.timer);
    album.timer = setTimeout(() => sendAlbum(groupId), 1500);
    return;
  }

  // File yang dikirim satuan ditampung sampai pengguna memberi /selesai.
  const key = String(message.chat.id);
  const queue = queues.get(key) || { fromChatId: message.chat.id, messageIds: [] };
  queue.messageIds.push(message.message_id);
  queues.set(key, queue);

  await ctx.reply(`➕ ${fileLabel(message)} ditambahkan. Antrean: ${queue.messageIds.length}. Ketik /selesai jika sudah.`);
});

bot.catch((error) => console.error('Bot error:', error));

bot.launch().then(() => console.log('Bot berjalan.'));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => bot.stop(signal));
}
