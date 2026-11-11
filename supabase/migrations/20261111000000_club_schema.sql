-- =====================================================================
-- GBPUAT Chess Club — core schema
--
-- Security model: the site is static (GitHub Pages) and the anon key is
-- public, so ALL access control lives here, in Row Level Security.
--   * anon (visitors)  — published / public data only
--   * authenticated    — players: their own data + self-registration
--   * admins           — profiles.role = 'admin': full read/write
-- Admin status can never be self-granted: a guard trigger blocks it, and
-- the first admin is promoted from the SQL editor (see README / bottom).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.app_role          as enum ('player', 'admin');
create type public.player_status     as enum ('pending', 'active', 'alumni', 'inactive', 'guest');
create type public.tournament_format as enum ('swiss', 'round_robin', 'double_round_robin', 'knockout', 'arena', 'ladder', 'simul', 'team_league');
create type public.tournament_kind   as enum ('individual', 'team');
create type public.tournament_status as enum ('draft', 'registration_open', 'registration_closed', 'ongoing', 'completed', 'cancelled');
create type public.entry_status      as enum ('pending', 'confirmed', 'waitlist', 'withdrawn', 'rejected');
create type public.round_status      as enum ('scheduled', 'ongoing', 'completed');
create type public.match_status      as enum ('scheduled', 'ongoing', 'completed', 'postponed', 'cancelled');
-- '+/-' and '-/+' are forfeits (white / black wins by forfeit), '0-0' double forfeit, '*' unfinished.
create type public.game_result       as enum ('1-0', '0-1', '1/2-1/2', '+/-', '-/+', '0-0', '*');
create type public.game_termination  as enum ('checkmate', 'resignation', 'timeout', 'draw_agreement', 'stalemate', 'repetition', 'fifty_move', 'insufficient_material', 'forfeit', 'abandoned', 'other');
create type public.game_source       as enum ('otb', 'lichess', 'chesscom', 'other');
create type public.team_role         as enum ('captain', 'vice_captain', 'member', 'reserve');

-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         public.app_role not null default 'player',
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.profiles is 'One row per login. role decides player vs admin.';

-- True when the caller is a signed-in admin. SECURITY DEFINER so policies
-- can call it without recursing into profiles' own RLS.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- Requests from the website: PostgREST does SET ROLE anon/authenticated,
-- which is recorded in the 'role' setting. Unlike current_user, that
-- setting doesn't change inside SECURITY DEFINER functions, so a client
-- can't slip past the guards by going through one. The SQL editor and
-- service role run with role = 'none' / a privileged role.
create or replace function public.is_client_request()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('role', true), 'none'), current_user::text) in ('anon', 'authenticated');
$$;

