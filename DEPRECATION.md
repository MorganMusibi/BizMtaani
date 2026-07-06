# API Server Deprecation Notice

**Status**: DEPRECATED (effective 2026-07-06)

This file documents the deprecation of `artifacts/api-server/` and the migration to Firebase Cloud Functions.

## Why?

The project had two conflicting backend implementations:
- **Firebase Cloud Functions** — handles payments and image uploads (used by frontend on Vercel)
- **Express API Server** — duplicate routes and logic (unused on Vercel, causes confusion)

This dual implementation caused:
1. ❌ M-Pesa payment failures on Vercel
2. ❌ Image upload failures with "internal error"
3. ❌ Confusing codebase maintenance
4. ❌ Inconsistent error handling

## Solution

All backend logic has been consolidated into **Firebase Cloud Functions** (`functions/src/`).

## Migration Timeline

### Phase 1: Non-Breaking Migration (DONE ✅)
- ✅ Firebase Cloud Functions enhanced with cleanup and notifications
- ✅ Frontend already uses Firebase functions exclusively
- ✅ API Server routes moved to Firebase

### Phase 2: Deprecation (IN PROGRESS)
- `artifacts/api-server/` marked as deprecated but kept functional
- Replit deployments can still run old Express server (local dev only)
- Documentation updated

### Phase 3: Removal (FUTURE)
- Once all Replit instances updated
- Once no lingering API server dependencies exist
- Directory can be removed entirely

## What Changed?

### Routes Migrated to Firebase

| Route | Old Location | New Location | Status |
|-------|-------------|-------------|--------|
| `POST /api/upload` | Express | `getCloudinarySignature` | ✅ Active |
| `POST /api/mpesa/initiate` | Express | `initiateMpesaPayment` | ✅ Active |
| `POST /api/mpesa/callback` | Express | `mpesaCallback` | ✅ Active |
| `POST /api/cleanup/run` | Express | `scheduledCleanup` | ✅ Active |
| `POST /api/notify` | Express | `sendNotification` | ⏳ In Firebase |
| `POST /api/orders` | Express | Firestore Rules | ✅ Active |

### Firestore Security Rules

Orders, notifications, and other operations are now secured via `firestore.rules`:

```
match /orders/{orderId} {
  allow read: if isAuth() && (participates);
  allow create: if isAuth() && request.resource.data.buyerId == request.auth.uid;
  allow update: if isAuth() && resource.data.sellerId == request.auth.uid;
}
```

**No API endpoint needed** — Firestore rules enforce security.

## For Developers

### Local Development (still works)

To test locally with Express API server:

```bash
PORT=8080 pnpm --filter @workspace/api-server run dev
```

But the **frontend on Vercel** calls **Firebase functions** directly.

### New Development

**Use Firebase Cloud Functions for all new features:**

```typescript
// functions/src/index.ts
import { onCall } from "firebase-functions/v2/https";

export const myNewFunction = onCall(async (request) => {
  // Your logic here
  return result;
});
```

## Firestore Rules (replaces API server authorization)

All authorization now happens via `firestore.rules`:

```
function isOwner(uid) { return request.auth.uid == uid; }

match /orders/{orderId} {
  allow read: if isAuth() && 
    (request.auth.uid == resource.data.buyerId || 
     request.auth.uid == resource.data.sellerId);
  allow create: if isAuth() && request.resource.data.buyerId == request.auth.uid;
}
```

## What You Need to Do

### Step 1: Set Firebase Secrets (One-Time)

```bash
firebase functions:secrets:set CLOUDINARY_API_KEY "your-key"
firebase functions:secrets:set CLOUDINARY_API_SECRET "your-secret"
firebase functions:secrets:set CLOUDINARY_CLOUD_NAME "your-cloud-name"
firebase functions:secrets:set MPESA_CONSUMER_KEY "your-key"
firebase functions:secrets:set MPESA_CONSUMER_SECRET "your-secret"
firebase functions:secrets:set MPESA_PASSKEY "your-passkey"
```

### Step 2: Verify firebase.json

```json
{
  "functions": [{
    "source": "functions",
    "environmentVariables": {
      "MPESA_ENVIRONMENT": "sandbox",
      "MPESA_SHORTCODE": "174379"
    }
  }]
}
```

### Step 3: Deploy

```bash
firebase deploy --only functions
```

### Step 4: Update Vercel (if needed)

No VITE_API_URL needed — frontend calls Firebase functions directly.

## Testing

### Test Image Upload (Firebase)
```typescript
const uploadImage = require("./artifacts/bizmtaani/src/lib/uploadImage").uploadImage;
const url = await uploadImage(file, "product");
```

### Test M-Pesa Payment (Firebase)
```typescript
const initiateStkPush = require("./artifacts/bizmtaani/src/lib/mpesa").initiateStkPush;
const result = await initiateStkPush({ phone, plan: "basic", productId });
```

### Test Orders (Firestore Rules)
```typescript
// Create order directly via Firestore SDK
const orderRef = await addDoc(collection(db, "orders"), {
  buyerId: user.uid,
  sellerId: seller.uid,
  amount: 500,
  // ...
});
```

## FAQ

**Q: Why not delete the API server immediately?**
A: Gradual migration ensures no broken deployments. Once all instances updated, deletion is safe.

**Q: Will my existing data be lost?**
A: No. All data stays in Firestore. Only the backend transport layer changes (Express → Firebase functions).

**Q: What if I need to run the API server locally?**
A: You can, but frontend on Vercel won't use it. Only useful for local testing. Use Firebase emulator instead:
```bash
firebase emulators:start
```

**Q: How do I add new backend features?**
A: Create a new Firebase Cloud Function in `functions/src/index.ts`:
```typescript
export const myFeature = onCall(async (request) => {
  // Your code
});
```

**Q: Is this a breaking change?**
A: No. Frontend behavior unchanged. Backend logic identical. Only the infrastructure changes.

---

## Timeline

- **2026-07-06**: Deprecation notice added
- **2026-08-06**: API server can be removed from main branch
- **2026-09-06**: Directory deleted from repository

---

For questions, see: `functions/src/index.ts` and `firestore.rules`
