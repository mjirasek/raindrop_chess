# Multiplayer Deployment Plan

The current app is a static hot-seat game: both players use the same browser and the full game state lives in React memory. GitHub Pages is already configured for static deployment, but a two-device game needs shared state and some identity model.

## Recommended Simple Version

Use GitHub Pages for hosting and Supabase for multiplayer state.

Why this is the smallest useful path:

- The React app can stay a static Vite app.
- GitHub Pages can keep serving the built files.
- Supabase can provide auth, database rows, and realtime subscriptions without adding our own server.
- Room state can be saved in Postgres and synchronized to both browsers.

## Current Implementation Status

The app now contains the frontend wiring for this plan:

- `Playground` works without Supabase.
- `Challenge` appears only when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured.
- Supabase Auth handles sign-in.
- Supabase tables store profiles, challenges, and games.
- Realtime subscriptions refresh challenge/game state.
- The SQL schema and RLS policies live in `supabase/schema.sql`.

No private key or password is committed. The browser only receives the Supabase URL and anon key, which are public client configuration values.

## Supabase Project Setup

1. Create a Supabase project.
2. Open the SQL editor and run `supabase/schema.sql`.
3. In Auth settings, disable public sign-ups for the private prototype.
4. Create the five users manually in Supabase Auth.
5. Use `local-secrets/supabase-users.md` for the temporary passwords. This file is local-only and ignored by git.
6. Add one `profiles` row for each created Auth user id. Use `supabase/profiles-template.sql` as the copy/paste template.
7. Fill in `.env.local`:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

8. Restart `npm run dev`.

Only use the anon key in `.env.local`. Never use the service role key in this frontend app.

Example profile rows after creating users:

```sql
insert into public.profiles (id, username, display_name)
values
  ('AUTH-USER-ID-FOR-KACKA', 'kacka', 'Kacka'),
  ('AUTH-USER-ID-FOR-VLADA', 'vlada', 'Vlada'),
  ('AUTH-USER-ID-FOR-MISA', 'misa', 'Misa'),
  ('AUTH-USER-ID-FOR-VERCA', 'verca', 'Verca'),
  ('AUTH-USER-ID-FOR-KP', 'kp', 'KP');
```

## Product Modes

Use two clear modes:

### Playground

Playground is the current no-login mode.

- No account required.
- No opponent selection.
- One browser controls both sides.
- Useful for learning the rules, testing positions, and casual hot-seat play.
- State can stay in memory or local storage.

This should remain the default first screen so people can try the game immediately.

### Challenge

Challenge is the logged-in two-device mode.

- Login required.
- Player chooses an opponent from the known user list.
- The challenged player sees pending challenges.
- When accepted, the game gets a room id and fixed seats.
- Both players can reconnect and see the same board.
- Only the active side can submit a turn.
- Spectators can be added later.

The simple first version should support:

- `Create challenge`
- `Accept challenge`
- `Decline challenge`
- `Resign`
- `Offer seat swap`
- `Accept seat swap`

## Login Model

Do not hard-code passwords in this repository.

For a small private group, create five accounts in Supabase Auth:

- `kacka`
- `vlada`
- `misa`
- `verca`
- `kp`

Use real passwords stored only in the Supabase dashboard or password manager. If Supabase requires email-shaped usernames, use aliases such as:

- `kacka@raindrop.local`
- `vlada@raindrop.local`
- `misa@raindrop.local`
- `verca@raindrop.local`
- `kp@raindrop.local`

Disable public sign-up if this should stay private.

Suggested display names:

| Username | Display name |
| --- | --- |
| `kacka` | Kacka |
| `vlada` | Vlada |
| `misa` | Misa |
| `verca` | Verca |
| `kp` | KP |

For development, keep a private password list outside git. A safe pattern is:

- Generate one initial password per user.
- Send each password privately.
- Force reset after first login if the provider supports it.
- Never commit passwords, service-role keys, or reset links.

The frontend can contain the public user list, but not the passwords.

## Challenge Model

Suggested `profiles` table:

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | uuid | Same as auth user id |
| `username` | text | Stable login/display handle |
| `display_name` | text | Name shown in the app |
| `active` | boolean | Whether this user appears in challenge picker |

