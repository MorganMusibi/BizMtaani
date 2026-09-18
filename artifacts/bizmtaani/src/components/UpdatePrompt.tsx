// No-op: update handling now lives in main.tsx (deferred until the
// app is backgrounded, via registerSW's onNeedRefresh + visibilitychange).
export function UpdatePrompt() {
  return null;
}
