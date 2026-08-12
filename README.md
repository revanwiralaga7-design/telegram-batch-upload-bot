# Bot Telegram Upload Batch

Bot Node.js ini memungkinkan pengguna mengirim **banyak file tanpa upload satu per satu ke channel/grup tujuan**:

- Kirim file biasa sebanyak apa pun → bot menampungnya → kirim `/selesai` → bot meneruskan seluruh antrean ke tujuan.
- Kirim beberapa media sebagai **album Telegram** → bot meneruskannya otomatis setelah album lengkap diterima.
- Mendukung dokumen, foto, video, audio, animasi/GIF, voice note, dan video note.
- Tidak mengunduh file ke server: bot memakai Telegram `copyMessages`, sehingga lebih cepat dan hemat storage server.
- Satu batch mendukung lebih dari 100 file. Bot otomatis memecah panggilan API per 100 pesan.

## Upload file langsung dari VPS (tanpa kirim ke bot dulu)

Jika file sudah berada di VPS, Anda **tidak perlu mengirim file ke chat bot**. Jalankan uploader berikut dari VPS:

```bash
npm run upload -- /path/ke/folder
```

Contoh:

```bash
npm run upload -- /home/ubuntu/downloads
```

Seluruh file di folder tersebut, termasuk subfolder, akan dikirim sebagai dokumen ke `TARGET_CHAT_ID`. File dikirim otomatis satu per satu oleh script (bukan Anda secara manual), karena API Telegram memang menerima pengiriman file per pesan.

Script menyimpan catatan sukses di `.upload-state.json`. Karena file sumber dipilih untuk **tetap berada di folder**, pada eksekusi berikutnya hanya file baru atau file yang berubah yang akan diunggah. Jangan hapus file state tersebut kecuali Anda memang ingin upload ulang seluruh folder.

Alternatifnya, isi path permanen pada `.env`:

```env
UPLOAD_DIR=/home/ubuntu/downloads
```

Kemudian cukup jalankan:

```bash
npm run upload
```

> Batas ukuran file tetap mengikuti limit Telegram dan jenis akun/bot. Bot ini tidak dapat melewati batas upload Telegram.

## Upload file besar sebagai akun Telegram biasa (hingga limit akun)

Mode `upload:user` mengirim file dari VPS memakai **akun Telegram Anda**, bukan bot. Ini cocok untuk file yang melampaui limit upload bot publik. Akun pengirim harus menjadi admin di channel tujuan (atau anggota grup dengan izin mengirim media).

> Jangan gunakan mode ini untuk spam atau ke channel/grup yang bukan milik Anda. Telegram dapat menerapkan flood limit pada akun yang mengirim terlalu cepat. Script sudah memakai jeda dan akan mencoba ulang `FLOOD_WAIT` secara otomatis.

1. Buka https://my.telegram.org/apps, login dengan nomor Telegram Anda, lalu buat aplikasi.
2. Salin `api_id` dan `api_hash` ke `.env`:

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=isi_api_hash_anda
TARGET_CHAT_ID=@username_channel
UPLOAD_DIR=/home/ubuntu/downloads
```

3. Instal dependency dan mulai upload:

```bash
npm install
npm run upload:user
```

Pada eksekusi pertama, terminal meminta nomor Telegram, OTP, dan password 2FA jika aktif. File session login disimpan lokal pada `.telegram-user.session`; **jangan dibagikan atau diunggah ke GitHub**. Eksekusi berikutnya tidak perlu login ulang.

Atau berikan folder langsung:

```bash
npm run upload:user -- /path/ke/folder
```

File tetap berada di VPS. Catatan file sukses berada di `.user-upload-state.json`, sehingga hanya file baru atau yang berubah yang dikirim pada eksekusi berikutnya.

## 1. Buat bot dan ambil token

1. Buka Telegram lalu chat dengan [@BotFather](https://t.me/BotFather).
2. Jalankan `/newbot`, ikuti instruksi, lalu salin tokennya.

## 2. Siapkan chat tujuan

Buat/siapkan channel atau grup tujuan, lalu:

1. Tambahkan bot sebagai **admin**.
2. Beri izin untuk mengirim pesan/media.
3. Tentukan `TARGET_CHAT_ID`:
   - Channel publik: dapat memakai `@username_channel`.
   - Grup/channel privat: gunakan ID numerik, biasanya diawali `-100`.

Cara mudah mendapat ID chat: teruskan satu pesan dari chat tujuan ke bot seperti `@userinfobot`, atau gunakan bot ID checker tepercaya. Jangan pernah membagikan `BOT_TOKEN`.

## 3. Instal dan konfigurasi

Butuh Node.js 18 atau lebih baru.

```bash
cd telegram-batch-upload-bot
npm install
cp .env.example .env
```

Buka `.env`, lalu isi:

```env
BOT_TOKEN=token_dari_BotFather
TARGET_CHAT_ID=-1001234567890
ALLOWED_USER_IDS=123456789
```

`ALLOWED_USER_IDS` sangat dianjurkan supaya hanya akun Anda yang dapat mengirim file. Untuk lebih dari satu akun, pisahkan dengan koma:

```env
ALLOWED_USER_IDS=123456789,987654321
```

## 4. Jalankan

```bash
npm start
```

Untuk server/VPS agar tetap hidup setelah terminal ditutup, gunakan process manager seperti PM2:

```bash
npm i -g pm2
pm2 start bot.js --name upload-batch-bot
pm2 save
pm2 startup
```

## Cara pakai di Telegram

1. Buka chat pribadi dengan bot dan tekan **Start**.
2. Kirim file satuan sebanyak yang diperlukan.
3. Bot akan menampilkan jumlah antrean.
4. Kirim `/selesai` untuk meneruskan semua file tersebut ke chat/channel tujuan.
5. Jika salah kirim, gunakan `/batal` sebelum `/selesai`.

Untuk album, pilih banyak foto/video/dokumen dari tombol lampiran Telegram lalu kirim sekaligus. Bot meneruskannya otomatis, sehingga tidak perlu mengetik `/selesai`.

## Catatan keamanan dan keterbatasan

- Jangan commit atau kirim file `.env`; file tersebut menyimpan token bot.
- Jalankan bot di chat pribadi. Jika dipakai di grup, antrean dibedakan per grup, bukan per anggota.
- Pesan yang diteruskan tidak menyertakan attribution "forwarded from" karena menggunakan metode salin (`copyMessages`).
- Antrean disimpan di memori. Jika bot direstart sebelum `/selesai`, antrean yang belum dikirim akan hilang. Untuk antrean persisten, tambahkan Redis/database.
