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

### One-command Windows setup

From the extracted project folder, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\Setup-And-Run.ps1
```

The script installs Node.js LTS through `winget` when Node.js is missing, installs the project dependencies, creates `.env` when necessary, starts the app, and opens [http://127.0.0.1:4000/](http://127.0.0.1:4000/). If `.env` already contains a Gemini key, the script uses it without displaying it; otherwise, it securely prompts for one.

The AI Helper works only after each developer adds a server-side Gemini API key to the project-root `.env` file. Short setup:

1. Sign in to the [Google AI Studio API Keys page](https://aistudio.google.com/app/apikey).
2. Copy the key shown there, or choose **Create API key** and then copy the new key.
3. In this repository's root, run `Copy-Item .env.example .env` if `.env` does not exist yet.
4. Open `.env` and replace only the placeholder in this line:

```dotenv
GEMINI_API_KEY="your-key"
```

5. Save `.env` and restart `npm run dev` so the server reads the key.

Keep the key server-side: never use a `VITE_` prefix, paste it into browser code, share it, or commit `.env`. The repository ignores `.env` and tracks only the placeholder `.env.example`.

Gemini turns default to a 60-second limit. If a valid key works but a slow request times out, set `AGENT_PROVIDER_TIMEOUT_MS="120000"` in `.env` and restart the server; `120000` is the supported maximum.

### Test the AI gathering planner manually

1. Start the app with `npm run dev`, sign in, and make sure your account is linked to its own profile in the Bond Map.
2. Add visible parent and sibling relationships, for example Dad, Mom, and Anas as Ahmad's parents and sibling.
3. Open **AI Helper**, enable the per-request Gemini consent checkbox, and send: `I want to go to Golden Park with my parents and sibling.`
4. Confirm that the helper asks for the missing date and Dubai time and does not open an incomplete form.
5. Reply with a future value such as `December 15, 2099 at 5:00 PM.`
6. Confirm that the editable form opens in the chat with Golden Park, Outdoor activity, Dad, Mom, and Anas selected, a neutral title and purpose, and empty notes.
7. Edit each field, add or remove invitees, and switch the sharing option. **Cancel** and **Review** must not create anything.
8. On the review page, choose **Create draft** when no invitees are selected, or **Create & prepare links** when they are. Double-clicking must still create only one gathering.
9. Confirm that links appear only after creation and that WhatsApp opens only when you explicitly press **Open WhatsApp**; the app never sends an invitation automatically.

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
