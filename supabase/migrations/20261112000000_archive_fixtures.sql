-- =====================================================================
-- Game archive (analysis) and automatic fixtures.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Archive: a game keeps its notation (pgn) and, when uploaded later, an
-- analysed PGN (evals, annotations, variations). Viewers prefer the
-- analysis because it carries strictly more information.
-- ---------------------------------------------------------------------
alter table public.games
  add column analysis_pgn        text,
  add column analysis_source     text check (analysis_source in ('lichess', 'chesscom', 'manual', 'other')),
  add column analysis_updated_at timestamptz,
  add column advance_id          uuid references public.players (id) on delete set null,  -- knockout: who goes through after a drawn game
  add column home_side           text check (home_side in ('white', 'black')),            -- team matches: which colour the home team had on this board
  add column final_fen           text;                                                     -- last position, for archive thumbnails

create or replace function public.games_stamp_analysis()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.analysis_pgn is distinct from (case when tg_op = 'UPDATE' then old.analysis_pgn end) then
    new.analysis_updated_at := case when new.analysis_pgn is null then null else now() end;
  end if;
  return new;
end $$;
create trigger games_stamp_analysis before insert or update of analysis_pgn on public.games
  for each row execute function public.games_stamp_analysis();

-- ---------------------------------------------------------------------
-- Tournaments: offline (club Elo) or online (Lichess) and per-format
-- settings, e.g. {"bye_points": 1, "simul_host": "<player id>"}.
-- ---------------------------------------------------------------------
alter table public.tournaments
  add column mode     text not null default 'offline' check (mode in ('offline', 'online')),
  add column settings jsonb not null default '{}'::jsonb;

-- Byes (odd numbers, knockout seeds). slot = bracket position for knockouts.
create table public.tournament_byes (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round_id      uuid not null references public.rounds (id) on delete cascade,
  player_id     uuid not null references public.players (id) on delete cascade,
  points        numeric(2, 1) not null default 1 check (points in (0, 0.5, 1)),
  slot          int,
  created_at    timestamptz not null default now(),
  unique (round_id, player_id)
);
alter table public.tournament_byes enable row level security;
create policy "admins manage tournament_byes" on public.tournament_byes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "published byes" on public.tournament_byes for select to anon, authenticated
  using (public.tournament_is_public(tournament_id));

-- A player can't be paired twice in one round (catches double-booking).
create or replace function public.guard_round_pairing()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.round_id is null then return new; end if;
  if exists (
    select 1 from public.games g
     where g.round_id = new.round_id and g.id <> new.id
       and (g.white_id in (new.white_id, new.black_id) or g.black_id in (new.white_id, new.black_id))
  ) or exists (
    select 1 from public.tournament_byes b where b.round_id = new.round_id and b.player_id in (new.white_id, new.black_id)
  ) then
    raise exception 'A player is already paired in this round' using errcode = '23505';
  end if;
  return new;
end $$;
create constraint trigger games_one_pairing_per_round after insert or update of round_id, white_id, black_id on public.games
  deferrable initially deferred
  for each row execute function public.guard_round_pairing();

-- ---------------------------------------------------------------------
-- Team matches: the score is the sum of its board games.
-- ---------------------------------------------------------------------
create or replace function public.refresh_match_scores()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.matches m
     set home_score = x.home, away_score = x.away, status = x.new_status
    from (
      select s.*, (case when s.open = 0 and mm.status in ('scheduled', 'ongoing') then 'completed'
                        when s.decided > 0 and mm.status = 'scheduled' then 'ongoing'
                        else mm.status::text end)::public.match_status as new_status
        from (
          select g.match_id,
                 sum(case when g.result in ('1-0', '+/-') then (case g.home_side when 'black' then 0 else 1 end)
                          when g.result in ('0-1', '-/+') then (case g.home_side when 'black' then 1 else 0 end)
                          when g.result = '1/2-1/2' then 0.5 else 0 end) as home,
                 sum(case when g.result in ('1-0', '+/-') then (case g.home_side when 'black' then 1 else 0 end)
                          when g.result in ('0-1', '-/+') then (case g.home_side when 'black' then 0 else 1 end)
                          when g.result = '1/2-1/2' then 0.5 else 0 end) as away,
                 count(*) filter (where g.result = '*') as open,
                 count(*) filter (where g.result <> '*') as decided
            from public.games g
           where g.match_id is not null
           group by g.match_id
        ) s
        join public.matches mm on mm.id = s.match_id
    ) x
   where m.id = x.match_id
     and (m.home_score, m.away_score, m.status) is distinct from (x.home, x.away, x.new_status);
  return null;
