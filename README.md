# Prelight

A navy speaking-practice workspace: **record → inspect → record again → compare**.

## Current product

- A short guided tutorial starts with a fresh pitch workspace until completed. Finishing returns home and replaces the tutorial button with Continue practicing. Completion is remembered on this browser.
- Microphone audio is analyzed in the browser. Studio saves delivery measurements and take history in LocalStorage; it does not upload or retain the audio.
- Compare duration, silence, long pauses, pitch variation, and overlaid traces.
- Optional **Get feedback** sends only four numeric measurements from each take to OpenAI. It returns one measured observation and one delivery exercise, not a score or assessment of what the speaker said.
- Recording and comparison are unlimited. Each signed-in account gets **five AI feedback attempts per UTC day**. Completed feedback for the same pair is cached; opening it again does not use another attempt. Failed attempts count because a provider request may already have incurred a charge.

## Run locally

Node.js 18 or newer:

```sh
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3848`. Recording and comparison work without an API key. Feedback requires `OPENAI_API_KEY`, `SUPABASE_URL`, and a server-only `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`). Never expose these secrets in frontend code or commit `.env`.

## Production configuration

1. Apply the SQL migrations in `supabase/migrations`, including `20260915203249_studio_feedback_quota.sql`.
2. Configure the existing Render service with OpenAI and Supabase secrets. Supabase must refer to the same database as the deployed accounts.
3. Set `LEGACY_PRACTICE_ENABLED=false` to disable the retired paid role-play, transcription, and speech endpoints. The active Studio flow does not use them.
4. `STUDIO_FEEDBACK_ENABLED=false` disables feedback without affecting local recording or comparison. Otherwise feedback is available when both providers are configured.
5. Leave `PRELIGHT_INVITE_CODE` and `GREEN_ROOM_INVITE_CODE` unset for open signup. Existing accounts must be preserved when changing storage configuration; do not switch a live local-data service to an empty database without migration.

Git pushes to the deployed branch trigger Render's existing auto-deploy. `render.yaml` describes the service, but `sync: false` fields do not populate secrets on existing services.

## Quota and access control

Express verifies opaque account tokens. Only that verified account ID reaches the database quota functions. Supabase Auth is not used. RLS is enabled on accounts, historical practice sessions, and feedback requests; `anon` and `authenticated` have no table or quota-function privileges. The server-only service role is the intended access path. The advisor's informational “RLS enabled, no policy” notices are intentional for this deny-client-access design.

A PostgreSQL transaction lock serializes reservations for each account across requests and server instances. Reservations happen before contacting OpenAI and are unique to an account and normalized pair of takes. A failed or interrupted request keeps its reservation, preventing retries from generating unbounded charges. Pending reservations expire to failed after two minutes. The provider request has a 20-second timeout, no automatic retries, and at most 300 output tokens using `gpt-4.1-mini`.

The daily quota is **per account**, not a total spending cap. Multiple accounts and growing usage can increase costs. Configure provider billing limits and monitor usage before a broad campaign. Authentication currently has no email verification or password-reset flow. Accounts use salted scrypt passwords and opaque bearer tokens stored in browser LocalStorage. Local fallback account data is unsuitable for Render's ephemeral filesystem; production must use Supabase.

## Verification

```sh
npm test
git diff --check
```

`studioFeedback.test.js` tests input validation, authenticated ownership, cached/pending/limited states, provider failures, bounded requests, and fail-closed behavior. `supabase/tests/studio_feedback_quota.sql` tests the real database limit, account isolation, duplicate handling, daily reset, RLS, and grants inside a rolled-back transaction. Existing frontend tests cover zero, one, two, and several takes plus tutorial restart behavior.

Historical scenario/role-play modules and tests remain in the repository for provenance. They are not the current Studio product. Hackathon materials are in `docs/hackathon/`.
