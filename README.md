# QURA

QURA is a single-admin-managed polls and school-election platform. Voters do not create accounts: public polls use shareable links, while formal elections check the registration number against an administrator-approved eligibility list.

## Important

This is an election-management starter, not a certified voting system. Before using it for a real election, complete an independent security and privacy review, test the full process with non-production data, secure the hosting and database, configure backups and incident response, and have the school approve eligibility, retention, and result-publication procedures. Secret ballots are separated from participation records in application tables; this is not cryptographic anonymity against privileged administrators, infrastructure operators, or correlated logs.

## Setup

Requirements: Node.js 20.9+, a Supabase project, and the project's service-role key.

1. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a random 32-byte-or-longer `QURA_HASH_SECRET`. Use the Supabase **Project URL** as `NEXT_PUBLIC_SUPABASE_URL` (for example, `https://<project-ref>.supabase.co`), not the REST endpoint ending in `/rest/v1/`. Keep all real values private. The service-role key and hash secret are server-only.
2. Apply the migrations in order with the Supabase SQL editor or Supabase CLI:
   - `supabase/migrations/202611040001_school_voting.sql`
   - `supabase/migrations/202611050001_qura_admin_public_voting.sql`
   - `supabase/migrations/202611060001_election_email_verification.sql`

   The second migration retires the student-account voting schema and renames its existing tables to `legacy_school_*` rather than deleting them. Review your school's retention policy before removing that legacy data.

## Administrator workflow

- **Polls:** create a question and answer options, configure dates, browser-session duplicate protection, IP rate limits, and optional Turnstile. Generate a public link and QR code, then share it. A public link does not establish one-person-one-vote; session checks can be bypassed by clearing browser storage or switching devices. Use eligibility invitations for formal elections.
- **Formal elections:** create positions and contestants. Add contestant photographs (JPG, PNG, or WebP; maximum 3 MB). Open **Voters** from the admin navigation to choose an election, review eligible voter emails and status, and add voters to a draft election. Registration numbers are stored as one-way hashes and cannot be displayed. You can also import a private CSV with the exact header `voter_id,email`; a separate student system can push records to QURA's authenticated sync API while an election is a draft. Share the election's single voter link. Email-code verification is off by default; turn it on in Settings when server-side email delivery is configured.
- **Voting:** links show poll choices or election contestants directly, without voter login. Backend database functions validate link, event status and time window, choices, eligibility, and duplicate rules before recording a ballot.
- **Results:** administrators can view participation and results, export results as CSV, and publish or hide results for voters. Public results are only visible after the event is closed and results are set to public.
- **Audit:** administrator actions are recorded in the audit log. Closing an event rejects subsequent submissions. A draft can be cancelled; an open event can be closed or cancelled.

## Security and operations

- **Settings:** configure school name/contact email, timezone, English or Kiswahili navigation and date formatting, admin workspace theme, event duration, poll defaults, result visibility defaults, email-code requirement, and admin session timeout. Session timeout changes apply at next sign-in. The Settings page also supports changing the admin password and ends existing sessions afterward.
- Admin passwords must be at least 6 characters and are scrypt-hashed. Admin sessions use random opaque tokens whose hashes are stored server-side, HttpOnly/SameSite cookies, a configurable 1–24 hour expiry, same-origin checks, and a database-backed login rate limit.
- Email verification is off by default. To enable it, turn on **Require email verification codes** in Settings, provide a Resend API key, and configure a verified sender with the server-only `QURA_EMAIL_FROM` variable for real elections. For testing, `RESEND_TEST_MODE=true` uses Resend's `onboarding@resend.dev` sender, which Resend restricts to your verified account email. Verification codes are stored as keyed hashes, expire after 10 minutes, and are rate-limited.
- To enable student-system push sync, set `QURA_STUDENT_SYNC_KEY` to a random secret of at least 32 bytes on the QURA server and configure the same secret in the student system's server environment. Never expose it in browser code. Send `POST /api/integrations/elections/{electionId}/eligible-voters` with `Authorization: Bearer <key>`, `Content-Type: application/json`, and either `{"registrationNumber":"...","email":"..."}` or `{"voters":[{"registrationNumber":"...","email":"..."}]}`. Requests can contain up to 5,000 voters and are accepted only for an existing draft election. Do not send the Supabase service-role key to the student system.
- Public poll sessions are anonymous browser cookies and are a deterrent, not proof of identity. Database-backed per-IP rate limits apply. Configure the hosting proxy so `x-forwarded-for` is set by a trusted proxy; do not expose spoofable forwarded headers from untrusted clients.
- Formal eligibility and invitation tokens are stored as hashes; a token is single-use and bound to the imported election eligibility entry. Registration numbers and eligibility files are sensitive; use an approved private channel for importing them.
- RLS denies direct public access to management, eligibility, participation, ballots, and settings tables. Server routes use the Supabase service-role key; protect that key and hosting environment.
- Candidate photos are public because they appear on public ballots. Only the server can upload them.
- `secret_ballots` defaults on and the schema always stores participation separately from ballot selections. Do not correlate provider logs or grant direct database access to staff who should not see both records.
- Never commit `.env.local`, voter eligibility files, invitation exports, real credentials, or real voter data.

## Checks

- `npm run lint`
- `npm run build`
