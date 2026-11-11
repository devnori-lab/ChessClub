-- =====================================================================
-- Starting levels, offline-only club rating, Lichess ratings, open sign-up
-- and admin account management.
--
--   * Sign-up (email or Google) makes you an active player at once.
--   * New players answer a one-question survey that sets their starting
--     club rating: beginner 800 · intermediate 1400 · professional 1600.
--   * The club rating (Elo) is calculated from OFFLINE (over-the-board)
--     games only. Online games keep the players' Lichess ratings instead,
--     taken from the game's PGN.
--   * Admins can edit every detail of a player and delete accounts.
-- =====================================================================

create type public.start_level as enum ('beginner', 'intermediate', 'professional');

create or replace function public.start_rating_for(lvl public.start_level)
returns int language sql immutable set search_path = '' as $$
  select case lvl when 'beginner' then 800 when 'intermediate' then 1400 when 'professional' then 1600 end;
$$;

alter table public.players
  add column start_level       public.start_level,  -- null until the survey is answered
  add column start_rating      int check (start_rating between 100 and 3000),
  add column lichess_rating    int,                  -- from the player's latest recorded Lichess game
  add column lichess_rating_at timestamptz;
comment on column public.players.college is 'Constituent college (internal players) or other institution (external players).';
comment on column public.players.start_rating is 'Club rating before any games: set by the level survey, or by an admin.';

alter table public.games
  add column white_lichess_rating int,               -- PGN WhiteElo (rating before the game)
  add column black_lichess_rating int,               -- PGN BlackElo
  add column white_lichess_change int,               -- PGN WhiteRatingDiff
  add column black_lichess_change int;               -- PGN BlackRatingDiff

comment on column public.teams.college is 'College the team represents: a constituent college for internal teams, the other institution for external ones.';

-- ---------------------------------------------------------------------
-- Sign-up: active straight away. Google sends 'name' / 'avatar_url'.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}');
  name text := coalesce(nullif(trim(meta ->> 'full_name'), ''), nullif(trim(meta ->> 'name'), ''), split_part(new.email, '@', 1));
  avatar text := coalesce(meta ->> 'avatar_url', meta ->> 'picture');
  pid uuid;
begin
  insert into public.profiles (id, display_name, avatar_url) values (new.id, name, avatar);
  insert into public.players (profile_id, full_name, status, photo_url) values (new.id, name, 'active', avatar) returning id into pid;
  insert into public.player_private (player_id, email) values (pid, new.email);
  return new;
end $$;

-- Accounts that signed up while approval was still required.
update public.players set status = 'active' where status = 'pending' and profile_id is not null;

-- ---------------------------------------------------------------------
-- Guard: internal rating writes set app.rating_write for their own
-- duration. Clients can't set it: PostgREST exposes no set_config.
-- ---------------------------------------------------------------------
create or replace function public.guard_player_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_client_request() and not public.is_admin()
     and coalesce(current_setting('app.rating_write', true), '') <> 'on' then
    if new.status            is distinct from old.status
    or new.profile_id        is distinct from old.profile_id
    or new.is_external       is distinct from old.is_external
    or new.club_rating       is distinct from old.club_rating
    or new.club_games        is distinct from old.club_games
    or new.peak_rating       is distinct from old.peak_rating
    or new.start_level       is distinct from old.start_level
    or new.start_rating      is distinct from old.start_rating
    or new.lichess_rating    is distinct from old.lichess_rating
    or new.lichess_rating_at is distinct from old.lichess_rating_at
    or new.joined_on         is distinct from old.joined_on then
      raise exception 'You can only edit your own profile details' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Club rating (Elo) — replayed from the full history of offline games.
--
--   expected  E = 1 / (1 + 10^((Ropp − R) / 400))
--   new       R' = R + K · (S − E)        S = 1 win · ½ draw · 0 loss
--   K         40 for a player's first 30 rated games, 20 after
--   start     the player's start_rating (survey level), else 1200
--   counted   rated, decided (1-0 · 0-1 · ½-½) games with source 'otb'
--             or 'other'; online, forfeit and unfinished games are not.
-- ---------------------------------------------------------------------
create or replace function public._recompute_ratings()
returns void language plpgsql security definer set search_path = '' as $$
declare
  g record;
  rw int; rb int; nw int; nb int; kw int; kb int;
  ew float8; sw float8; dw int; db int;