Suggested `challenges` table:

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `challenger_user_id` | uuid | Player sending challenge |
| `challenged_user_id` | uuid | Player receiving challenge |
| `preferred_color` | text nullable | `white`, `black`, or `random` |
| `status` | text | `pending`, `accepted`, `declined`, `cancelled` |
| `game_id` | uuid nullable | Filled after acceptance |
| `created_at` | timestamp | Challenge creation time |
| `updated_at` | timestamp | Last status change |

Challenge flow:

1. Signed-in player opens Challenge.
2. App loads active profiles except the current user.
3. Player selects `Kacka`, `Vlada`, `Misa`, `Verca`, or `KP`.
4. App inserts a pending challenge.
5. Opponent accepts.
6. App creates a game row and assigns seats.
7. Both clients subscribe to the game row for updates.

## Room Model

Add a simple lobby:

1. User signs in.
2. User creates a room or joins by room code.
3. User chooses a seat: white, black, or spectator.
4. The room stores seat ownership.
5. Only the white player can act when `turn === 'white'`.
6. Only the black player can act when `turn === 'black'`.
7. Spectators can watch but cannot move.

Seat swapping can be a small room action:

- White offers swap.
- Black accepts swap.
- The room swaps `white_user_id` and `black_user_id`.
- Game state stays unchanged.

## Data Shape

Suggested `games` table:

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `room_code` | text | Short join code |
| `white_user_id` | uuid nullable | Supabase user id for white |
| `black_user_id` | uuid nullable | Supabase user id for black |
| `state_json` | jsonb | Serialized `GameState` |
| `notations_json` | jsonb | Move/placement notation list |
| `version` | integer | Optimistic concurrency counter |
| `created_at` | timestamp | Room creation time |
| `updated_at` | timestamp | Last action time |

The current `GameState` contains `Map` objects, so serialization needs explicit conversion:

- `board: Map<Square, CGPiece>` becomes an array like `[[0, {"role":"king","color":"white"}]]`.
- `legalMoves: Map<Square, Square[]>` can be recomputed after loading instead of persisted.
- Decks, turn, clocks, promotion counts, and winner can be stored as normal JSON.

## Move Submission

Client flow:

1. Load current `state_json` and `version`.
2. Confirm signed-in user owns the active seat.
3. Apply `flipCard`, `placePiece`, `makeMove`, or `completePromotion` locally.
4. Save the new state with `version + 1`.
5. Reject the save if the database version changed first.

This avoids most race conditions without building a custom backend.

## Security Rules

Minimum Row Level Security policy:

- Signed-in users can read games they are seated in, plus optionally public/spectator rooms.
- Only `white_user_id` can submit white turns.
- Only `black_user_id` can submit black turns.
- Only seated users can update seat fields.
- No user can update another user's profile or password.

For the first private prototype, it is acceptable to keep rooms invite-code-only and trusted, but do not put real passwords or service keys in frontend code.

## Implementation Phases

### Phase 1: Static Deployment

- Keep the existing GitHub Pages workflow.
- Fix production base path and verify the public URL.
- Keep hot-seat play as the default mode.

### Phase 2: Serialization

- Add `serializeGameState()` and `deserializeGameState()`.
- Add tests that a game state round-trips without losing board, deck, turn, clocks, or promotion counts.

### Phase 3: Supabase Auth

- Add sign-in screen.
- Pre-create the five users.
- Store only the Supabase URL and anon key in Vite environment variables.

### Phase 4: Rooms

- Add create/join room.
- Add white/black/spectator seat selection.
- Save and load state from the `games` table.

### Phase 5: Realtime

- Subscribe to room changes.
- When one player moves, the other browser receives the updated state.
- Add conflict handling if both tabs submit from the same seat.

## Alternative: No Login Prototype

The fastest throwaway version is room-code plus seat links:

- `/game/ABCD?seat=white&key=...`
- `/game/ABCD?seat=black&key=...`

This is easier than login but weaker. Anyone with the link can play that seat. It is fine for a one-evening prototype, not for a public app.
