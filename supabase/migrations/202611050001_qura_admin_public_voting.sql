create extension if not exists pgcrypto;

drop function if exists public.cast_ballot(uuid, uuid);
drop function if exists public.has_voted(uuid);
alter table public.ballots rename to legacy_school_ballots;
alter table public.voter_participation rename to legacy_school_voter_participation;
alter table public.candidates rename to legacy_school_candidates;
alter table public.elections rename to legacy_school_elections;
alter table public.voter_roster rename to legacy_school_voter_roster;
drop policy if exists "Only open elections are public" on public.legacy_school_elections;
drop policy if exists "Only open election candidates are public" on public.legacy_school_candidates;
alter table public.legacy_school_elections
  alter column status drop default;
alter table public.legacy_school_elections
  alter column status type text using status::text;
drop type public.election_status;

create type public.event_status as enum ('draft', 'open', 'closed', 'cancelled');
create type public.voting_event_type as enum ('poll', 'election');

create table public.admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_salt text not null,
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index admins_single_active_idx on public.admins ((is_active)) where is_active;

create table public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admins(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index admin_sessions_admin_id_idx on public.admin_sessions(admin_id);

create table public.rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  status public.event_status not null default 'draft',
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  results_public boolean not null default false,
  secret_ballots boolean not null default true,
  session_duplicate_protection boolean not null default true,
  rate_limit_per_minute integer not null default 10 check (rate_limit_per_minute between 1 and 120),
  bot_protection boolean not null default false,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint polls_dates_valid check (closes_at > opens_at)
);

create table public.poll_questions (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  prompt text not null,
  min_selections integer not null default 1 check (min_selections >= 0),
  max_selections integer not null default 1 check (max_selections >= 1),
  position integer not null default 0,
  constraint poll_question_selection_range check (min_selections <= max_selections)
);

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.poll_questions(id) on delete cascade,
  label text not null,
  position integer not null default 0
);

create table public.elections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  status public.event_status not null default 'draft',
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  results_public boolean not null default false,
  secret_ballots boolean not null default true,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint elections_dates_valid check (closes_at > opens_at)
);

create table public.election_positions (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  title text not null,
  min_selections integer not null default 1 check (min_selections >= 0),
  max_selections integer not null default 1 check (max_selections >= 1),
  position integer not null default 0,
  constraint election_position_selection_range check (min_selections <= max_selections)
);

