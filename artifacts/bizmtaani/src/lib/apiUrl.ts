/**
 * Base URL for the Backend API.
 * 
 * To connect to Firebase Cloud Functions:
 * 1. Deploy your backend to Firebase.
 * 2. Set VITE_API_URL in Vercel → Settings → Environment Variables to:
 *    https://us-central1-<YOUR_PROJECT_ID>.cloudfunctions.net
 * 
 * Usage: `${apiBase()}/api/your-endpoint`
 */
export function apiBase(): string {
  // Returns the VITE_API_URL from Vercel, or empty string if not set
  return (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
}

