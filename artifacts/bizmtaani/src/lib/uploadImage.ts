import { auth } from "@/lib/firebase";
import { apiBase } from "@/lib/apiUrl";

export type ImageUploadType = "avatar" | "product" | "community";

export async function uploadImage(
  file: File,
  type: ImageUploadType
): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Must be signed in to upload images");

  const token = await user.getIdToken();

  const form = new FormData();
  form.append("image", file);
  form.append("uploadType", type);

  const res = await fetch(`${apiBase()}/api/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Upload failed (HTTP ${res.status})`);
  }

  const data = (await res.json()) as { url: string };
  if (!data.url) throw new Error("No URL returned from upload service");
  return data.url;
}
