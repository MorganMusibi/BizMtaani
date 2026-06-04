import { Router } from "express";
import multer from "multer";
import { Readable } from "stream";
import cloudinary from "../lib/cloudinary.js";
import { getFirebaseAdmin } from "../lib/firebase-admin.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

type UploadType = "avatar" | "product" | "community";

const FOLDER_MAP: Record<UploadType, string> = {
  avatar: "bizmtaani/avatars",
  product: "bizmtaani/products",
  community: "bizmtaani/community",
};

const UPLOAD_TIMEOUT_MS = 30_000;

router.post("/upload", upload.single("image"), async (req, res) => {
  // Verify Firebase ID token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  try {
    await getFirebaseAdmin().auth().verifyIdToken(authHeader.slice(7));
  } catch (err) {
    req.log.warn({ err }, "Upload auth failed");
    res.status(401).json({ error: "Invalid auth token" });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }

  const uploadType: UploadType = (req.body.uploadType as UploadType) ?? "product";
  const folder = FOLDER_MAP[uploadType] ?? FOLDER_MAP.product;

  req.log.info({ uploadType, folder, size: file.size, mime: file.mimetype }, "Image upload started");

  try {
    const result = await Promise.race([
      new Promise<{ secure_url: string }>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder,
            resource_type: "image",
            transformation: [{ quality: "auto", fetch_format: "auto" }],
          },
          (error, result) => {
            if (error) {
              req.log.error({ cloudinaryError: error.message, http_code: error.http_code }, "Cloudinary upload error");
              reject(new Error(`Cloudinary error ${error.http_code ?? ""}: ${error.message}`));
              return;
            }
            if (!result) {
              reject(new Error("Cloudinary returned no result"));
              return;
            }
            resolve(result as { secure_url: string });
          }
        );
        Readable.from(file.buffer).pipe(stream);
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Cloudinary upload timed out after 30s")), UPLOAD_TIMEOUT_MS)
      ),
    ]);

    req.log.info({ url: result.secure_url }, "Image upload complete");
    res.json({ url: result.secure_url });
  } catch (err: unknown) {
    req.log.error({ err }, "Image upload failed");
    const msg = err instanceof Error ? err.message : "Image upload failed";
    res.status(500).json({ error: msg });
  }
});

export default router;
