/**
 * Base URL for the Express API server.
 *
 * Development (Replit): VITE_API_URL is not set → empty string → relative
 *   URLs like "/api/upload" route through Replit's built-in proxy.
 *
 * Production (Vercel): set VITE_API_URL to the deployed API server URL in
 *   Vercel → Environment Variables, e.g.:
 *   VITE_API_URL=https://bizmtaani-api.replit.app
 *
 * Usage: `${apiBase()}/api/upload`
 */
export function apiBase(): string {
  return (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
}
