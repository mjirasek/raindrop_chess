-- Destovky profile activity setup.
-- Run this once in Supabase SQL Editor to enable persisted "last active" times.

alter table public.profiles
add column if not exists last_seen_at timestamptz;

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
