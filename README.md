# Family Companion

Family Companion is a private family coordination app built with React, TypeScript, Express, and SQLite. It turns the original UI prototype into a persisted workflow:

**Bond Map → AI reconnection plan → reviewed gathering → private RSVP links → completed gathering → memory → family points**

## What works now

- Email/password registration, sign-in, HttpOnly cookie sessions, and sign-out.
- Persistent family members and normalized parent, spouse, sibling, guardian, and relative relationships.
- Atomic member creation with multiple initial relationships, including two-parent child links.
- Role-aware family administration and private-profile redaction for ordinary members.
- Consent-based locations with expiry and revocation. Exact coordinates are never returned by an API or sent to AI; non-exact browser coordinates are quantized before storage.
- A controlled Gemini assistant that proposes family-member and relationship changes, reconnection plans, gathering drafts, private invitation links, verified gathering completion, written memories, memory deletion, and plan-status changes. Server validation and explicit confirmation are required before any write.
- Persisted reconnection plans that can prefill an editable gathering draft. Plans never create gatherings or contact people automatically.
- Persisted gatherings, reviewed invitation preparation, WhatsApp/copy links, public capability-token RSVP pages, and administrator-verified completion.
- Private written/photo/video/audio memories attached to completed gatherings, with per-memory visibility and permanent deletion.
- A persisted points ledger with idempotent awards. Reward offers are clearly labelled demonstrations and cannot be redeemed as real vouchers.
- A server-provided sample UAE activity catalog. Venue availability and accessibility are not claimed as live or verified.

## Important boundaries

- Gemini is optional. Without `GEMINI_API_KEY`, agent requests return an honest `503`; the rest of the app continues to work.
- The exact reviewable instruction sent to Gemini before every turn is [`server/agentPrompt.ts`](./server/agentPrompt.ts). The server still validates the returned action independently; editing the prompt alone cannot bypass permissions or confirmation.
- Every family role can ask the assistant, but each proposed action is checked against the same role and ownership rules as the normal app controls. Every external AI request requires a fresh disclosure checkbox. Gemini receives the current request, up to 20 recent agent messages, family name, current server date/time and timezone, display names and internal IDs, relationships, consent-visible coarse location context, authorized gathering/RSVP metadata, AI-consented memory labels, visible plan status, factual engagement aggregates, reward totals, and sample activity metadata. Database-derived context excludes contacts, profile notes, memory content/media, exact coordinates, and invitation tokens/URLs; anything the user types into the current or recent conversation is included in that conversation text.
- Agent prompts and replies expire after 30 days and the current conversation can be permanently deleted sooner from the Assistant screen.
- Invitation preparation creates shareable links only. It does not send messages automatically. Public RSVP links close when a gathering is completed/cancelled or 24 hours after its start.
- Browser location runs only after a user action. There is no background tracking or live map provider.
- Calendar sync, reverse geocoding, partner rewards, notifications, health data, and automatic WhatsApp delivery are not connected.

## Run locally

Prerequisite: Node.js 20 or newer.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open [http://localhost:4000](http://localhost:4000), register an account, and create the first family space. The development server binds to `127.0.0.1` by default.

To enable the assistant, put a server-side Gemini key in `.env`:

```dotenv
GEMINI_API_KEY="your-key"
```

Never use a `VITE_` prefix for secrets or commit `.env`.

## Validate and build

```powershell
npm run lint
npm run test:run
npm run build
npm audit
```

`npm run lint` performs TypeScript validation. Tests cover auth, family isolation and privacy, atomic graph writes, location consent, controlled agent actions, gatherings/RSVPs, media validation and quotas, reconnection-plan handoff, and frontend adapters.

For production, set an HTTPS `PUBLIC_APP_URL`, build, and run behind a trusted TLS reverse proxy:

```powershell
npm run build
npm start
```

`npm start` enables production security behavior and serves `dist/`. The server binds to `127.0.0.1` unless `HOST` is deliberately configured.
Production trusts exactly one reverse-proxy hop by default; configure `TRUST_PROXY_HOPS` to the exact topology rather than enabling unrestricted proxy trust.

## Storage and configuration

SQLite data and private uploads default to `data/`, which is ignored by Git. See [.env.example](./.env.example) for database/upload paths, media quotas, host/port, public invitation origin, Gemini model, and provider timeout.

This is an MVP, not a production-complete service. Before a public launch, add account recovery, family invite/join onboarding, database backups, object storage with malware scanning, observability, a formal family-wide AI-consent model, and deployment-specific retention policies.
