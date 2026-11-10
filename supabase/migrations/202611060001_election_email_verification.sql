create table public.election_email_codes (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null,
  eligibility_id uuid not null,
  code_hash text not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (eligibility_id, election_id)
    references public.voter_eligibility(id, election_id) on delete cascade
);

create index election_email_codes_lookup_idx
  on public.election_email_codes(eligibility_id, created_at desc);

alter table public.election_email_codes enable row level security;
revoke all on public.election_email_codes from anon, authenticated;
