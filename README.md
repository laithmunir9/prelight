# Prelight

AI-powered public speaking practice for simulated rooms and scenario-based feedback.

## Overview

Prelight is a Node.js and browser application for practicing spoken or written communication in simulated scenarios, including interviews, speeches, pitches, exam vivas, and casual speaking practice. It pairs scenario templates with role-specific personas so a learner can practice against a room that responds.

## How It Works

1. A user selects or describes a practice scenario.
2. The server selects the relevant practice template and persona roster.
3. The user practices through speech or text.
4. OpenAI-generated responses simulate the room.
5. The session is evaluated with transcript-derived signals.
6. Feedback, history, trends, and milestones are surfaced after practice.

## Architecture

- `server.js` runs an Express application and serves the browser frontend from `public/`.
- `practiceTemplates.js` defines scenario templates and persona roles.
- `practiceClassifier.js` extracts keyword and delivery signals used for responder selection and review summaries.
- `openaiChatClient.js` handles JSON chat responses for scenario inference, role-play replies, and end-of-session review.
- `openaiTranscriptionClient.js` transcribes microphone recordings through the OpenAI audio transcription API.
- `openaiSpeechClient.js` generates persona voice playback through the OpenAI TTS API.
- `transcriptAsrCorrections.js` applies targeted corrections for known speech recognition failures.
- `curtainCall.js` validates that highlighted quotes are copied from the transcript.
- `public/sessionProgress.js` computes local trend rows and milestone progress in the browser.
- Supabase stores deployed student accounts, session tokens, practice state, usage counters, and bounded practice-session records when `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are configured.
- Local development falls back to `data/students.json` and `data/practice-sessions.json`, which are ignored by Git.

## Evaluation and Progress

The review flow combines AI feedback with measurable signals instead of relying only on generated prose. Delivery and engagement summaries include turn count, word count, hedging, rambling, question rate, and measured words per minute when microphone timing is available.

Progress milestones are evidence-based. Most milestones require enough turns and words to avoid awarding progress from trivial sessions. The curtain call feature also validates that any quoted "best line" appears verbatim in the student's transcript and drops the quote when it cannot be verified.

## Running Locally

Requirements:

- Node.js 18 or newer
- An OpenAI API key for AI replies, transcription, and TTS

Setup:

```bash
npm install
cp .env.example .env
```

Edit `.env` and set `OPENAI_API_KEY`. The server also supports optional model, audio, and rate-limit environment variables.

For deployed persistence, set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in Render. The existing `students` table is created by the storage migration.

Apply `supabase/migrations/20260829000001_create_practice_sessions.sql` manually before enabling deployed session history. The Express server uses the server-only Supabase key and still checks the authenticated student's ownership on every session request.

The public GitHub Actions workflow in `.github/workflows/supabase-keepalive.yml` sends a harmless Supabase query every four days. Apply the keepalive migration to the hosted project, then add `SUPABASE_URL` and either `SUPABASE_PUBLISHABLE_KEY` (current) or `SUPABASE_ANON_KEY` (legacy) as repository Actions secrets before enabling it. The workflow prints the Supabase response when the RPC is missing or inaccessible.

Start the app:

```bash
npm start
```

By default the app runs at `http://localhost:3848`.

## Testing

Run the full test suite:

```bash
npm test
```

The tests cover scenario templates, classifier signals, transcript corrections, microphone transcript accumulation, curtain call validation, session progress milestones, local authentication behavior, and bounded local session persistence, including route-level session-token checks.

## Security and Limitations

Prelight currently uses lightweight local/demo authentication and JSON-file persistence. New passwords are stored as salted scrypt hashes, login returns an opaque session token, and protected routes accept only that token. A temporary legacy-login path migrates old plaintext records to scrypt hashes after a successful login.

This is not production authentication. A deployed multi-user version should move sessions, users, and practice history to a managed database, add secure cookie-based session handling, CSRF protection where needed, password reset flows, and operational monitoring.

Never commit `.env` or `data/students.json`.

## Project Background

Prelight originated during the MBZUAI Hybrid Intelligence Bootcamp and was continued independently afterward. Historical hackathon materials are kept in `docs/hackathon/` for provenance.
