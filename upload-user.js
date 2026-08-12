require('dotenv').config();
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const input = require('input');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const target = process.env.TARGET_CHAT_ID;
const uploadDir = process.argv[2] || process.env.UPLOAD_DIR;
const sessionFile = process.env.USER_SESSION_FILE || path.join(__dirname, '.telegram-user.session');
const stateFile = process.env.USER_STATE_FILE || path.join(__dirname, '.user-upload-state.json');

if (!apiId || !apiHash || !target || !uploadDir) {
  console.error('Isi TELEGRAM_API_ID, TELEGRAM_API_HASH, TARGET_CHAT_ID, UPLOAD_DIR di .env.');
  console.error('Atau: npm run upload:user -- /path/ke/folder');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listFiles(directory) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(fullPath));
    else if (entry.isFile()) output.push(fullPath);
  }
  return output.sort((a, b) => a.localeCompare(b));
}

async function readJson(file, defaultValue) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return defaultValue;
    throw error;
  }
}

async function writeJson(file, content) {
  await fsp.writeFile(`${file}.tmp`, JSON.stringify(content, null, 2));
  await fsp.rename(`${file}.tmp`, file);
}

function fingerprint(stat) {
  return `${stat.size}:${stat.mtimeMs}`;
}

function floodWaitMs(error) {
  const match = String(error?.errorMessage || error?.message || '').match(/FLOOD_WAIT_(\d+)/);
  return match ? (Number(match[1]) + 2) * 1000 : null;
}

async function sendFileWithRetry(client, entity, filePath, caption) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await client.sendFile(entity, {
        file: filePath,
        caption: caption.length <= 1024 ? caption : path.basename(filePath),
        forceDocument: true,
        workers: 1
      });
      return;
    } catch (error) {
      const wait = floodWaitMs(error);
      if (attempt === 3) throw error;
      const delay = wait || attempt * 3000;
      console.warn(` ulang dalam ${Math.ceil(delay / 1000)} dtk...`);
      await sleep(delay);
    }
  }
}

async function main() {
  const resolvedDir = path.resolve(uploadDir);
  if (!(await fsp.stat(resolvedDir).catch(() => null))?.isDirectory()) {
    throw new Error(`Folder tidak ditemukan: ${resolvedDir}`);
  }

  let session = '';
  try { session = await fsp.readFile(sessionFile, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const client = new TelegramClient(new StringSession(session.trim()), apiId, apiHash, {
    connectionRetries: 5,
    useWSS: false
  });

  console.log('Menyambungkan ke Telegram...');
  await client.start({
    phoneNumber: async () => input.text('Nomor Telegram (+62...): '),
    password: async () => input.password('Password 2FA (kosong bila tidak ada): '),
    phoneCode: async () => input.text('Kode OTP Telegram: '),
    onError: (error) => console.error('Login error:', error.message)
  });

  // Session setara akses login akun: simpan lokal dan jangan pernah di-commit.
  await fsp.writeFile(sessionFile, client.session.save(), { mode: 0o600 });
  const entity = await client.getEntity(target);
  const state = await readJson(stateFile, { uploaded: {} });
  state.uploaded ||= {};

  const files = await listFiles(resolvedDir);
  const pending = [];
  for (const filePath of files) {
    const stat = await fsp.stat(filePath);
    const relative = path.relative(resolvedDir, filePath);
    if (state.uploaded[relative] !== fingerprint(stat)) pending.push({ filePath, relative, stat });
  }

  console.log(`${pending.length} file baru/berubah akan dikirim sebagai akun Telegram Anda.`);
  const failed = [];
  for (let index = 0; index < pending.length; index++) {
    const item = pending[index];
    process.stdout.write(`[${index + 1}/${pending.length}] ${item.relative} ...`);
    try {
      await sendFileWithRetry(client, entity, item.filePath, item.relative);
      state.uploaded[item.relative] = fingerprint(item.stat);
      await writeJson(stateFile, state);
      console.log(' OK');
      await sleep(1200); // Jeda konservatif untuk mengurangi risiko flood limit.
    } catch (error) {
      failed.push(item.relative);
      console.log(` GAGAL: ${error.errorMessage || error.message}`);
    }
  }

  await client.disconnect();
  console.log(`Selesai. Berhasil: ${pending.length - failed.length}; gagal: ${failed.length}.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Error: ${error.stack || error.message}`);
  process.exitCode = 1;
});
