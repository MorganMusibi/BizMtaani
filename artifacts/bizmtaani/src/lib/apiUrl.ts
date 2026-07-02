/**
 * Base URL for the Express API server.
 *
 * Development (Replit): VITE_API_URL is not set → empty string → relative
 *   URLs like "/api/upload" route through Replit's built-in proxy.
 *
 * Production (Replit Deployments): Both the frontend static site and the API
 *   server are deployed together under the same .replit.app domain. The
 *   platform proxy routes /api/* to the API server, so relative URLs still
 *   work and VITE_API_URL does not need to be set.
 *
 * Production (Vercel frontend + Replit API): After publishing the API server
 *   on Replit, set VITE_API_URL in the Vercel project → Settings →
 *   Environment Variables to the Replit production URL, e.g.:
 *   VITE_API_URL=https://<your-repl>.replit.app
 *   Replit secrets named VITE_API_URL are also injected into Vite builds
 *   automatically during Replit production deployments.
 *
 * Usage: `${apiBase()}/api/upload`
 */
export function apiBase(): string {
  return (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
}
