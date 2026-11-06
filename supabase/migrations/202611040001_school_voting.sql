create extension if not exists pgcrypto;

create type public.election_status as enum ('draft', 'open', 'closed');

create table public.voter_roster (
  student_id_hash text primary key,
  email text not null unique
);

create table public.elections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  status public.election_status not null default 'draft',
  constraint elections_dates_valid check (closes_at > opens_at)
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  name text not null,
  position text not null default '',
  grade text not null default '',
  statement text not null default ''
);

create table public.voter_participation (
  election_id uuid not null references public.elections(id) on delete cascade,
  student_id_hash text not null references public.voter_roster(student_id_hash) on delete restrict,
  primary key (election_id, student_id_hash)
);

create table public.ballots (
  election_id uuid not null references public.elections(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete restrict
);

create index ballots_election_id_idx on public.ballots(election_id);

alter table public.voter_roster enable row level security;
alter table public.elections enable row level security;
alter table public.candidates enable row level security;
alter table public.voter_participation enable row level security;
alter table public.ballots enable row level security;

revoke all on public.voter_roster, public.voter_participation, public.ballots from anon, authenticated;
revoke all on public.elections, public.candidates from anon, authenticated;
grant select on public.elections, public.candidates to anon, authenticated;

create policy "Only open elections are public"
  on public.elections for select
  to anon, authenticated
  using (status = 'open' and now() >= opens_at and now() < closes_at);

create policy "Only open election candidates are public"
  on public.candidates for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.elections e
      where e.id = candidates.election_id
        and e.status = 'open'
        and now() >= e.opens_at
        and now() < e.closes_at
    )
  );

create or replace function public.cast_ballot(p_election_id uuid, p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id_hash text;
begin
  if auth.uid() is null then
    raise exception using message = 'NOT_AUTHENTICATED';
  end if;

  select r.student_id_hash
    into v_student_id_hash
  from public.voter_roster r
  join auth.users u on lower(u.email) = lower(r.email)
  where u.id = auth.uid();

  if v_student_id_hash is null then
    raise exception using message = 'NOT_ELIGIBLE';
  end if;

  perform 1
  from public.elections e
  where e.id = p_election_id
    and e.status = 'open'
    and now() >= e.opens_at
    and now() < e.closes_at
  for update;

  if not found then
    raise exception using message = 'ELECTION_CLOSED';
  end if;

  if not exists (
    select 1
    from public.candidates c
    where c.id = p_candidate_id and c.election_id = p_election_id
  ) then
    raise exception using message = 'INVALID_CANDIDATE';
  end if;

  insert into public.voter_participation (election_id, student_id_hash)
  values (p_election_id, v_student_id_hash)
  on conflict do nothing;

  if not found then
    raise exception using message = 'ALREADY_VOTED';
  end if;

  insert into public.ballots (election_id, candidate_id)
  values (p_election_id, p_candidate_id);
end;
$$;

create or replace function public.has_voted(p_election_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using message = 'NOT_AUTHENTICATED';
  end if;

  return exists (
    select 1
    from public.voter_participation p
    join public.voter_roster r on r.student_id_hash = p.student_id_hash
    join auth.users u on lower(u.email) = lower(r.email)
    where p.election_id = p_election_id and u.id = auth.uid()
  );
end;
$$;

revoke all on function public.cast_ballot(uuid, uuid) from public, anon;
revoke all on function public.has_voted(uuid) from public, anon;
grant execute on function public.cast_ballot(uuid, uuid) to authenticated;
grant execute on function public.has_voted(uuid) to authenticated;