end $$;
create trigger games_refresh_match_scores after insert or update or delete on public.games
  for each statement execute function public.refresh_match_scores();

-- ---------------------------------------------------------------------
-- Standings now include byes (points, no opponent, no Buchholz).
-- ---------------------------------------------------------------------
drop view if exists public.tournament_standings;
create view public.tournament_standings with (security_invoker = true) as
with sides as (
  select g.tournament_id, g.white_id as player_id, g.black_id as opponent_id,
         case g.result when '1-0' then 1.0 when '+/-' then 1.0 when '1/2-1/2' then 0.5 else 0.0 end as points,
         g.result in ('1-0', '+/-') as won, g.result = '1/2-1/2' as drew, g.result in ('0-1', '-/+', '0-0') as lost, false as bye
    from public.games g where g.tournament_id is not null and g.result <> '*'
  union all
  select g.tournament_id, g.black_id, g.white_id,
         case g.result when '0-1' then 1.0 when '-/+' then 1.0 when '1/2-1/2' then 0.5 else 0.0 end,
         g.result in ('0-1', '-/+'), g.result = '1/2-1/2', g.result in ('1-0', '+/-', '0-0'), false
    from public.games g where g.tournament_id is not null and g.result <> '*'
  union all
  select b.tournament_id, b.player_id, null, b.points, false, false, false, true
    from public.tournament_byes b
),
totals as (
  select tournament_id, player_id, sum(points) as points,
         count(*) filter (where not bye) as played,
         count(*) filter (where won) as wins, count(*) filter (where drew) as draws, count(*) filter (where lost) as losses,
         count(*) filter (where bye) as byes
    from sides group by tournament_id, player_id
),
buch as (
  select s.tournament_id, s.player_id, coalesce(sum(o.points), 0) as buchholz
    from sides s left join totals o on o.tournament_id = s.tournament_id and o.player_id = s.opponent_id
   where s.opponent_id is not null
   group by s.tournament_id, s.player_id
)
select t.tournament_id, t.player_id, p.full_name, p.club_rating,
       t.points, t.played, t.wins, t.draws, t.losses, t.byes,
       coalesce(b.buchholz, 0) as buchholz,
       rank() over (partition by t.tournament_id order by t.points desc, coalesce(b.buchholz, 0) desc, t.wins desc) as rank
  from totals t
  join public.players p on p.id = t.player_id
  left join buch b on b.tournament_id = t.tournament_id and b.player_id = t.player_id;
grant select on public.tournament_standings to anon, authenticated;

-- ---------------------------------------------------------------------
-- Round RPCs — each runs as one transaction, with the caller's RLS
-- (admins only), so a half-written round can never exist.
--   pairings: [{ "id"?, "board", "white_id", "black_id", "home_side"?, "match_ref"? }]
--   byes:     [{ "player_id", "points", "slot"? }]
--   matches:  [{ "ref", "home_team_id", "away_team_id", "boards" }]   (team events)
-- ---------------------------------------------------------------------
create or replace function public.create_round(
  p_tournament uuid, p_number int, p_pairings jsonb, p_byes jsonb default '[]', p_matches jsonb default '[]', p_scheduled_at timestamptz default null)
returns uuid language plpgsql set search_path = '' as $$
declare
  t public.tournaments;
  rid uuid;
  refs jsonb := '{}';
  m jsonb;
  mid uuid;
begin
  if not public.is_admin() then raise exception 'Only admins can create rounds' using errcode = '42501'; end if;
  select * into t from public.tournaments where id = p_tournament;
  if not found then raise exception 'Tournament not found'; end if;
  if exists (select 1 from public.rounds where tournament_id = p_tournament and number = p_number) then
    raise exception 'Round % already exists', p_number using errcode = '23505';
  end if;

  insert into public.rounds (tournament_id, number, status, scheduled_at)
  values (p_tournament, p_number, 'ongoing', p_scheduled_at) returning id into rid;

  for m in select * from jsonb_array_elements(coalesce(p_matches, '[]')) loop
    insert into public.matches (tournament_id, round_id, home_team_id, away_team_id, boards, status, scheduled_at)
    values (p_tournament, rid, (m->>'home_team_id')::uuid, (m->>'away_team_id')::uuid, coalesce((m->>'boards')::int, 4), 'scheduled', p_scheduled_at)
    returning id into mid;
    refs := refs || jsonb_build_object(m->>'ref', mid);
  end loop;

  insert into public.games (tournament_id, round_id, match_id, board, white_id, black_id, result, rated, source, home_side, played_at, created_by)
  select p_tournament, rid, (refs->>(p->>'match_ref'))::uuid, (p->>'board')::int,
         (p->>'white_id')::uuid, (p->>'black_id')::uuid, '*', t.rated,
         (case when t.mode = 'online' then 'lichess' else 'otb' end)::public.game_source,
         p->>'home_side', p_scheduled_at, auth.uid()
    from jsonb_array_elements(coalesce(p_pairings, '[]')) p;

  insert into public.tournament_byes (tournament_id, round_id, player_id, points, slot)
  select p_tournament, rid, (b->>'player_id')::uuid, coalesce((b->>'points')::numeric, 1), (b->>'slot')::int
    from jsonb_array_elements(coalesce(p_byes, '[]')) b;

  if t.status in ('draft', 'registration_open', 'registration_closed') then
    update public.tournaments set status = 'ongoing' where id = p_tournament;
  end if;
  return rid;
