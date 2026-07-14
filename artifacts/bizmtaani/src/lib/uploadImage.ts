import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/lib/firebase";

export type ImageUploadType = "avatar" | "product" | "community";

interface CloudinarySignatureResult {
  signature: string;
  timestamp: number;
  folder: string;
  apiKey: string;
  cloudName: string;
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
  type: ImageUploadType
): Promise<{
  url: string;
  public_id: string;
}> {
  const functions = getFunctions(app);
  const getSignature = httpsCallable<
    { uploadType: string },
    CloudinarySignatureResult
  >(functions, "getCloudinarySignature");

  const { data: sig } = await getSignature({ uploadType: type });

  // Only send the params that are covered by the signature.
  // Adding extra params here would cause Cloudinary to reject with
  // "Invalid Signature".
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", sig.apiKey);
  form.append("timestamp", String(sig.timestamp));
  form.append("signature", sig.signature);
  form.append("folder", sig.folder);

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

return {
  url: data.secure_url,
  public_id: data.public_id,
};
}