begin
  perform set_config('app.rating_write', 'on', true);

  create temporary table if not exists _elo (player_id uuid primary key, rating int, games int, peak int) on commit drop;
  truncate _elo;
  insert into _elo select id, coalesce(start_rating, 1200), 0, coalesce(start_rating, 1200) from public.players;
  delete from public.rating_history;
  update public.games set white_rating_before = null, black_rating_before = null,
                          white_rating_change = null, black_rating_change = null
   where white_rating_before is not null or white_rating_change is not null;

  for g in
    select gm.id, gm.white_id, gm.black_id, gm.result, coalesce(gm.played_at, gm.created_at) as at
      from public.games gm
      left join public.tournaments t on t.id = gm.tournament_id
     where gm.rated and coalesce(t.rated, true)
       and gm.source in ('otb', 'other')
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

  -- Lichess rating = rating after the player's most recent recorded Lichess game.
  update public.players p set lichess_rating = l.rating, lichess_rating_at = l.at
    from (
      select distinct on (player_id) player_id, rating, at from (
        select white_id as player_id, white_lichess_rating + coalesce(white_lichess_change, 0) as rating,
               coalesce(played_at, created_at) as at, created_at
          from public.games where source = 'lichess' and white_lichess_rating is not null
        union all
        select black_id, black_lichess_rating + coalesce(black_lichess_change, 0),
               coalesce(played_at, created_at), created_at
          from public.games where source = 'lichess' and black_lichess_rating is not null
      ) s order by player_id, at desc, created_at desc
    ) l
   where l.player_id = p.id
     and (p.lichess_rating, p.lichess_rating_at) is distinct from (l.rating, l.at);

  perform set_config('app.rating_write', '', true);
end $$;
revoke execute on function public._recompute_ratings() from public, anon, authenticated;

-- Public entry point (admin "Recompute ratings" button).
create or replace function public.recompute_ratings()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_client_request() and not public.is_admin() then
    raise exception 'Only admins can recompute ratings' using errcode = '42501';
  end if;
  perform public._recompute_ratings();
end $$;

create or replace function public.games_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform public._recompute_ratings();
  return null;
end $$;

-- A changed starting rating (survey answer or admin edit) replays everything.
create or replace function public.start_rating_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform public._recompute_ratings();
  return null;
end $$;
create trigger players_start_rating_changed
  after update of start_level, start_rating on public.players
  for each statement execute function public.start_rating_changed();

-- Admin picks a level without typing a number → fill the matching rating.
create or replace function public.fill_start_rating()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.start_level is not null and new.start_rating is null then
    new.start_rating := public.start_rating_for(new.start_level);
  elsif tg_op = 'UPDATE' and new.start_level is distinct from old.start_level
        and new.start_rating is not distinct from old.start_rating and new.start_level is not null then
    new.start_rating := public.start_rating_for(new.start_level);
  end if;
  return new;
end $$;
create trigger players_fill_start_rating
  before insert or update of start_level, start_rating on public.players
  for each row execute function public.fill_start_rating();

-- New players added by admins with a start rating begin at that rating.
create or replace function public.init_player_rating()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.start_rating is not null and not exists (select 1 from public.games where white_id = new.id or black_id = new.id) then
    new.club_rating := new.start_rating;
    new.peak_rating := new.start_rating;
  end if;
  return new;
end $$;
create trigger players_init_rating before insert on public.players
  for each row execute function public.init_player_rating();

-- ---------------------------------------------------------------------
-- The level survey. A player may answer (or change the answer) until
-- they've played a rated offline game; after that only admins can.
-- ---------------------------------------------------------------------
create or replace function public.choose_start_level(chosen public.start_level)
returns int language plpgsql security definer set search_path = '' as $$
declare
  me public.players;
begin
  select * into me from public.players where profile_id = auth.uid();
  if not found then
    raise exception 'No player record for this account' using errcode = '42501';
  end if;
  if me.club_games > 0 then
    raise exception 'Your starting level is locked after your first rated game. Ask the committee to change it.' using errcode = '42501';
  end if;
  perform set_config('app.rating_write', 'on', true);
  update public.players
     set start_level = chosen, start_rating = public.start_rating_for(chosen),
         club_rating = public.start_rating_for(chosen), peak_rating = public.start_rating_for(chosen)
   where id = me.id;
  perform set_config('app.rating_write', '', true);
  return public.start_rating_for(chosen);
end $$;
revoke execute on function public.choose_start_level(public.start_level) from public, anon;
grant execute on function public.choose_start_level(public.start_level) to authenticated;

-- ---------------------------------------------------------------------
-- Admin: delete a login. The player record (and its game history) is
-- kept when they have games — it's unlinked and marked inactive;
-- otherwise it's deleted too. Returns what happened.
-- ---------------------------------------------------------------------
create or replace function public.admin_delete_account(target uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  pid uuid;
  has_games boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete accounts' using errcode = '42501';
  end if;
  if target = auth.uid() then
    raise exception 'You can''t delete your own account here' using errcode = '42501';
  end if;
  select id into pid from public.players where profile_id = target;
  has_games := pid is not null and exists (select 1 from public.games where white_id = pid or black_id = pid);

  if pid is not null and has_games then
    update public.players set status = 'inactive', profile_id = null where id = pid;
  elsif pid is not null then
    delete from public.players where id = pid;
  end if;
  delete from auth.users where id = target;
  if not found then
    raise exception 'Account not found';
  end if;
  return case when has_games then 'kept_player' when pid is not null then 'deleted_player' else 'deleted' end;
end $$;
revoke execute on function public.admin_delete_account(uuid) from public, anon;
grant execute on function public.admin_delete_account(uuid) to authenticated;

-- Bring stored numbers in line with the new rules (offline-only, start ratings).
select public._recompute_ratings();