create table public.media_files (
  id uuid primary key default gen_random_uuid(),
  storage_key text not null unique,
  original_name text not null,
  content_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  uploaded_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.election_positions(id) on delete cascade,
  name text not null,
  grade text not null default '',
  statement text not null default '',
  media_file_id uuid references public.media_files(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.voter_eligibility (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  voter_ref_hash text not null,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (election_id, voter_ref_hash),
  unique (id, election_id)
);

create table public.invitation_tokens (
  id uuid primary key default gen_random_uuid(),
  eligibility_id uuid not null,
  election_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (eligibility_id, election_id)
    references public.voter_eligibility(id, election_id) on delete cascade,
  unique (eligibility_id)
);

create table public.voting_links (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  token_hash text not null unique,
  is_active boolean not null default true,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index voting_links_one_active_per_poll
  on public.voting_links(poll_id) where is_active;

create table public.voter_participation (
  id uuid primary key default gen_random_uuid(),
  event_type public.voting_event_type not null,
  event_id uuid not null,
  participant_hash text not null,
  participated_at timestamptz not null default now(),
  unique (event_type, event_id, participant_hash)
);

create table public.ballots (
  id uuid primary key default gen_random_uuid(),
  event_type public.voting_event_type not null,
  event_id uuid not null,
  submitted_at timestamptz not null default now()
);

create table public.ballot_selections (
  id uuid primary key default gen_random_uuid(),
  ballot_id uuid not null references public.ballots(id) on delete cascade,
  poll_question_id uuid references public.poll_questions(id) on delete restrict,
  poll_option_id uuid references public.poll_options(id) on delete restrict,
  candidate_id uuid references public.candidates(id) on delete restrict,
  constraint ballot_selection_type check (
    (poll_question_id is not null and poll_option_id is not null and candidate_id is null)
    or (poll_question_id is null and poll_option_id is null and candidate_id is not null)
  )
);
create index ballot_selections_question_idx on public.ballot_selections(poll_question_id);
create index ballot_selections_candidate_idx on public.ballot_selections(candidate_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.admins(id) on delete cascade,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.admins(id) on delete set null,
  action text not null,
  event_type public.voting_event_type,
  event_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.admins(id) on delete set null,
  event_type public.voting_event_type not null,
  event_id uuid not null,
  report_type text not null,
  storage_key text,
  created_at timestamptz not null default now()
);

create table public.platform_settings (
  setting_key text primary key,
  setting_value jsonb not null,
  updated_by uuid references public.admins(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.public_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);

alter table public.admins enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.rate_limit_buckets enable row level security;
alter table public.polls enable row level security;
alter table public.poll_questions enable row level security;
alter table public.poll_options enable row level security;
alter table public.elections enable row level security;
alter table public.election_positions enable row level security;
alter table public.candidates enable row level security;
alter table public.voter_eligibility enable row level security;
alter table public.invitation_tokens enable row level security;
alter table public.voting_links enable row level security;
alter table public.voter_participation enable row level security;
alter table public.ballots enable row level security;
alter table public.ballot_selections enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.media_files enable row level security;
alter table public.reports enable row level security;
alter table public.platform_settings enable row level security;
alter table public.public_rate_limits enable row level security;

revoke all on all tables in schema public from anon, authenticated;

create or replace function public.consume_admin_login_limit(p_bucket text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.rate_limit_buckets (bucket_key, window_started_at, request_count)
  values (p_bucket, now(), 1)
  on conflict (bucket_key) do update
  set window_started_at = case
        when public.rate_limit_buckets.window_started_at <= now() - interval '15 minutes' then now()
        else public.rate_limit_buckets.window_started_at
      end,
      request_count = case
        when public.rate_limit_buckets.window_started_at <= now() - interval '15 minutes' then 1
        else public.rate_limit_buckets.request_count + 1
      end
  returning request_count into v_count;
  return v_count <= 10;
end;
$$;

create or replace function public.consume_public_rate_limit(p_bucket text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.public_rate_limits (bucket_key, window_started_at, request_count)
  values (p_bucket, now(), 1)
  on conflict (bucket_key) do update
  set window_started_at = case
        when public.public_rate_limits.window_started_at <= now() - interval '1 minute' then now()
        else public.public_rate_limits.window_started_at
      end,
      request_count = case
        when public.public_rate_limits.window_started_at <= now() - interval '1 minute' then 1
        else public.public_rate_limits.request_count + 1
      end
  returning request_count into v_count;
  return v_count <= greatest(1, least(p_limit, 120));
end;
$$;

create or replace function public.submit_poll_ballot(
  p_link_hash text,
  p_session_hash text,
  p_answers jsonb,
  p_enforce_session boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.voting_links%rowtype;
  v_poll public.polls%rowtype;
  v_answer jsonb;
  v_question_id uuid;
  v_option_ids uuid[];
  v_count integer;
  v_ballot_id uuid;
begin
  select * into v_link from public.voting_links
  where token_hash = p_link_hash and is_active and revoked_at is null;
  if not found then raise exception using message = 'INVALID_LINK'; end if;

  select * into v_poll from public.polls where id = v_link.poll_id for update;
  if not found or v_poll.status <> 'open' or now() < v_poll.opens_at or now() >= v_poll.closes_at then
    raise exception using message = 'POLL_CLOSED';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) = 0 then
    raise exception using message = 'INVALID_BALLOT';
  end if;

  for v_answer in select value from jsonb_array_elements(p_answers)
  loop
    v_question_id := (v_answer->>'questionId')::uuid;
    select array_agg(value::uuid) into v_option_ids
      from jsonb_array_elements_text(v_answer->'optionIds');
    v_count := coalesce(array_length(v_option_ids, 1), 0);

    if not exists (
      select 1 from public.poll_questions q
      where q.id = v_question_id and q.poll_id = v_poll.id
        and v_count between q.min_selections and q.max_selections
    ) then raise exception using message = 'INVALID_BALLOT'; end if;

    if v_count <> (select count(distinct value) from unnest(v_option_ids) value) then
      raise exception using message = 'INVALID_BALLOT';
    end if;
    if exists (
      select 1 from unnest(v_option_ids) selected_id
      where not exists (
        select 1 from public.poll_options o
        where o.id = selected_id and o.question_id = v_question_id
      )
    ) then raise exception using message = 'INVALID_BALLOT'; end if;
  end loop;

  if exists (
    select 1 from public.poll_questions q
    where q.poll_id = v_poll.id and q.min_selections > 0
      and not exists (
        select 1 from jsonb_array_elements(p_answers) answer
        where (answer->>'questionId')::uuid = q.id
      )
  ) then raise exception using message = 'INVALID_BALLOT'; end if;

  if (select count(*) from jsonb_array_elements(p_answers))
      <> (select count(distinct (value->>'questionId')) from jsonb_array_elements(p_answers) value) then
    raise exception using message = 'INVALID_BALLOT';
  end if;

  if p_enforce_session then
    insert into public.voter_participation (event_type, event_id, participant_hash)
    values ('poll', v_poll.id, p_session_hash)
    on conflict do nothing;
    if not found then raise exception using message = 'ALREADY_VOTED'; end if;
  end if;

  insert into public.ballots (event_type, event_id) values ('poll', v_poll.id)
  returning id into v_ballot_id;

  for v_answer in select value from jsonb_array_elements(p_answers)
  loop
    v_question_id := (v_answer->>'questionId')::uuid;
    for v_option_ids in
      select array_agg(value::uuid) from jsonb_array_elements_text(v_answer->'optionIds')
    loop
      insert into public.ballot_selections (ballot_id, poll_question_id, poll_option_id)
      select v_ballot_id, v_question_id, unnest(v_option_ids);
    end loop;
  end loop;

  return v_ballot_id;
exception
  when invalid_text_representation then raise exception using message = 'INVALID_BALLOT';
  when null_value_not_allowed then raise exception using message = 'INVALID_BALLOT';
end;
$$;

create or replace function public.submit_election_ballot(p_invitation_hash text, p_candidate_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitation_tokens%rowtype;
  v_election public.elections%rowtype;
  v_position public.election_positions%rowtype;
  v_candidate_id uuid;
  v_ballot_id uuid;
  v_count integer;
begin
  select * into v_invitation from public.invitation_tokens
  where token_hash = p_invitation_hash and revoked_at is null
    and (expires_at is null or expires_at > now())
  for update;
  if not found then raise exception using message = 'INVALID_INVITATION'; end if;

  select * into v_election from public.elections
  where id = v_invitation.election_id for update;
  if not found or v_election.status <> 'open' or now() < v_election.opens_at or now() >= v_election.closes_at then
    raise exception using message = 'ELECTION_CLOSED';
  end if;
  if not exists (
    select 1 from public.voter_eligibility
    where id = v_invitation.eligibility_id and election_id = v_election.id and is_active
  ) then raise exception using message = 'NOT_ELIGIBLE'; end if;
  if v_invitation.used_at is not null then raise exception using message = 'ALREADY_VOTED'; end if;
  if p_candidate_ids is null or cardinality(p_candidate_ids) = 0
     or cardinality(p_candidate_ids) <> (select count(distinct x) from unnest(p_candidate_ids) x) then
    raise exception using message = 'INVALID_BALLOT';
  end if;

  if exists (
    select 1 from unnest(p_candidate_ids) selected_id
    where not exists (
      select 1 from public.candidates c
      join public.election_positions ep on ep.id = c.position_id
      where c.id = selected_id and ep.election_id = v_election.id
    )
  ) then raise exception using message = 'INVALID_BALLOT'; end if;

  for v_position in
    select * from public.election_positions where election_id = v_election.id
  loop
    select count(*) into v_count
    from unnest(p_candidate_ids) selected_id
    join public.candidates c on c.id = selected_id
    where c.position_id = v_position.id;
    if v_count < v_position.min_selections or v_count > v_position.max_selections then
      raise exception using message = 'INVALID_BALLOT';
    end if;
  end loop;

  insert into public.voter_participation (event_type, event_id, participant_hash)
  values ('election', v_election.id, pg_catalog.md5(v_invitation.eligibility_id::text))
  on conflict do nothing;
  if not found then raise exception using message = 'ALREADY_VOTED'; end if;

  insert into public.ballots (event_type, event_id) values ('election', v_election.id)
  returning id into v_ballot_id;
  insert into public.ballot_selections (ballot_id, candidate_id)
  select v_ballot_id, unnest(p_candidate_ids);
  update public.invitation_tokens set used_at = now() where id = v_invitation.id;
  return v_ballot_id;
end;
$$;

create or replace function public.replace_poll_question(
  p_poll_id uuid,
  p_question_id uuid,
  p_prompt text,
  p_max_selections integer,
  p_options text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if cardinality(p_options) < 2 or cardinality(p_options) > 20
     or p_max_selections < 1 or p_max_selections > cardinality(p_options)
     or exists (select 1 from unnest(p_options) option where length(trim(option)) not between 1 and 120) then
    raise exception using message = 'INVALID_QUESTION';
  end if;
  if not exists (
    select 1 from public.polls where id = p_poll_id and status = 'draft'
  ) then raise exception using message = 'POLL_NOT_DRAFT'; end if;
  if not exists (
    select 1 from public.poll_questions where id = p_question_id and poll_id = p_poll_id
  ) then raise exception using message = 'INVALID_QUESTION'; end if;

  update public.poll_questions set prompt = trim(p_prompt), max_selections = p_max_selections
  where id = p_question_id;
  delete from public.poll_options where question_id = p_question_id;
  insert into public.poll_options (question_id, label, position)
  select p_question_id, trim(option), ordinal
  from unnest(p_options) with ordinality as options(option, ordinal);
end;
$$;

revoke all on function public.consume_admin_login_limit(text) from public, anon, authenticated;
revoke all on function public.consume_public_rate_limit(text, integer) from public, anon, authenticated;
revoke all on function public.submit_poll_ballot(text, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.submit_election_ballot(text, uuid[]) from public, anon, authenticated;
revoke all on function public.replace_poll_question(uuid, uuid, text, integer, text[]) from public, anon, authenticated;
grant execute on function public.consume_admin_login_limit(text) to service_role;
grant execute on function public.consume_public_rate_limit(text, integer) to service_role;
grant execute on function public.submit_poll_ballot(text, text, jsonb, boolean) to service_role;
grant execute on function public.submit_election_ballot(text, uuid[]) to service_role;
grant execute on function public.replace_poll_question(uuid, uuid, text, integer, text[]) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('qura-contestants', 'qura-contestants', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy "Contestant photos can be viewed publicly"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'qura-contestants');
