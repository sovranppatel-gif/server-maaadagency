# Maa Ad Agency — Backend API

Node + Express + MongoDB backend for the Master Admin dashboard, including
WhatsApp Business Cloud API intake, work assignment and the review workflow.

```
CLIENT → WhatsApp → Cloud API webhook → intake bot → Lead
      → Master Admin assigns → Employee works → submits
      → Master Admin approves / requests changes → Completed
```

## Stack

| Concern        | Choice                                          |
| -------------- | ----------------------------------------------- |
| Runtime        | Node.js 20+ (ES modules, native `fetch`)        |
| Framework      | Express 5                                       |
| Database       | MongoDB + Mongoose 8                            |
| Auth           | JWT access + refresh tokens, bcrypt, RBAC       |
| Validation     | Zod (every body / params / query)               |
| Realtime       | Socket.IO                                       |
| Messaging      | WhatsApp Business Cloud API (Graph v21)         |

## Getting started

```bash
cd server
npm install
cp .env.example .env          # then fill in the values
npm run seed:fresh            # load demo data
npm run dev                   # http://localhost:5000
```

Verify: `curl http://localhost:5000/api/health`

## Deploy the API to Vercel

Create a separate Vercel project for this folder and set its **Root Directory**
to `server`. Vercel uses the root `server.js` entrypoint; the local
long-running process in `src/server.js` remains available for development.

Add these environment variables in the Vercel project for Preview and
Production:

```text
NODE_ENV=production
MONGODB_URI=<your MongoDB Atlas connection string>
JWT_ACCESS_SECRET=<random value, at least 16 characters>
JWT_REFRESH_SECRET=<different random value, at least 16 characters>
CLIENT_ORIGIN=https://<your-frontend-domain>
```

Add the WhatsApp and seed variables as needed. The API is available at
`https://<server-project>.vercel.app/api/health`.

Vercel Functions are stateless. Socket.IO requires a persistent server and is
not started by the Vercel entrypoint. The current upload route uses temporary
`/tmp` storage on Vercel, so files are not durable; use Vercel Blob, S3, or
another object store before relying on production uploads.

Seeded logins (change them before any real deployment):

| Role         | Email                           | Password         |
| ------------ | ------------------------------- | ---------------- |
| MASTER_ADMIN | `admin@maaadagency.com`         | `Admin@12345`    |
| EMPLOYEE     | `rahul.sharma@maaadagency.com`  | `Employee@12345` |

## Project layout

```
src/
  config/       env validation, database, logger, socket.io
  models/       Mongoose schemas (+ shared plugins)
  middleware/   auth, validation, sanitising, uploads, rate limits, errors
  controllers/  request handling only
  services/     business logic: WhatsApp, bot flow, stats, notifications
  routes/       routing + per-route authorisation
  validators/   Zod schemas
  seed/         demo data, seeder, WhatsApp simulator
```

## API

Every response uses one envelope:

```jsonc
// success
{ "success": true, "data": … , "meta": { "page": 1, "total": 42 } }
// failure
{ "success": false, "error": { "message": "…", "details": [ … ] } }
```

List endpoints accept `?page`, `?limit`, `?sort`, `?search` plus their own filters.
Records can be fetched by ObjectId **or** by business code (`/api/leads/LD-1042`).