end $$;

-- Replace a round's pairings. Games that already have a result must keep
-- their players; removing them is refused.
create or replace function public.save_round_pairings(p_round uuid, p_pairings jsonb, p_byes jsonb default null)
returns void language plpgsql set search_path = '' as $$
declare
  r public.rounds;
  t public.tournaments;
  p jsonb;
  g public.games;
  keep uuid[] := '{}';
begin
  if not public.is_admin() then raise exception 'Only admins can edit pairings' using errcode = '42501'; end if;
  select * into r from public.rounds where id = p_round;
  if not found then raise exception 'Round not found'; end if;
  select * into t from public.tournaments where id = r.tournament_id;

  for p in select * from jsonb_array_elements(coalesce(p_pairings, '[]')) loop
    if p ? 'id' and p->>'id' is not null then
      select * into g from public.games where id = (p->>'id')::uuid and round_id = p_round;
      if not found then raise exception 'Pairing % is not in this round', p->>'id'; end if;
      if g.result <> '*' and (g.white_id, g.black_id) is distinct from ((p->>'white_id')::uuid, (p->>'black_id')::uuid) then
        raise exception 'Board % already has a result — clear it before changing the players', g.board using errcode = '42501';
      end if;
      update public.games set board = (p->>'board')::int, white_id = (p->>'white_id')::uuid, black_id = (p->>'black_id')::uuid,
                              home_side = coalesce(p->>'home_side', home_side)
       where id = g.id;
      keep := keep || g.id;
    else
      insert into public.games (tournament_id, round_id, match_id, board, white_id, black_id, result, rated, source, home_side, played_at, created_by)
      values (r.tournament_id, p_round, (p->>'match_id')::uuid, (p->>'board')::int, (p->>'white_id')::uuid, (p->>'black_id')::uuid, '*', t.rated,
              (case when t.mode = 'online' then 'lichess' else 'otb' end)::public.game_source, p->>'home_side', r.scheduled_at, auth.uid())
      returning id into g.id;
      keep := keep || g.id;
    end if;
  end loop;

  if exists (select 1 from public.games where round_id = p_round and not (id = any (keep)) and result <> '*') then
    raise exception 'A board with a result can''t be removed — clear its result first' using errcode = '42501';
  end if;
  delete from public.games where round_id = p_round and not (id = any (keep));

  if p_byes is not null then
    delete from public.tournament_byes where round_id = p_round;
    insert into public.tournament_byes (tournament_id, round_id, player_id, points, slot)
    select r.tournament_id, p_round, (b->>'player_id')::uuid, coalesce((b->>'points')::numeric, 1), (b->>'slot')::int
      from jsonb_array_elements(p_byes) b;
  end if;
end $$;

-- Delete a round with its pairings, byes and team matches. Only the latest
-- round, so later rounds never point at a missing one.
create or replace function public.delete_round(p_round uuid)
returns int language plpgsql set search_path = '' as $$
declare
  r public.rounds;
  n int;
begin
  if not public.is_admin() then raise exception 'Only admins can delete rounds' using errcode = '42501'; end if;
  select * into r from public.rounds where id = p_round;
  if not found then raise exception 'Round not found'; end if;
  if exists (select 1 from public.rounds where tournament_id = r.tournament_id and number > r.number) then
    raise exception 'Delete the later rounds first (only the latest round can be deleted)' using errcode = '42501';
  end if;
  delete from public.games where round_id = p_round;
  get diagnostics n = row_count;
  delete from public.matches where round_id = p_round;
  delete from public.rounds where id = p_round;
  return n;
end $$;

revoke execute on function public.create_round(uuid, int, jsonb, jsonb, jsonb, timestamptz) from public, anon;
revoke execute on function public.save_round_pairings(uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.delete_round(uuid) from public, anon;
grant execute on function public.create_round(uuid, int, jsonb, jsonb, jsonb, timestamptz) to authenticated;
grant execute on function public.save_round_pairings(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.delete_round(uuid) to authenticated;
