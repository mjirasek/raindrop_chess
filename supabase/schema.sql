create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

alter table public.profiles
add column if not exists last_seen_at timestamptz;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  white_user_id uuid references auth.users(id) on delete set null,
  black_user_id uuid references auth.users(id) on delete set null,
  state_json jsonb not null,
  notations_json jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  challenger_user_id uuid not null references auth.users(id) on delete cascade,
  challenged_user_id uuid not null references auth.users(id) on delete cascade,
  preferred_color text not null default 'white' check (preferred_color in ('white', 'black', 'random')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  game_id uuid references public.games(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (challenger_user_id <> challenged_user_id)
);

create table if not exists public.game_messages (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.lobby_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.game_messages
add column if not exists challenge_id uuid references public.challenges(id) on delete cascade;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.touch_my_profile_last_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set last_seen_at = now()
  where id = auth.uid();
$$;

revoke all on function public.touch_my_profile_last_seen() from public;
grant execute on function public.touch_my_profile_last_seen() to authenticated;

drop trigger if exists touch_games_updated_at on public.games;
create trigger touch_games_updated_at
before update on public.games
for each row execute function public.touch_updated_at();

drop trigger if exists touch_challenges_updated_at on public.challenges;
create trigger touch_challenges_updated_at
before update on public.challenges
for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.challenges enable row level security;
alter table public.game_messages enable row level security;
alter table public.lobby_messages enable row level security;

drop policy if exists "active profiles are readable by signed-in users" on public.profiles;
create policy "active profiles are readable by signed-in users"
on public.profiles for select
to authenticated
using (active = true);

drop policy if exists "users can read games they play" on public.games;
create policy "users can read games they play"
on public.games for select
to authenticated
using ((select auth.uid()) in (white_user_id, black_user_id));

drop policy if exists "players can create games for themselves" on public.games;
create policy "players can create games for themselves"
on public.games for insert
to authenticated
with check ((select auth.uid()) in (white_user_id, black_user_id));

drop policy if exists "active player can update their game" on public.games;
drop policy if exists "players can update their game" on public.games;
create policy "players can update their game"
on public.games for update
to authenticated
using ((select auth.uid()) in (white_user_id, black_user_id))
with check ((select auth.uid()) in (white_user_id, black_user_id));

drop policy if exists "users can read their challenges" on public.challenges;
create policy "users can read their challenges"
on public.challenges for select
to authenticated
using ((select auth.uid()) in (challenger_user_id, challenged_user_id));

drop policy if exists "users can create own challenges" on public.challenges;
create policy "users can create own challenges"
on public.challenges for insert
to authenticated
with check ((select auth.uid()) = challenger_user_id);

drop policy if exists "users can update their challenges" on public.challenges;
create policy "users can update their challenges"
on public.challenges for update
to authenticated
using ((select auth.uid()) in (challenger_user_id, challenged_user_id))
with check ((select auth.uid()) in (challenger_user_id, challenged_user_id));

drop policy if exists "players can read game messages" on public.game_messages;
create policy "players can read game messages"
on public.game_messages for select
to authenticated
using (
  exists (
    select 1 from public.challenges c
    where c.id = challenge_id
      and (select auth.uid()) in (c.challenger_user_id, c.challenged_user_id)
  )
);

drop policy if exists "players can create game messages" on public.game_messages;
create policy "players can create game messages"
on public.game_messages for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.challenges c
    where c.id = challenge_id
      and (select auth.uid()) in (c.challenger_user_id, c.challenged_user_id)
  )
);

drop policy if exists "signed-in users can read lobby messages" on public.lobby_messages;
drop policy if exists "public can read lobby messages" on public.lobby_messages;
create policy "public can read lobby messages"
on public.lobby_messages for select
to anon, authenticated
using (true);

drop policy if exists "signed-in users can create lobby messages" on public.lobby_messages;
create policy "signed-in users can create lobby messages"
on public.lobby_messages for insert
to authenticated
with check ((select auth.uid()) = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'challenges'
  ) then
    alter publication supabase_realtime add table public.challenges;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_messages'
  ) then
    alter publication supabase_realtime add table public.game_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lobby_messages'
  ) then
    alter publication supabase_realtime add table public.lobby_messages;
  end if;
end $$;