| Method   | Endpoint                                  | Role          |
| -------- | ----------------------------------------- | ------------- |
| `POST`   | `/api/auth/login`                         | public        |
| `POST`   | `/api/auth/refresh`                       | public        |
| `GET`    | `/api/auth/me`                            | any           |
| `POST`   | `/api/auth/register`                      | MASTER_ADMIN  |
| `GET`    | `/api/leads`, `/api/leads/:id`            | any           |
| `POST`   | `/api/leads/:id/assign`                   | ADMIN         |
| `DELETE` | `/api/leads/:id`                          | ADMIN         |
| `GET`    | `/api/works`, `/api/works/stats`          | any           |
| `POST`   | `/api/works`, `/api/works/:id/assign`     | ADMIN         |
| `PATCH`  | `/api/works/:id/progress`                 | any           |
| `POST`   | `/api/works/:id/submit`                   | any           |
| `POST`   | `/api/works/:id/approve`                  | ADMIN         |
| `POST`   | `/api/works/:id/request-changes`          | ADMIN         |
| `POST`   | `/api/works/:id/complete`                 | ADMIN         |
| `GET`    | `/api/employees`, `/api/clients`          | any           |
| `GET`    | `/api/projects`, `/api/services`          | any           |
| `GET`    | `/api/notifications`                      | any           |
| `GET`    | `/api/files`, `POST /api/files`           | any / ADMIN   |
| `GET`    | `/api/whatsapp/conversations`             | any           |
| `POST`   | `/api/whatsapp/send`                      | any           |
| `GET`    | `/api/whatsapp/bot-flow`                  | any           |
| `GET`    | `/api/analytics`, `/api/analytics/dashboard` | ADMIN      |
| `GET`    | `/api/settings/whatsapp`                  | MASTER_ADMIN  |
| `GET`    | `/api/health`                             | public        |

`MASTER_ADMIN` passes every role check.

### Work status machine

Transitions are enforced server-side; anything else returns `400`.

```
UNASSIGNED → ASSIGNED → IN_PROGRESS → SUBMITTED → APPROVED → COMPLETED
                                          ↓            ↑
                                  CHANGES_REQUESTED ───┘
```

## WhatsApp integration

1. Point the Meta webhook at `https://<your-domain>/api/whatsapp/webhook`.
2. Use `WHATSAPP_VERIFY_TOKEN` as the verify token (the `GET` handler answers the handshake).
3. Set `WHATSAPP_APP_SECRET` — every `POST` is checked against `X-Hub-Signature-256`.
4. Set `WHATSAPP_DRY_RUN=false` once credentials are in place.

While `WHATSAPP_DRY_RUN=true` (the default) outbound messages are logged
instead of sent, so the whole product runs locally without a Meta account.

Replay a full conversation without WhatsApp:

```bash
node --env-file=.env src/seed/simulate-whatsapp.js 919000000123
```

The intake bot walks the `BotStep` collection, stores answers on the
conversation and creates a `Lead` when the flow ends. An agent replying from
the inbox automatically pauses the bot for that thread.

**Credentials are never stored in the database or returned by the API.** They
are read from environment variables; `GET /api/settings/whatsapp` returns
masked values and a configuration status only.

## Realtime events

Connect with Socket.IO (`auth: { token }`) and listen for:

`message:new` · `message:status` · `conversation:updated` · `conversation:read`
· `lead:new` · `lead:updated` · `work:new` · `work:updated` · `notification:new`

## Connecting the dashboard

The frontend already isolates data access in `frontend/src/lib/api/*`. Point it
at this server by replacing the mock bodies with `fetch` calls:

```ts
// frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

```ts
export async function getLeads(filters: LeadFilters = {}): Promise<Lead[]> {
  const qs = new URLSearchParams(filters as Record<string, string>);
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/leads?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  return json.data;
}
```

Response shapes already match the dashboard's TypeScript types: `_id` is
serialised as `id`, dates as ISO strings, and business codes (`LD-1042`) work
as route parameters.

## Operational notes

- **Security**: helmet, CORS allowlist, rate limiting (tighter on `/auth`),
  Mongo operator stripping, bcrypt (12 rounds), upload MIME allowlist.
- **Counters** (`activeWorks`, `totalLeads`, …) are denormalised for fast list
  rendering and always recomputed in `services/stats.service.js`, so they cannot drift.
- **Concurrency**: inbound webhooks are serialised per conversation
  (`utils/mutex.js`) so simultaneous deliveries cannot lose bot state or
  reorder a thread. Running more than one instance requires a shared lock (e.g. Redis).
- **Shutdown** is graceful: in-flight requests drain before the database closes.
