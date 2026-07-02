# BizMtaani

A marketplace platform connecting local businesses in Nairobi with customers — supporting product listings, M-Pesa payments, image uploads, and push notifications.

## Run & Operate

- `PORT=8080 pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `PORT=24184 BASE_PATH=/ pnpm --filter @workspace/bizmtaani run dev` — run the frontend (port 24184)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (port 8080 in dev and production)
- DB: PostgreSQL + Drizzle ORM
- Frontend: React + Vite, served as static site
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/` — Express API server (routes, middlewares, DB access)
- `artifacts/api-server/src/routes/health.ts` — `/api/healthz` endpoint
- `artifacts/bizmtaani/src/` — React frontend
- `artifacts/bizmtaani/src/lib/apiUrl.ts` — API base URL helper (reads `VITE_API_URL`)
- `lib/db/` — Drizzle ORM schema and migrations
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)

## Architecture decisions

- **Contract-first API**: OpenAPI spec lives in `lib/api-spec/openapi.yaml`; React Query hooks and Zod schemas are generated from it via Orval. Never edit generated files in `lib/api-client-react/`.
- **Relative API URLs in Replit**: `VITE_API_URL` defaults to empty string; Replit's proxy routes `/api/*` to the API server in both dev and production, so no absolute URL is needed within Replit.
- **VITE_API_URL for Vercel**: When the frontend is deployed separately to Vercel, set `VITE_API_URL=https://<your-repl>.replit.app` in Vercel → Settings → Environment Variables so the Vite build bakes in the correct absolute API base.
- **CORS open**: `cors()` is called with no origin restrictions in `app.ts`. Tighten to specific origins once the Vercel frontend URL is known.
- **PORT required**: The API server throws on startup if `PORT` is not set. Always pass `PORT=8080` when running locally.

## Deployment

### API server (Replit Deployments)

`artifacts/api-server/.replit-artifact/artifact.toml` has the full production config:

- **Build**: `pnpm --filter @workspace/api-server run build`
- **Run**: `node --enable-source-maps artifacts/api-server/dist/index.mjs`
- **Env**: `PORT=8080`, `NODE_ENV=production`
- **Health check**: `GET /api/healthz` → `{"status":"ok"}`

Click **Publish** in the main Replit agent to deploy. The API server will be live at `https://<repl>.replit.app/api`.

### Frontend (Replit Deployments)

`artifacts/bizmtaani/.replit-artifact/artifact.toml` serves the Vite build as a static site. No `VITE_API_URL` needed — the platform proxy routes `/api` requests to the API server.

### Frontend on Vercel + API on Replit

After the API server is deployed on Replit:

1. Copy the production URL (e.g. `https://bizmtaani.morganmusibi.replit.app`)
2. In Vercel → your bizmtaani project → Settings → Environment Variables, add:
   `VITE_API_URL = https://bizmtaani.morganmusibi.replit.app`
3. Redeploy on Vercel so the Vite build bakes in the new base URL

Alternatively, set `VITE_API_URL` as a Replit secret; it will be injected automatically into the Vite build during Replit production deployments.

## Product

BizMtaani helps small Nairobi businesses list their products and services online, accept M-Pesa STK push payments, upload product images to Cloudinary, and receive push notifications for new orders.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `PORT` must be set explicitly; the API server throws immediately if it is missing.
- `VITE_API_URL` is a **build-time** Vite env var — changing it requires a rebuild and redeploy of the frontend.
- Dev workflows: `PORT=8080 pnpm --filter @workspace/api-server run dev` and `PORT=24184 BASE_PATH=/ pnpm --filter @workspace/bizmtaani run dev`.
- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
