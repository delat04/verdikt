# Verdikt — AI-verified escrow for freelancers

![Verdikt](thumbnail/verdikt-thumbnail.png)

Freelancers get stiffed. Clients get bad work. **Verdikt** turns a contract into testable rules that both sides sign, holds the money with PayPal, and lets an AI agent check the delivered work. Proven → the money is released. Not yet → it stays held, and both sides see exactly why.

> Built for the PayPal "Build What's Next with PayPal and AI" hackathon. Everything runs on the **PayPal sandbox** — no real money moves.

## How it works

1. **Terms** — client and freelancer describe the work; the agent turns it into checkable acceptance criteria (visual, functional, code, performance). Both sides approve them.
2. **Escrow** — the client funds a milestone. Verdikt creates a PayPal order with `intent=AUTHORIZE`, so the funds are held, not charged.
3. **Verify** — the freelancer submits a repo + live URL. The agent opens the site in a headless browser, takes screenshots, runs click-through checks, reads the code, and scores each criterion with evidence.
4. **Release or hold** — pass → the authorization is **captured** (paid). Fail → the hold stays, with a per-criterion report; the freelancer fixes and resubmits. A refund **voids** the hold so the client is never charged.

## Stack

| Layer | Tech |
|---|---|
| Web | Vue 3, Vite, Tailwind v4, Pinia, Inter Tight + JetBrains Mono |
| Auth / DB / realtime | Supabase (Postgres + row-level security) |
| API + agent | Node 22+, Fastify |
| Payments | PayPal Orders v2 — authorize → capture / void, webhooks |
| AI | Claude (criteria drafting, vision checks, code review, verdicts) |

## Run it locally

**Prerequisites:** Node 22.9+, a [PayPal developer](https://developer.paypal.com) sandbox app, a [Supabase](https://supabase.com) project, an [Anthropic](https://console.anthropic.com) API key.

### 1. Database

In the Supabase dashboard → SQL editor, run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
Under Authentication → URL configuration, add `http://localhost:5173/auth/callback` as a redirect URL.

### 2. API server

```bash
cd server
cp .env.example .env   # fill in PayPal, Supabase and Anthropic keys
npm install
npm run dev            # http://localhost:4100/health
```

### 3. Web app

```bash
cd web
cp .env.example .env   # Supabase URL + anon key, PayPal client id
npm install
npm run dev            # http://localhost:5173
```

### PayPal escrow smoke test

Proves the money flow end to end against the sandbox, without the UI:

```bash
cd server
npm run paypal:smoke            # create → approve → authorize (hold) → capture (release)
npm run paypal:smoke -- --void  # … → void (refund)
```

It prints an approval link — open it and log in with your **sandbox personal** account (developer.paypal.com → Sandbox → Accounts).

## Project layout

```
server/   Fastify API — contracts, escrow (PayPal), webhooks
web/      Vue app — dashboard, contract creation
supabase/ SQL schema + RLS policies
```

## License

[MIT](LICENSE)
