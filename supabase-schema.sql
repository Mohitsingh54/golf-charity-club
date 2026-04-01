create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null,
  club text,
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

create table if not exists public.charities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  impact text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan text not null check (plan in ('monthly', 'yearly')),
  fee numeric(10,2) not null,
  charity_id uuid references public.charities(id),
  contribution_percent integer not null default 10,
  lucky_numbers jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'inactive')),
  starts_at date not null default current_date,
  ends_at date,
  created_at timestamptz not null default now()
);

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  score integer not null check (score between 1 and 45),
  played_on date not null,
  proof_note text,
  created_at timestamptz not null default now()
);

create table if not exists public.draws (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  mode text not null check (mode in ('random', 'weighted')),
  winning_numbers jsonb not null,
  prize_pool numeric(10,2) not null default 0,
  jackpot_carry_over numeric(10,2) not null default 0,
  draw_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.winner_verifications (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references public.draws(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  matches integer not null,
  base_matches integer not null default 0,
  weighted_boost integer not null default 0,
  score_weight integer not null default 1,
  payout numeric(10,2) not null default 0,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid')),
  created_at timestamptz not null default now()
);

alter table public.scores drop constraint if exists scores_score_check;
alter table public.scores add constraint scores_score_check check (score between 1 and 45);

alter table public.draws add column if not exists jackpot_carry_over numeric(10,2) not null default 0;
alter table public.winner_verifications add column if not exists base_matches integer not null default 0;
alter table public.winner_verifications add column if not exists weighted_boost integer not null default 0;
alter table public.winner_verifications add column if not exists score_weight integer not null default 1;

alter table public.profiles enable row level security;
alter table public.charities enable row level security;
alter table public.subscriptions enable row level security;
alter table public.scores enable row level security;
alter table public.draws enable row level security;
alter table public.winner_verifications enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, club, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'club',
    coalesce(new.raw_user_meta_data ->> 'role', 'user')
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      club = excluded.club,
      role = excluded.role;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles for select
using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
on public.profiles for update
using (auth.uid() = id or public.is_admin())
with check (auth.uid() = id or public.is_admin());

drop policy if exists "charities_public_read" on public.charities;
create policy "charities_public_read"
on public.charities for select
using (true);

drop policy if exists "charities_admin_write" on public.charities;
create policy "charities_admin_write"
on public.charities for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "subscriptions_select_own_or_admin" on public.subscriptions;
create policy "subscriptions_select_own_or_admin"
on public.subscriptions for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "subscriptions_public_read" on public.subscriptions;
create policy "subscriptions_public_read"
on public.subscriptions for select
using (true);

drop policy if exists "subscriptions_insert_own_or_admin" on public.subscriptions;
create policy "subscriptions_insert_own_or_admin"
on public.subscriptions for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "subscriptions_update_own_or_admin" on public.subscriptions;
create policy "subscriptions_update_own_or_admin"
on public.subscriptions for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "scores_select_own_or_admin" on public.scores;
create policy "scores_select_own_or_admin"
on public.scores for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "scores_insert_own_or_admin" on public.scores;
create policy "scores_insert_own_or_admin"
on public.scores for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "scores_update_admin_only" on public.scores;
create policy "scores_update_admin_only"
on public.scores for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "scores_delete_own_or_admin" on public.scores;
create policy "scores_delete_own_or_admin"
on public.scores for delete
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "draws_public_read" on public.draws;
create policy "draws_public_read"
on public.draws for select
using (true);

drop policy if exists "draws_admin_write" on public.draws;
create policy "draws_admin_write"
on public.draws for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "winners_select_own_or_admin" on public.winner_verifications;
create policy "winners_select_own_or_admin"
on public.winner_verifications for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "winners_admin_write" on public.winner_verifications;
create policy "winners_admin_write"
on public.winner_verifications for all
using (public.is_admin())
with check (public.is_admin());
