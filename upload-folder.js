require('dotenv').config();
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Telegraf, Input } = require('telegraf');

const token = process.env.BOT_TOKEN;
const targetChatId = process.env.TARGET_CHAT_ID;
const uploadDir = process.argv[2] || process.env.UPLOAD_DIR;
const stateFile = process.env.STATE_FILE || path.join(__dirname, '.upload-state.json');

if (!token || !targetChatId || !uploadDir) {
  console.error('Pemakaian: npm run upload -- /path/ke/folder');
  console.error('Atau isi BOT_TOKEN, TARGET_CHAT_ID, dan UPLOAD_DIR di file .env.');
  process.exit(1);
}

const bot = new Telegraf(token);

async function listFiles(directory) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function loadState() {
  try {
    return JSON.parse(await fsp.readFile(stateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { uploaded: {} };
    throw new Error(`State file tidak valid: ${error.message}`);
  }
}

async function saveState(state) {
  const temporary = `${stateFile}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(state, null, 2));
  await fsp.rename(temporary, stateFile);
}

function fingerprint(stats) {
  return `${stats.size}:${stats.mtimeMs}`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function uploadWithRetry(filePath, relativePath) {
  // Dua percobaan tambahan untuk gangguan jaringan / Telegram rate limit.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await bot.telegram.sendDocument(
        targetChatId,
        Input.fromLocalFile(filePath, path.basename(filePath)),
        {
          caption: relativePath.length <= 1024 ? relativePath : path.basename(filePath),
          disable_notification: true
        }
      );
      return;
    } catch (error) {
      const retryAfter = error?.parameters?.retry_after;
      if (attempt === 3) throw error;
      const delay = retryAfter ? (retryAfter + 1) * 1000 : attempt * 2000;
      console.warn(`  Percobaan ${attempt} gagal; ulang dalam ${Math.round(delay / 1000)} dtk.`);
      await wait(delay);
    }
  }
}

async function main() {
  const directory = path.resolve(uploadDir);
  const directoryStats = await fsp.stat(directory).catch(() => null);
  if (!directoryStats?.isDirectory()) {
    throw new Error(`Folder tidak ditemukan: ${directory}`);
  }

  const state = await loadState();
  state.uploaded ||= {};
  const allFiles = await listFiles(directory);
  const pending = [];

  for (const filePath of allFiles) {
    const stats = await fsp.stat(filePath);
    const key = path.relative(directory, filePath);
    if (state.uploaded[key] !== fingerprint(stats)) {
      pending.push({ filePath, key, stats });
    }
  }

  if (pending.length === 0) {
    console.log('Tidak ada file baru atau yang berubah untuk diunggah.');
    return;
  }

  console.log(`${pending.length} file akan diunggah ke ${targetChatId}.`);
  let success = 0;
  const failed = [];

  for (const item of pending) {
    process.stdout.write(`[${success + failed.length + 1}/${pending.length}] ${item.key} ... `);
    try {
      await uploadWithRetry(item.filePath, item.key);
      state.uploaded[item.key] = fingerprint(item.stats);
      await saveState(state); // Simpan tiap sukses agar aman bila VPS berhenti di tengah proses.
      success++;
      console.log('OK');
      await wait(350); // Hindari mengirim terlalu cepat.
    } catch (error) {
      failed.push(item.key);
      console.log(`GAGAL: ${error.description || error.message}`);
    }
  }

  console.log(`Selesai: ${success} berhasil, ${failed.length} gagal.`);
  if (failed.length) {
    console.error('File gagal (akan dicoba lagi pada eksekusi berikutnya):\n- ' + failed.join('\n- '));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
