import { Router } from "express";
import { getMessaging } from "../lib/firebase-admin.js";

const router = Router();

interface NotifyBody {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

router.post("/notify", async (req, res) => {
  try {
    const { token, title, body, data } = req.body as NotifyBody;

    if (!token || !title) {
      res.status(400).json({ error: "token and title are required" });
      return;
    }

    const messaging = getMessaging();
    await messaging.send({
      token,
      notification: { title, body: body ?? "" },
      data: data ?? {},
      android: {
        notification: {
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
          sound: "default",
        },
      },
      webpush: {
        notification: {
          icon: "/icon-192.png",
          badge: "/icon-192.png",
        },
        fcmOptions: {
          link: data?.chatUrl ?? "/",
        },
      },
    });

    res.json({ success: true });
  } catch (err: unknown) {
    req.log.error({ err }, "FCM notification failed");
    res.status(500).json({ error: "Notification failed" });
  }
});

export default router;
