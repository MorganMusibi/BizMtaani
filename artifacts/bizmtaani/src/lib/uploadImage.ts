import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/lib/firebase";
import imageCompression from "browser-image-compression";

export type ImageUploadType = "avatar" | "product" | "community";

interface CloudinarySignatureResult {
  signature: string;
  timestamp: number;
  folder: string;
  apiKey: string;
  cloudName: string;
  allowedFormats: string;
  maxFileSize: number;
}
/**
 * Compress an image client-side before it ever reaches Cloudinary.
 * Cuts storage credits at upload time, and bandwidth credits every
 * single time the image is viewed afterwards.
 *
 * Falls back to the original file if compression fails for any
 * reason (e.g. unsupported format) — never blocks a user's upload.
 */
async function compressImageBeforeUpload(
  file: File,
  type: ImageUploadType
): Promise<File> {
  // Skip compression for tiny files — not worth the CPU cost
  if (file.size < 150 * 1024) {
    return file;
  }

  const options =
    type === "avatar"
      ? { maxSizeMB: 0.3, maxWidthOrHeight: 512, useWebWorker: true }
      : { maxSizeMB: 0.8, maxWidthOrHeight: 1600, useWebWorker: true };

  try {
    const compressed = await imageCompression(file, options);
    return compressed;
  } catch (error) {
    console.warn("Image compression failed, uploading original:", error);
    return file;
  }
}

/**
 * Upload an image via Firebase Cloud Functions + Cloudinary direct upload.
 *
 * Flow:
 *   1. Call `getCloudinarySignature` Cloud Function — returns a signed
 *      timestamp + folder so the browser can upload directly to Cloudinary
 *      without the API secret ever leaving Firebase.
 *   2. POST the file directly to Cloudinary using exactly the signed params
 *      (folder + timestamp). No extra params are added to the FormData so
 *      the signature always matches.
 *   3. Return the secure_url from Cloudinary's response.
 */
export async function uploadImage(
  file: File,
  type: ImageUploadType,
  draftId?: string | null
): Promise<{
  url: string;
  public_id: string;
}> {
  const compressedFile = await compressImageBeforeUpload(file, type);

  const functions = getFunctions(app, "us-central1");
  const getSignature = httpsCallable<
    { uploadType: string },
    CloudinarySignatureResult & { draftId: string }
  >(functions, "getCloudinarySignature");

  const { data: sig } = await getSignature({ uploadType: type });

  // Only send the params that are covered by the signature.
  // Adding extra params here would cause Cloudinary to reject with
  // "Invalid Signature" — allowed_formats and bytes_limit are now
  // part of the signed payload, so they must be included exactly
  // as the backend signed them.
  const form = new FormData();
  form.append("file", compressedFile);
  form.append("api_key", sig.apiKey);
  form.append("timestamp", String(sig.timestamp));
  form.append("signature", sig.signature);
  form.append("folder", sig.folder);
  form.append("allowed_formats", sig.allowedFormats);
  
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`,
    { method: "POST", body: form }
  );

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
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
const claimId = draftId ?? sig.draftId;
if (claimId) {
  const attachDraftUploadImage = httpsCallable(functions, "attachDraftUploadImage");
  attachDraftUploadImage({ draftId: claimId, publicId: data.public_id }).catch((error) => {
    console.warn("Failed to attach draft upload record:", error);
  });
}

return {
  url: data.secure_url,
  public_id: data.public_id,
};
}
  
