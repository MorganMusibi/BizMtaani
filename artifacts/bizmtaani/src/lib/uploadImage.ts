import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/lib/firebase";
import { appCheck } from "@/lib/firebase";
import { getToken } from "firebase/app-check";

export type ImageUploadType = "avatar" | "product" | "community";

interface CloudinarySignatureResult {
  signature: string;
  timestamp: number;
  folder: string;
  apiKey: string;
  cloudName: string;
  allowedFormats: string;
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000); // 60s per attempt
      try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        return res;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 800 * (i + 1))); // 800ms, 1.6s
      }
    }
  }
  throw lastErr;
}

/**
 * Compress an image client-side before it ever reaches Cloudinary.
 * Cuts storage credits at upload time, and bandwidth credits every
 * single time the image is viewed afterwards.
 *
 * Falls back to the original file if compression fails for any
 * reason (e.g. unsupported format) — never blocks a user's upload.
 */
export async function compressImageBeforeUpload(file: File, type: ImageUploadType): Promise<File> {
  if (file.size < 150 * 1024) return file;

  let workingFile = file;

  if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
    try {
      const { default: heic2any } = await import("https://esm.sh/heic2any@0.0.4");
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      workingFile = new File(
        [converted as Blob],
        file.name.replace(/\.hei[cf]$/i, ".jpg"),
        { type: "image/jpeg" }
      );
    } catch (error) {
      console.warn("HEIC conversion failed, will try compressing original:", error);
    }
  }

  const options =
    type === "avatar"
      ? { maxSizeMB: 0.3, maxWidthOrHeight: 512, useWebWorker: true }
      : { maxSizeMB: 0.4, maxWidthOrHeight: 1280, useWebWorker: true };

  try {
    const { default: imageCompression } = await import("browser-image-compression");
    return await imageCompression(workingFile, options);
  } catch (error) {
    console.warn("Image compression failed, uploading original:", error);
    return workingFile; // still smaller than the raw HEIC if conversion succeeded
  }
}

/**
 * Fetch a Cloudinary signature for a given upload type + draft.
 * Callers should fetch this ONCE per draft/session and reuse it
 * across every image in that batch, instead of fetching a fresh
 * signature per file — the folder/timestamp/allowed_formats are the
 * same for every image in the same draft, so one round-trip covers
 * the whole batch instead of one per photo.
 */
export async function getCloudinaryUploadSignature(
  type: ImageUploadType,
  draftId?: string | null
): Promise<CloudinarySignatureResult & { draftId: string }> {
  // Ensure the reCAPTCHA Enterprise script finishes loading before making the function call
  await getToken(appCheck, false).catch((err) => {
    console.warn("App Check pre-fetch warning:", err);
  });

  const functions = getFunctions(app, "europe-west1");
  const getSignature = httpsCallable<
    { uploadType: string; draftId?: string },
    CloudinarySignatureResult & { draftId: string }
  >(functions, "getCloudinarySignature");

  const { data: sig } = await getSignature({
    uploadType: type,
    draftId: draftId ?? undefined,
  });

  return sig;
}

/**
 * Upload an image via Firebase Cloud Functions + Cloudinary direct upload.
 *
 * Accepts an optional pre-fetched signature (`sig`) so multiple images
 * in the same draft can share a single signature round-trip instead of
 * each fetching their own. If no signature is passed, one is fetched
 * for this single image (kept for backward compatibility with any
 * other callers).
 *
 * Flow:
 *   1. Get a signed timestamp + folder (either passed in, or fetched
 *      here) so the browser can upload directly to Cloudinary without
 *      the API secret ever leaving Firebase.
 *   2. Compression and signature-fetching run in parallel when a
 *      signature isn't already provided, since neither depends on
 *      the other.
 *   3. POST the file directly to Cloudinary using exactly the signed
 *      params (folder + timestamp). No extra params are added to the
 *      FormData so the signature always matches.
 *   4. Return the secure_url from Cloudinary's response.
 */
