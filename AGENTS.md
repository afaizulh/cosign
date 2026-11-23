# AGENTS.md — Panduan untuk AI & Developer

Panduan kerja pada repositori **CoSign**. Baca ini sebelum mengubah kode agar
tidak merusak struktur, path import, atau konvensi yang sudah ada.

## Ringkasan Proyek

Platform portofolio anak **Creative Media (CM)** — share karya, explore karya
teman, like, dan punya halaman profil publik. Konsep karya ala **blush.design**:
setiap karya disusun dari **bagian-bagian gambar** (`head`, `body`,
`background`) yang di-upload dan bisa di-custom (pilih part per kategori +
toggle visibilitas).

Stack: **Bun + Hono + Eta (template engine) + SQLite + Tailwind + vanilla JS** —
server-rendered MVC (gaya Laravel).

Arsitektur alur:
**Browser (form POST)** → **Routes** (`src/routes/web.ts`) → **Controller**
(`src/controllers/`) → **Model** (`src/models/`) → SQLite, lalu Controller
mengembalikan **View Eta** (`views/`) → HTML. Gambar part di `uploads/`
di-serve statis.

**TIDAK ada JSON API** — semua submit via form POST + redirect (PRG).
Jangan menambahkan route `/api/*` atau `fetch()` ke endpoint JSON.
**UI web berbahasa Inggris.**

## Standar Kontribusi & Open Source

Repositori ini publik (open source) di `ccit-venture/cosign`. Perhatikan:

- **Template issue/PR** ada di `.github/` — saat membuat PR wajib melengkapi
  checklist yang ada di `PULL_REQUEST_TEMPLATE.md`.
- **CONTRIBUTING.md** berisi panduan fork, clone, sinkron upstream, dan gaya
  commit. AJAK kontributor baru membaca file ini dan `AGENTS.md`.
- **Kode Etik** di `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1 — Bahasa
  Indonesia). Kontak penegakan: mhudyaramadhana@gmail.com (Hudya).
- **Keamanan**: laporkan via SECURITY.md (jangan buka issue publik).
- **CI (`.github/workflows/ci.yml`)**: `bun install` + `bun test` +
  `bun run build:css` di setiap push/PR ke `master`. Pastikan semua hijau
  sebelum merge.

## Struktur Penting

```
src/
├── index.ts                # entry: server Bun (port 3000). JANGAN taruh logika bisnis di sini
├── app.ts                  # createApp(db): middleware (logger, secureHeaders, csrf) + static
├── db.ts                   # initDb() (sqlite | supabase) + migrate()
│                           #   tabel: users, sessions, karya, karya_parts, likes, follows
├── view.ts                 # setup Eta + helper view()/redirect()/flash*. Analog view() Laravel
├── composition.ts          # latestParts / partsByCategory / withComposition (layered cards)
├── models/                 # MODEL — query SQL. Satu class per tabel/domain
│   ├── user.model.ts       #   users (auth)
│   ├── session.model.ts    #   sessions
│   ├── karya.model.ts      #   karya + karya_parts + likes (parts, likeCount)
│   └── follow.model.ts     #   follows (toggle, counts, feed personal)
├── controllers/            # CONTROLLER — parse form → model → view/redirect
│   ├── auth.controller.ts  #   /studio/login, /studio/register, /studio/logout
│   ├── settings.controller.ts # /studio/settings — profil, bio, avatar
│   ├── admin.controller.ts #   /admin/* — moderasi (admin only)
│   ├── page.controller.ts  #   GET / (explore), /profil/:username, /feed + follow
│   └── karya.controller.ts #   karyaAdminController (mounted /studio) +
│                           #   karyaPublicController (mounted /) — detail/customizer + like
├── middleware/
│   ├── auth.middleware.ts  # getUserId / createSession / destroySession / requireAuth / redirectIfAuthenticated
│   └── locals.middleware.ts # inject user + flash ke context untuk semua halaman
└── routes/
    └── web.ts              # pasang controller + injectLocals(db)