-- ---------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------
create table public.players (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid unique references public.profiles (id) on delete set null,
  full_name         text not null check (length(trim(full_name)) > 0),
  department        text,
  programme         text,
  batch_year        int check (batch_year between 1950 and 2100),
  status            public.player_status not null default 'pending',
  is_external       boolean not null default false,   -- opponent from another college / guest without an account
  college           text,                             -- for external players
  club_rating       int not null default 1200,
  club_games        int not null default 0,
  peak_rating       int not null default 1200,
  fide_id           text,
  fide_rating       int,
  lichess_username  text,
  chesscom_username text,
  bio               text,
  photo_url         text,
  joined_on         date not null default current_date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index players_status_idx on public.players (status);
create index players_rating_idx on public.players (club_rating desc);

-- Personal details live in their own table: RLS is per row, not per
-- column, so this is what keeps phone numbers etc. away from the public.
create table public.player_private (
  player_id     uuid primary key references public.players (id) on delete cascade,
  email         text,
  phone         text,
  roll_number   text,
  date_of_birth date,
  notes         text,                                   -- admin-only remarks are fine here; owner can read them
  updated_at    timestamptz not null default now()
);

create table public.committee_members (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid references public.profiles (id) on delete set null,
  full_name     text not null,
  position      text not null,                          -- President, Secretary, Faculty Advisor, …
  contact_email text,                                   -- public contact, shown on the site
  contact_phone text,
  photo_url     text,
  term_start    date,
  term_end      date,
  is_active     boolean not null default true,
  display_order int not null default 100,
  created_at    timestamptz not null default now()
);

create function public.my_player_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.players where profile_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  short_name  text,
  season      text,                                     -- e.g. '2026-27'
  is_external boolean not null default false,           -- another college's team
  college     text,
  captain_id  uuid references public.players (id) on delete set null,
  logo_url    text,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.team_members (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete cascade,
  role        public.team_role not null default 'member',
  board_order int,
  joined_on   date not null default current_date,
  left_on     date,
  unique (team_id, player_id, joined_on)
);

-- ---------------------------------------------------------------------
-- Competition
-- ---------------------------------------------------------------------
create table public.tournaments (
  id                       uuid primary key default gen_random_uuid(),
  slug                     text unique,
  name                     text not null,
  description              text,
  format                   public.tournament_format not null default 'swiss',
  kind                     public.tournament_kind not null default 'individual',
  status                   public.tournament_status not null default 'draft',
  time_control_base_min    int check (time_control_base_min >= 0),
  time_control_increment_s int not null default 0 check (time_control_increment_s >= 0),
  rated                    boolean not null default true,
  rounds_planned           int check (rounds_planned > 0),
  starts_on                date,
  ends_on                  date,
  venue                    text,
  registration_opens_at    timestamptz,
  registration_closes_at   timestamptz,
  max_entries              int check (max_entries > 0),
  entry_fee                numeric(10, 2) not null default 0,
  prize_details            text,
  rules                    text,
  banner_url               text,
  is_published             boolean not null default false,
  created_by               uuid references public.profiles (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.tournament_entries (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references public.tournaments (id) on delete cascade,
  player_id       uuid references public.players (id) on delete cascade,
  team_id         uuid references public.teams (id) on delete cascade,
  status          public.entry_status not null default 'pending',
  seed            int,
  rating_at_entry int,
  registered_by   uuid references public.profiles (id) on delete set null,
  registered_at   timestamptz not null default now(),
  notes           text,
  check ((player_id is null) <> (team_id is null)),
  unique (tournament_id, player_id),
  unique (tournament_id, team_id)
);

create table public.rounds (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  number        int not null check (number > 0),
  scheduled_at  timestamptz,
  status        public.round_status not null default 'scheduled',
  unique (tournament_id, number)
);

-- A team-vs-team encounter; its individual board games live in games.
create table public.matches (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments (id) on delete cascade,
  round_id      uuid references public.rounds (id) on delete set null,
  home_team_id  uuid not null references public.teams (id) on delete cascade,
  away_team_id  uuid not null references public.teams (id) on delete cascade,
  boards        int not null default 4 check (boards > 0),
  home_score    numeric(4, 1),
  away_score    numeric(4, 1),
  scheduled_at  timestamptz,
  venue         text,
  status        public.match_status not null default 'scheduled',
  notes         text,
  created_at    timestamptz not null default now(),
  check (home_team_id <> away_team_id)
);

-- Every game ever recorded — tournament, team board, or friendly. This
-- is also the archive (is_featured highlights notable ones).
create table public.games (
  id                  uuid primary key default gen_random_uuid(),
  tournament_id       uuid references public.tournaments (id) on delete set null,
  round_id            uuid references public.rounds (id) on delete set null,
  match_id            uuid references public.matches (id) on delete cascade,
  board               int check (board > 0),
  white_id            uuid not null references public.players (id) on delete restrict,
  black_id            uuid not null references public.players (id) on delete restrict,
  result              public.game_result not null default '*',
  termination         public.game_termination,
  time_control        text,                              -- e.g. '10+5'
  played_at           timestamptz,
  eco                 varchar(3),
  opening             text,
  pgn                 text,
  move_count          int check (move_count >= 0),
  source              public.game_source not null default 'otb',
  external_url        text,
  rated               boolean not null default true,
  white_rating_before int,                               -- filled by recompute_ratings()
  black_rating_before int,
  white_rating_change int,
  black_rating_change int,
  is_featured         boolean not null default false,
  is_public           boolean not null default true,
  notes               text,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (white_id <> black_id)
);
create index games_white_idx on public.games (white_id);
create index games_black_idx on public.games (black_id);
create index games_tournament_idx on public.games (tournament_id);
create index games_played_idx on public.games (played_at);

create table public.rating_history (
  id            bigint generated always as identity primary key,
  player_id     uuid not null references public.players (id) on delete cascade,
  game_id       uuid not null references public.games (id) on delete cascade,
  rating_before int not null,
  rating_after  int not null,
  recorded_at   timestamptz not null
);
create index rating_history_player_idx on public.rating_history (player_id, recorded_at);

-- ---------------------------------------------------------------------
-- Site content
-- ---------------------------------------------------------------------
create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text,
  is_published boolean not null default false,
  pinned       boolean not null default false,
  published_at timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create table public.milestones (
  id            uuid primary key default gen_random_uuid(),
  year          int not null,
  title         text not null,
  description   text,
  display_order int not null default 100
);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
create trigger profiles_updated    before update on public.profiles       for each row execute function public.set_updated_at();
create trigger players_updated     before update on public.players        for each row execute function public.set_updated_at();
create trigger private_updated     before update on public.player_private for each row execute function public.set_updated_at();
create trigger teams_updated       before update on public.teams          for each row execute function public.set_updated_at();
create trigger tournaments_updated before update on public.tournaments    for each row execute function public.set_updated_at();
create trigger games_updated       before update on public.games          for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Sign-up: every new auth user gets a profile and a pending player row.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  name text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  pid uuid;
begin
  insert into public.profiles (id, display_name) values (new.id, name);
  insert into public.players (profile_id, full_name, status) values (new.id, name, 'pending') returning id into pid;
  insert into public.player_private (player_id, email) values (pid, new.email);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Guards: what non-admins may change on rows they own
-- ---------------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_client_request() and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only admins can change roles' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard_profile_update();

create or replace function public.guard_player_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_client_request() and not public.is_admin() then
    if new.status      is distinct from old.status
    or new.profile_id  is distinct from old.profile_id
    or new.is_external is distinct from old.is_external
    or new.club_rating is distinct from old.club_rating
    or new.club_games  is distinct from old.club_games
    or new.peak_rating is distinct from old.peak_rating
    or new.joined_on   is distinct from old.joined_on then
      raise exception 'You can only edit your own profile details' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger players_guard before update on public.players for each row execute function public.guard_player_update();

create or replace function public.guard_entry_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_client_request() and not public.is_admin() then
    -- players may withdraw, or re-enter a withdrawn entry while registration is open
    if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
    or not (new.status = 'withdrawn'
            or (old.status = 'withdrawn' and new.status = 'pending' and public.can_self_register(new.tournament_id))) then
      raise exception 'Players can only withdraw or re-enter an entry' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger entries_guard before update on public.tournament_entries for each row execute function public.guard_entry_update();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.players            enable row level security;
alter table public.player_private     enable row level security;
alter table public.committee_members  enable row level security;
alter table public.teams              enable row level security;
alter table public.team_members       enable row level security;
alter table public.tournaments        enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.rounds             enable row level security;
alter table public.matches            enable row level security;
alter table public.games              enable row level security;
alter table public.rating_history     enable row level security;
alter table public.announcements      enable row level security;
alter table public.milestones         enable row level security;

-- Admins: everything, on every table.
do $$
declare t text;
begin
  foreach t in array array['profiles','players','player_private','committee_members','teams','team_members',
                           'tournaments','tournament_entries','rounds','matches','games','rating_history',
                           'announcements','milestones'] loop
    execute format('create policy "admins manage %1$s" on public.%1$I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- profiles: you see and edit your own (role changes blocked by guard).
create policy "own profile read"   on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- players: public roster = active / alumni / guest / external; plus yourself.
create policy "public roster" on public.players for select to anon, authenticated
  using (status in ('active', 'alumni', 'guest') or is_external);
create policy "own player read"   on public.players for select to authenticated using (profile_id = auth.uid());
create policy "own player update" on public.players for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- player_private: owner only (and admins).
create policy "own private read" on public.player_private for select to authenticated
  using (player_id = public.my_player_id());
create policy "own private write" on public.player_private for insert to authenticated
  with check (player_id = public.my_player_id());
create policy "own private update" on public.player_private for update to authenticated
  using (player_id = public.my_player_id()) with check (player_id = public.my_player_id());

-- Public reference data.
create policy "public read" on public.committee_members for select to anon, authenticated using (is_active);
create policy "public read" on public.teams             for select to anon, authenticated using (true);
create policy "public read" on public.team_members      for select to anon, authenticated using (true);
create policy "public read" on public.milestones        for select to anon, authenticated using (true);
create policy "public read" on public.rating_history    for select to anon, authenticated using (true);
create policy "public read" on public.announcements     for select to anon, authenticated using (is_published);

-- Tournaments & their children: visible once published.
create policy "published tournaments" on public.tournaments for select to anon, authenticated using (is_published);

create function public.tournament_is_public(tid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select tid is null or exists (select 1 from public.tournaments t where t.id = tid and t.is_published);
$$;

create policy "published rounds"  on public.rounds  for select to anon, authenticated using (public.tournament_is_public(tournament_id));
create policy "published matches" on public.matches for select to anon, authenticated using (public.tournament_is_public(tournament_id));
create policy "public games"      on public.games   for select to anon, authenticated
  using (is_public and public.tournament_is_public(tournament_id));
create policy "own games"         on public.games   for select to authenticated
  using (white_id = public.my_player_id() or black_id = public.my_player_id());

-- Entries: confirmed entries of published tournaments are public; you
-- always see your own; you may register yourself while registration is open.
create policy "public entries" on public.tournament_entries for select to anon, authenticated
  using (status = 'confirmed' and public.tournament_is_public(tournament_id));
create policy "own entries" on public.tournament_entries for select to authenticated
  using (player_id = public.my_player_id());

create function public.can_self_register(tid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tournaments t
    where t.id = tid and t.is_published and t.kind = 'individual'
      and t.status = 'registration_open'
      and (t.registration_opens_at  is null or now() >= t.registration_opens_at)
      and (t.registration_closes_at is null or now() <= t.registration_closes_at)
  ) and exists (
    select 1 from public.players p where p.profile_id = auth.uid() and p.status = 'active'
  );
$$;

create policy "self register" on public.tournament_entries for insert to authenticated
  with check (player_id = public.my_player_id() and team_id is null and status = 'pending'
              and public.can_self_register(tournament_id));
create policy "self withdraw" on public.tournament_entries for update to authenticated
  using (player_id = public.my_player_id()) with check (player_id = public.my_player_id());

-- ---------------------------------------------------------------------
-- Club rating (Elo), replayed from the full game history so that edits
-- and deletions of old results always produce consistent numbers.
--   start 1200 · K = 40 for a player's first 30 rated games, then 20
--   counts: rated games with a played result (forfeits/unfinished skipped)
-- ---------------------------------------------------------------------
create or replace function public.recompute_ratings()
returns void language plpgsql security definer set search_path = '' as $$
declare
  g record;
  rw int; rb int; nw int; nb int; kw int; kb int;
  ew float8; sw float8; dw int; db int;
begin
  if public.is_client_request() and not public.is_admin() then
    raise exception 'Only admins can recompute ratings' using errcode = '42501';
  end if;

  create temporary table if not exists _elo (player_id uuid primary key, rating int, games int, peak int) on commit drop;
  truncate _elo;
  insert into _elo select id, 1200, 0, 1200 from public.players;
  delete from public.rating_history;
  update public.games set white_rating_before = null, black_rating_before = null,
                          white_rating_change = null, black_rating_change = null
   where white_rating_before is not null or white_rating_change is not null;

  for g in
    select gm.id, gm.white_id, gm.black_id, gm.result, coalesce(gm.played_at, gm.created_at) as at
      from public.games gm
      left join public.tournaments t on t.id = gm.tournament_id
     where gm.rated and coalesce(t.rated, true)
       and gm.result in ('1-0', '0-1', '1/2-1/2')
     order by coalesce(gm.played_at, gm.created_at), gm.created_at, gm.id
  loop
    select rating, games into rw, nw from _elo where player_id = g.white_id;
    select rating, games into rb, nb from _elo where player_id = g.black_id;
    kw := case when nw < 30 then 40 else 20 end;
    kb := case when nb < 30 then 40 else 20 end;
    ew := 1.0 / (1.0 + power(10.0, (rb - rw) / 400.0));
    sw := case g.result when '1-0' then 1.0 when '0-1' then 0.0 else 0.5 end;
    dw := round(kw * (sw - ew));
    db := round(kb * ((1.0 - sw) - (1.0 - ew)));

    update _elo set rating = rating + dw, games = games + 1, peak = greatest(peak, rating + dw) where player_id = g.white_id;
    update _elo set rating = rating + db, games = games + 1, peak = greatest(peak, rating + db) where player_id = g.black_id;
    update public.games set white_rating_before = rw, black_rating_before = rb,
                            white_rating_change = dw, black_rating_change = db
     where id = g.id;
    insert into public.rating_history (player_id, game_id, rating_before, rating_after, recorded_at)
    values (g.white_id, g.id, rw, rw + dw, g.at), (g.black_id, g.id, rb, rb + db, g.at);
  end loop;

  update public.players p set club_rating = e.rating, club_games = e.games, peak_rating = e.peak
    from _elo e
   where e.player_id = p.id
     and (p.club_rating, p.club_games, p.peak_rating) is distinct from (e.rating, e.games, e.peak);
end $$;

revoke execute on function public.recompute_ratings() from public, anon;
grant execute on function public.recompute_ratings() to authenticated;

-- Recompute after any change to games (statement-level, so bulk imports
-- run it once). The depth guard skips the function's own game updates.
create or replace function public.games_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform public.recompute_ratings();
  return null;
end $$;

create trigger games_recompute_ratings
  after insert or update or delete on public.games
  for each statement execute function public.games_changed();

-- ---------------------------------------------------------------------
-- Views (security_invoker: the caller's RLS applies underneath)
-- ---------------------------------------------------------------------

-- Per-player results inside each tournament, with Buchholz tiebreak.
create view public.tournament_standings with (security_invoker = true) as
with sides as (
  select g.tournament_id, g.white_id as player_id, g.black_id as opponent_id,
         case g.result when '1-0' then 1.0 when '+/-' then 1.0 when '1/2-1/2' then 0.5 else 0.0 end as points,
         g.result in ('1-0', '+/-') as won, g.result = '1/2-1/2' as drew, g.result in ('0-1', '-/+', '0-0') as lost
    from public.games g where g.tournament_id is not null and g.result <> '*'
  union all
  select g.tournament_id, g.black_id, g.white_id,
         case g.result when '0-1' then 1.0 when '-/+' then 1.0 when '1/2-1/2' then 0.5 else 0.0 end,
         g.result in ('0-1', '-/+'), g.result = '1/2-1/2', g.result in ('1-0', '+/-', '0-0')
    from public.games g where g.tournament_id is not null and g.result <> '*'
),
totals as (
  select tournament_id, player_id, sum(points) as points, count(*) as played,
         count(*) filter (where won) as wins, count(*) filter (where drew) as draws, count(*) filter (where lost) as losses
    from sides group by tournament_id, player_id
)
select t.tournament_id, t.player_id, p.full_name, p.club_rating,
       t.points, t.played, t.wins, t.draws, t.losses,
       coalesce((select sum(o.points) from sides s join totals o
                  on o.tournament_id = s.tournament_id and o.player_id = s.opponent_id
                 where s.tournament_id = t.tournament_id and s.player_id = t.player_id), 0) as buchholz,
       rank() over (partition by t.tournament_id order by t.points desc,
         coalesce((select sum(o.points) from sides s join totals o
                    on o.tournament_id = s.tournament_id and o.player_id = s.opponent_id
                   where s.tournament_id = t.tournament_id and s.player_id = t.player_id), 0) desc) as rank
  from totals t join public.players p on p.id = t.player_id;

-- Team tournaments: 2 match points for a win, 1 for a draw, plus board points.
create view public.team_standings with (security_invoker = true) as
with sides as (
  select tournament_id, home_team_id as team_id, home_score as scored, away_score as conceded
    from public.matches where status = 'completed' and tournament_id is not null
  union all
  select tournament_id, away_team_id, away_score, home_score
    from public.matches where status = 'completed' and tournament_id is not null
)
select s.tournament_id, s.team_id, tm.name,
       count(*) as played,
       sum(case when s.scored > s.conceded then 2 when s.scored = s.conceded then 1 else 0 end) as match_points,
       sum(coalesce(s.scored, 0)) as board_points,
       count(*) filter (where s.scored > s.conceded) as wins,
       count(*) filter (where s.scored = s.conceded) as draws,
       count(*) filter (where s.scored < s.conceded) as losses
  from sides s join public.teams tm on tm.id = s.team_id
 group by s.tournament_id, s.team_id, tm.name;

-- Career numbers per player (all recorded, finished games).
create view public.player_stats with (security_invoker = true) as
with sides as (
  select white_id as player_id, result in ('1-0', '+/-') as won, result = '1/2-1/2' as drew,
         result in ('0-1', '-/+', '0-0') as lost, played_at from public.games where result <> '*'
  union all
  select black_id, result in ('0-1', '-/+'), result = '1/2-1/2',
         result in ('1-0', '+/-', '0-0'), played_at from public.games where result <> '*'
)
select p.id as player_id, p.full_name, p.club_rating, p.peak_rating, p.status,
       count(s.player_id) as games,
       count(*) filter (where s.won) as wins,
       count(*) filter (where s.drew) as draws,
       count(*) filter (where s.lost) as losses,
       case when count(s.player_id) > 0
            then round(100.0 * (count(*) filter (where s.won) + 0.5 * count(*) filter (where s.drew)) / count(s.player_id))
       end as score_pct,
       max(s.played_at) as last_played
  from public.players p left join sides s on s.player_id = p.id
 group by p.id;

grant select on public.tournament_standings, public.team_standings, public.player_stats to anon, authenticated;

-- ---------------------------------------------------------------------
-- First admin: after signing up on the site, run in the SQL editor:
--   update public.profiles set role = 'admin'
--    where id = (select id from auth.users where email = 'you@example.com');
-- ---------------------------------------------------------------------
