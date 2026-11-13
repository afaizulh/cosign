-- Jalankan di Supabase SQL Editor atau `supabase db push`
-- Skema ini versi Supabase (uuid). Untuk mode sqlite, skema otomatis dibuat di src/db.ts.

create table if not exists users (
  id uuid primary key,
  username text unique not null,
  full_name text,
  bio text,
  avatar_path text,
  password_hash text not null,
  created_at timestamptz default now()
);

create table if not exists sessions (
  id text primary key,
  user_id uuid references users(id) on delete cascade,
  created_at timestamptz default now()
);

create table if not exists karya (
  id uuid primary key,
  user_id uuid references users(id) on delete cascade,
  judul text not null,
  deskripsi text,
  kategori text,
  created_at timestamptz default now()
);

create table if not exists karya_parts (
  id uuid primary key,
  karya_id uuid references karya(id) on delete cascade,
  kategori text not null,        -- 'kepala' | 'badan' | 'background'
  media_path text not null,
  media_type text,
  created_at timestamptz default now()
);

create table if not exists likes (
  karya_id uuid references karya(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  primary key (karya_id, user_id)
);

create table if not exists comments (
  id uuid primary key,
  karya_id uuid references karya(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);

create index if not exists idx_comments_karya on comments(karya_id, created_at);