views/                      # VIEW — template Eta
├── layouts/                # admin.eta.html & homepage.eta.html (pakai it.body)
├── partials/               # navbar, errors, karya-card (komposisi ter-layer)
├── admin/                  # dashboard, works/, users/, log
├── studio/                 # dashboard, publications, settings, auth/, karya/
└── homepage/               # index (explore), karya (customizer), profil
public/                     # aset statis: style.css (Tailwind), customizer.js
uploads/                    # gambar part hasil upload (di-gitignore)
test/                       # unit test
```

## Konvensi Penting

### View Eta (kritis!)

- File template bernama `*.eta.html` — jangan ubah ekstensi (konfigurasi
  `defaultExtension` di `src/view.ts`).
- Setiap halaman diawali `<% layout("/layouts/studio") %>` (atau homepage).
  **Path layout/include WAJIB diawali `/`** agar relatif ke root `views/`
  (misal `include("/partials/errors", {...})`) — tanpa `/`, Eta resolve relatif
  ke folder template dan gagal.
- **Konten halaman masuk ke layout via `it.body`** (bukan `it.content`).
- Escape otomatis default (`<%=`). Gunakan `<%~` HANYA untuk HTML mentah
  (contoh: flash/navbar via include).
- Judul halaman: `<% it.title = "..." %>` di baris atas halaman.
- **UI web wajib Bahasa Inggris** (label, flash, placeholder, dll).
- Render di controller via `view(c, "homepage/karya", { karya, byCategory })`
  dari `src/view.ts`.

### Karya & Parts (blush.design)

- `karya`: judul, deskripsi, kategori (`KATEGORI_LIST` di
  `src/controllers/page.controller.ts`), dibuat tanpa media.
- `karya_parts`: part gambar per kategori — **hanya** `head`, `body`,
  `background` (`PART_KATEGORI` di `src/controllers/karya.controller.ts`).
  JANGAN menambah kategori lain tanpa mengubah konstanta ini.
- Upload part: multipart → validasi `saveImage()` (whitelist
  jpeg/png/gif/webp, maks **20MB**) → `uploads/<uuid>.<ext>` → `addPart()`.
- **Owner check wajib**: semua route admin karya memeriksa
  `isOwner(item, userId)` — jangan hapus guard ini.
- Komposisi ter-layer: `latestParts()` (part terbaru per kategori) untuk
  kartu explore/profil & preview customizer; `partsByCategory()` untuk
  picker part. Lihat `src/composition.ts`.
- Hapus karya = hapus baris DB **dan semua file part**
  (`unlinkSync(media_path)`).
- Customizer (`public/customizer.js`): klik thumbnail part → swap layer
  (`data-kategori`/`data-src`), checkbox `.layer-toggle` → show/hide layer.

### Routing (kritis!)

- `karyaAdminController` di-mount di `/studio` → internal path **relatif**
  (`""` → `/studio`, `"publications"`, `"karya/:id"`, dst) → `/studio/*`.
- `karyaPublicController` di-mount di `/` → internal `"karya/:id"` → `/karya/:id`.
- **JANGAN mount controller yang sama di dua prefix** jika hasil path-nya
  tumpang tindih — route pertama yang menang dan menyebabkan bug (pernah
  terjadi: `/studio/karya/:id` ketimpa handler customizer).
- Hapus karya/part: gunakan route POST khusus (`/delete`), bukan method DELETE.

### Form & Request

- Semua mutasi pakai `<form method="post">` → controller → `redirect(c, ...)`
  (PRG). Jangan buat JSON API / fetch.
- `c.req.parseBody()` untuk baca form (urlencoded/multipart; field file
  kembali sebagai `File`).
- Flash message: `flashSuccess` / `flashError` sebelum redirect; tampilkan di
  layout via `it.flash`.

### Auth & Middleware

- `requireAuth(db)` redirect ke `/studio/login` (bukan 401 JSON).
- `redirectIfAuthenticated(db)` untuk halaman guest (login/register) —
  redirect ke `/studio` (dashboard).
- `injectLocals(db)` dipasang sekali di `web.ts` — resolve `it.user` + `it.flash`.
- Session cookie `sid` (httpOnly, 7 hari). Password wajib `Bun.password`
  (argon2).
- **DB driver env-driven** (`src/db.ts`): `DB_DRIVER=sqlite` (default) atau
  `supabase`. Mode supabase **belum diimplementasikan** — controller mengecek
  `if (!db.sqlite)` lalu return `501`. JANGAN hapus guard ini.
- **Admin**: `/admin/*` dijaga `requireAdmin(db)` — guest → `302 /studio/login`,
  member → `403`. Aksi moderasi: `karya.takedown` (soft delete, ada alasan),
  `user.suspend` (sesi dihapus, karya ikut disembunyikan). Semua aksi dicatat di
  `moderation_log`. Admin pertama dibuat via CLI: `bun run admin:grant <username>`.
- CSRF: `hono/csrf` origin-check via `CSRF_ORIGIN` env (default
  `http://localhost:3000`). Form POST dari origin lain → 403.
- **`.env`** TIDAK pernah di-commit (sudah di `.gitignore`). Cukup ikuti
  `.env.example`.

## Cara Menjalankan

```bash
bun install
bun run dev        # terminal 1: server http://localhost:3000 (hot reload)
bun run dev:css    # terminal 2: compile Tailwind (watch)
```

## Menjalankan Test

```bash
bun test
```

DB test memakai SQLite **in-memory** (`:memory:` di `test/helpers.ts`) — tidak
menyentuh `data/app.db`. Request test form POST wajib menyertakan header
`origin: http://localhost:3000` (csrf) — lihat `formHeaders` di
`test/helpers.ts`. Upload test memakai `FormData` + `File`; file hasil test
dibersihkan (hapus karya/part = file ikut terhapus).

## Hal yang Sering Salah

- **Menambahkan JSON API / fetch** — project ini murni form POST (PRG).
- **`layout`/`include` tanpa prefix `/`** — template gagal ditemukan.
- **Pakai `it.content` di layout** — Eta v4 mengirim body sebagai `it.body`.
- **Mount controller sama di dua prefix dengan path tumpang tindih** — route
  pertama menang, halaman salah. Pisahkan admin & publik controller.
- **Mengubah `KATEGORI_LIST` / `PART_KATEGORI`** tanpa sinkron di form/view.
  Nilainya **slug Inggris** (`design`, `illustration`, `photography`,
  `motion`, `other`; part: `head`, `body`, `background`) — URL filter
  memakai `?category=`. Alias Indonesia lama dinormalisasi lewat
  `KATEGORI_ALIASES` / `PART_ALIASES`, dan `migrate()` ikut merapikan
  baris lama di DB.
- **Upload tanpa validasi tipe/ukuran** — wajib lewat `saveImage()`
  (gambar saja, ≤ 20MB).
- **Menghapus owner check** — user lain bisa menghapus karya/part orang lain.
- **Menambah part kategori baru** — wajib sinkron: konstanta controller,
  label view (`labels` di `studio/karya/show` & `homepage/karya`), dan
  `karya-card` layer.
- **Mengedit `public/style.css` langsung** — itu hasil compile Tailwind. Ubah
  `src/styles/input.css` lalu `bun run build:css`.
- **Menghapus guard `if (!db.sqlite)`** di controller — memecah mode
  sqlite-first.
- **POST tanpa Origin header di test** — kena 403 csrf.
- **Commit file `.env` / `data/` / `uploads/`** — sudah di-ignore, jangan
  di-add paksa (`git add -f`).
- **Menambah route tanpa tes** — setiap halaman/aksi baru sebaiknya punya
  coverage di `test/web.test.ts`.