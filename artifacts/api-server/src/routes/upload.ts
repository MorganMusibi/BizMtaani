import { Router } from "express";
import multer from "multer";
import { Readable } from "stream";
import cloudinary from "../lib/cloudinary.js";

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

router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No image file provided" });
      return;
    }

    const uploadType: UploadType = (req.body.uploadType as UploadType) ?? "product";
    const folder = FOLDER_MAP[uploadType] ?? FOLDER_MAP.product;

    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: "image",
          transformation: [{ quality: "auto", fetch_format: "auto" }],
        },
        (error, result) => {
          if (error || !result) return reject(error ?? new Error("Upload failed"));
          resolve(result as { secure_url: string });
        }
      );
      Readable.from(file.buffer).pipe(stream);
    });

    res.json({ url: result.secure_url });
  } catch (err: unknown) {
    req.log.error({ err }, "Image upload failed");
    res.status(500).json({ error: "Image upload failed" });
  }
});

export default router;