export async function uploadImage(
  file: File,
  type: ImageUploadType,
  draftId?: string | null,
  sig?: CloudinarySignatureResult & { draftId: string },
  preCompressedFile?: File,
  skipAttach?: boolean
): Promise<{
  url: string;
  public_id: string;
}> {
  // File size validation
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("File too large. Maximum size is 8MB.");
  }

  // If the caller already compressed this file ahead of time (e.g.
  // to run compression in parallel with the shared signature fetch
  // across a whole batch), don't redo that work here. Same idea for
  // the signature — skip re-fetching if one was already passed in.
  const [compressedFile, resolvedSig] = await Promise.all([
    preCompressedFile ? Promise.resolve(preCompressedFile) : compressImageBeforeUpload(file, type),
    sig ? Promise.resolve(sig) : getCloudinaryUploadSignature(type, draftId),
  ]);

  // Only send the params that are covered by the signature.
  // Adding extra params here (or omitting one that's signed) would
  // cause Cloudinary to reject with "Invalid Signature" — folder,
  // allowed_formats, and max_file_size are all signed on the backend
  // (getCloudinarySignature), so all three must be included here
  // exactly as signed.
  const params = new URLSearchParams();
  params.append("allowed_formats", resolvedSig.allowedFormats);
  params.append("api_key", resolvedSig.apiKey);
  params.append("folder", resolvedSig.folder);
  params.append("signature", resolvedSig.signature);
  params.append("timestamp", String(resolvedSig.timestamp));

  const form = new FormData();
  form.append("file", compressedFile);

  const res = await fetchWithRetry(
    `https://api.cloudinary.com/v1_1/${resolvedSig.cloudName}/image/upload?${params.toString()}`,
    { method: "POST", body: form }
  );

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    console.log("=== CLOUDINARY ERROR ===");
    console.log("Status:", res.status);
    console.log("Response:", data);
    throw new Error(
      data?.error?.message ?? `Upload failed (HTTP ${res.status})`
    );
  }
  const data = (await res.json()) as {
    secure_url: string;
    public_id: string;
  };

  if (!data.secure_url || !data.public_id) {
    throw new Error("Cloudinary response missing image data");
  }

  // Report the uploaded image back to the draft record so it can be
  // cleaned up automatically if the advert is never published.
  //
  // skipAttach lets a batch caller (uploadImagesLimited) defer this
  // to a single attachDraftUploadImages call covering every photo in
  // the session, instead of one attach round-trip per photo. Callers
  // that pass skipAttach=true MUST call attachDraftUploadImages
  // themselves before publishing — publishAdvert validates every
  // imageUrls entry's public_id against the draft's publicIds array,
  // so an unattached upload is rejected as unverified.
  if (!skipAttach) {
    const functions = getFunctions(app, "europe-west1");
    const claimId = draftId ?? resolvedSig.draftId;
    if (claimId) {
      const attachDraftUploadImage = httpsCallable(functions, "attachDraftUploadImage");
      try {
        await attachDraftUploadImage({ draftId: claimId, publicId: data.public_id });
      } catch (error) {
        console.error("Failed to attach draft upload record:", error);
        throw new Error("Failed to finalize photo upload. Please try again.");
      }
    }
  }

  return {
    url: data.secure_url,
    public_id: data.public_id,
  };
}

/**
 * Attaches multiple already-uploaded images to a draft in one call —
 * one Firestore read + one write for the whole batch, instead of one
 * read + write per photo. Call this once after uploading every photo
 * in a posting session with uploadImage(..., skipAttach: true).
 */
export async function attachDraftUploadImages(
  draftId: string,
  publicIds: string[]
): Promise<void> {
  if (publicIds.length === 0) return;
  const functions = getFunctions(app, "europe-west1");
  const attach = httpsCallable(functions, "attachDraftUploadImages");
  try {
    await attach({ draftId, publicIds });
  } catch (error) {
    console.error("Failed to attach draft upload records:", error);
    throw new Error("Failed to finalize photo uploads. Please try again.");
  }
}
