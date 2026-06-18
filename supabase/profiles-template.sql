-- Replace each AUTH-USER-ID-* value with the UUID from Supabase Auth -> Users.
-- Run this after supabase/schema.sql and after creating the Auth users.

insert into public.profiles (id, username, display_name)
values
  ('AUTH-USER-ID-KACKA', 'kacka', 'Kacka'),
  ('AUTH-USER-ID-VLADA', 'vlada', 'Vlada'),
  ('4e6f251a-b676-4ea5-9166-f2a7da849c8f', 'misa', 'Misa'),
  ('AUTH-USER-ID-VERCA', 'verca', 'Verca'),
  ('AUTH-USER-ID-KP', 'kp', 'KP')
on conflict (id) do update set
  username = excluded.username,
  display_name = excluded.display_name,
  active = true;

