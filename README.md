# QURA

QURA is a single-admin-managed polls and school-election platform. Voters do not create accounts or log in: public polls use a shareable link, while formal elections use one-time invitation links generated from an administrator-approved eligibility list.

## Important

This is an election-management starter, not a certified voting system. Before using it for a real election, complete an independent security and privacy review, test the full process with non-production data, secure the hosting and database, configure backups and incident response, and have the school approve eligibility, retention, and result-publication procedures. Secret ballots are separated from participation records in application tables; this is not cryptographic anonymity against privileged administrators, infrastructure operators, or correlated logs.

## Setup

Requirements: Node.js 20.9+, a Supabase project, and the project's service-role key.

1. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a random 32-byte-or-longer `QURA_HASH_SECRET`. Use the Supabase **Project URL** as `NEXT_PUBLIC_SUPABASE_URL` (for example, `https://<project-ref>.supabase.co`), not the REST endpoint ending in `/rest/v1/`. Keep all real values private. The service-role key and hash secret are server-only.
2. Apply the migrations in order with the Supabase SQL editor or Supabase CLI:
   - `supabase/migrations/202611040001_school_voting.sql`
   - `supabase/migrations/202611050001_qura_admin_public_voting.sql`

   The second migration retires the student-account voting schema and renames its existing tables to `legacy_school_*` rather than deleting them. Review your school's retention policy before removing that legacy data.

## Administrator workflow

- **Polls:** create a question and answer options, configure dates, browser-session duplicate protection, IP rate limits, and optional Turnstile. Generate a public link and QR code, then share it. A public link does not establish one-person-one-vote; session checks can be bypassed by clearing browser storage or switching devices. Use eligibility invitations for formal elections.
- **Formal elections:** create positions and contestants. Add contestant photographs (JPG, PNG, or WebP; maximum 3 MB). Before opening an election, import a private CSV with the exact header `voter_id,email`. The app stores an HMAC hash of each voter ID and returns a one-time invitation CSV. Distribute that file through an approved private channel; each URL is a bearer credential and can be used by whoever receives it first. No email is sent automatically.
- **Voting:** links show poll choices or election contestants directly, without voter login. Backend database functions validate link, event status and time window, choices, eligibility, and duplicate rules before recording a ballot.
- **Results:** administrators can view participation and results, export results as CSV, and publish or hide results for voters. Public results are only visible after the event is closed and the administrator publishes them.
- **Audit:** administrator actions are recorded in the audit log. Closing an event rejects subsequent submissions. A draft can be cancelled; an open event can be closed or cancelled.

## Security and operations

- Admin passwords are scrypt-hashed. Admin sessions use random opaque tokens whose hashes are stored server-side, HttpOnly/SameSite cookies, an eight-hour expiry, same-origin checks, and a database-backed login rate limit.
- Public poll sessions are anonymous browser cookies and are a deterrent, not proof of identity. Database-backed per-IP rate limits apply. Configure the hosting proxy so `x-forwarded-for` is set by a trusted proxy; do not expose spoofable forwarded headers from untrusted clients.
- Formal eligibility and invitation tokens are stored as hashes; a token is single-use and bound to the imported election eligibility entry. Protect and promptly delete downloaded invitation CSVs after secure delivery.
- RLS denies direct public access to management, eligibility, participation, ballots, and settings tables. Server routes use the Supabase service-role key; protect that key and hosting environment.
- Candidate photos are public because they appear on public ballots. Only the server can upload them.
- `secret_ballots` defaults on and the schema always stores participation separately from ballot selections. Do not correlate provider logs or grant direct database access to staff who should not see both records.
- Never commit `.env.local`, voter eligibility files, invitation exports, real credentials, or real voter data.

## Checks

- `npm run lint`
- `npm run build`
