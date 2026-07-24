create extension if not exists citext with schema extensions;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name varchar(20) not null,
  avatar_key smallint not null constraint profiles_avatar_key_check check (avatar_key between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.login_aliases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  login_name extensions.citext not null unique,
  auth_email text not null unique,
  recovery_code_digest bytea not null,
  recovery_rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkin_date date not null,
  attention varchar(120) not null
    constraint check_ins_attention_check check (length(trim(attention)) > 0),
  source_url text
    constraint check_ins_source_url_check
    check (
      source_url is null
      or (
        length(source_url) <= 2048
        and source_url ~ '^https?://'
      )
    ),
  summary text not null default '' constraint check_ins_summary_check check (length(summary) <= 5000),
  inspiration text not null default '' constraint check_ins_inspiration_check check (length(inspiration) <= 2000),
  image_path text,
  image_name varchar(255) not null default '',
  version integer not null default 1 constraint check_ins_version_check check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint check_ins_user_date_key unique (user_id, checkin_date)
);

create index check_ins_user_date_desc_idx
  on public.check_ins (user_id, checkin_date desc);

create table private.auth_rate_limits (
  bucket_digest bytea not null,
  action text not null,
  window_started_at timestamptz not null,
  attempt_count integer not null default 0,
  blocked_until timestamptz,
  primary key (bucket_digest, action)
);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function private.touch_updated_at();

create trigger login_aliases_touch_updated_at
before update on private.login_aliases
for each row execute function private.touch_updated_at();

create trigger check_ins_touch_updated_at
before update on public.check_ins
for each row execute function private.touch_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'checkin-images',
  'checkin-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
