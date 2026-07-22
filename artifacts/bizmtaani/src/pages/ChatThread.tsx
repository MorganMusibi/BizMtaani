import { useState, useEffect, useRef } from "react";
import { useLocation, useParams, Link } from "wouter";
import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
  getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { apiBase } from "@/lib/apiUrl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft,
  Send,
  Loader2,
  MessageCircle,
} from "lucide-react";

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: { seconds: number } | null;
}

interface Chat {
  type?: "product" | "job_application" | "seller";

  productId?: string;
  productTitle?: string;
  productImage?: string;

  jobId?: string;
  jobTitle?: string;
  company?: string;

  buyerId: string;
  buyerName: string;

  sellerId: string;
  sellerName: string;

  participants?: string[];
}

async function sendPushNotification(
  recipientUid: string,
  title: string,
  body: string,
  chatId: string
) {
  try {
    const tokenDoc = await getDoc(
      doc(db, "fcmTokens", recipientUid)
    );

    if (!tokenDoc.exists()) return;

    const { token } = tokenDoc.data() as {
      token: string;
    };

    if (!token) return;

    await fetch(`${apiBase()}/api/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token,
        title,
        body,
        data: {
          chatUrl: `/chat/${chatId}`,
        },
      }),
    });
  } catch (error) {
    // Notifications are best-effort.
    // A notification failure should never break the chat.
    console.error(
      "Push notification failed:",
      error
    );
  }
}

export default function ChatThread() {
  const { chatId } = useParams<{
    chatId: string;
  }>();

  const [, setLocation] = useLocation();

  const { user } = useAuth();

  const [chat, setChat] =
    useState<Chat | null>(null);

  const [messages, setMessages] =
    useState<Message[]>([]);

  const [text, setText] =
    useState("");

  const [sending, setSending] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const bottomRef =
    useRef<HTMLDivElement>(null);

  /*
  |--------------------------------------------------------------------------
  | LOAD CHAT + MESSAGES
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    // User is not authenticated yet.
    if (!user) {
      setLoading(false);
      return;
    }

    // Chat ID is missing from the URL.
    if (!chatId) {
      setError("Invalid chat.");
      setLoading(false);
      return;
    }

    let unsubscribeMessages:
      | (() => void)
      | undefined;

    async function loadChat() {
      try {
        setLoading(true);
        setError("");

        /*
        |--------------------------------------------------------------------------
        | STEP 1: LOAD CHAT DOCUMENT
        |--------------------------------------------------------------------------
        */

        const chatRef = doc(
          db,
          "chats",
          chatId
        );

        const chatSnap =
          await getDoc(chatRef);

        // Chat document doesn't exist.
        if (!chatSnap.exists()) {
          setError(
            "This conversation does not exist or may have been deleted."
          );

          setLoading(false);
          return;
        }

        const chatData =
          chatSnap.data() as Chat;

        /*
        |--------------------------------------------------------------------------
        | STEP 2: CHECK USER ACCESS
        |--------------------------------------------------------------------------
        */

        const isParticipant =
  chatData.participants?.includes(user.uid) ||
  chatData.buyerId === user.uid ||
  chatData.sellerId === user.uid;

        if (!isParticipant) {
          setError(
            "You don't have permission to access this conversation."
          );

          setLoading(false);
          return;
        }

        /*
        |--------------------------------------------------------------------------
        | STEP 3: SAVE CHAT DATA
        |--------------------------------------------------------------------------
        */

        setChat(chatData);

        /*
        |--------------------------------------------------------------------------
        | STEP 4: LISTEN FOR MESSAGES IN REAL TIME
        |--------------------------------------------------------------------------
        */

        const messagesQuery =
          query(
            collection(
              db,
              "chats",
              chatId,
              "messages"
            ),
            orderBy(
              "createdAt",
              "asc"
            )
          );

        unsubscribeMessages =
          onSnapshot(
            messagesQuery,

            (snap) => {
              const loadedMessages =
                snap.docs.map(
                  (d) =>
                    ({
                      id: d.id,
                      ...d.data(),
                    } as Message)
                );

              setMessages(
                loadedMessages
              );

              setLoading(false);
            },

            (firebaseError) => {
              console.error(
                "Error loading messages:",
                firebaseError
              );

              setError(
                firebaseError.message ||
                  "Unable to load messages."
              );

              setLoading(false);
            }
          );
      } catch (firebaseError: any) {
        console.error(
          "Error loading chat:",
          firebaseError
        );

        setError(
          firebaseError?.message ||
            "Unable to load this conversation."
        );

        setLoading(false);
      }
    }

    loadChat();

    /*
    |--------------------------------------------------------------------------
    | CLEANUP REAL-TIME LISTENER
    |--------------------------------------------------------------------------
    */

    return () => {
      if (unsubscribeMessages) {
        unsubscribeMessages();
      }
    };
  }, [user, chatId]);

  /*
  |--------------------------------------------------------------------------
  | AUTO-SCROLL TO NEWEST MESSAGE
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  /*
  |--------------------------------------------------------------------------
  | SEND MESSAGE
  |--------------------------------------------------------------------------
  */

  async function sendMessage(
    e: React.FormEvent
  ) {
    e.preventDefault();

    if (
      !text.trim() ||
      !user ||
      !chatId ||
      !chat
    ) {
      return;
    }

    setSending(true);

    const msgText =
      text.trim();

    // Clear input immediately.
    setText("");

    try {
      /*
      |--------------------------------------------------------------------------
      | ADD MESSAGE
      |--------------------------------------------------------------------------
      */

      await addDoc(
        collection(
          db,
          "chats",
          chatId,
          "messages"
        ),
        {
          senderId: user.uid,
          senderName:
            user.displayName ||
            "User",
          text: msgText,
          createdAt:
            serverTimestamp(),
        }
      );

      /*
      |--------------------------------------------------------------------------
      | UPDATE LAST MESSAGE ON CHAT
      |--------------------------------------------------------------------------
      */

      await updateDoc(
        doc(
          db,
          "chats",
          chatId
        ),
        {
          lastMessage: msgText,
          lastMessageAt:
            serverTimestamp(),
          lastSenderId:
            user.uid,
        }
      );

      /*
      |--------------------------------------------------------------------------
      | SEND PUSH NOTIFICATION
      |--------------------------------------------------------------------------
        */

      const recipientUid =
        user.uid === chat.buyerId
          ? chat.sellerId
          : chat.buyerId;

      const senderName =
  user.displayName ||
  "Someone";

const chatContext =
  chat.type === "job_application"
    ? `Application: ${chat.jobTitle || "Job application"}`
    : chat.productTitle || "New message";

// Don't await this.
// The message should remain successful
// even if notification fails.
sendPushNotification(
  recipientUid,
  `${senderName} — ${chatContext}`,
  msgText,
  chatId
);
    } catch (error: any) {
      console.error(
        "Error sending message:",
        error
      );

      // Restore message text if sending fails.
      setText(msgText);

      setError(
        error?.message ||
          "Unable to send message."
      );
    } finally {
      setSending(false);
    }
  }

  /*
  |--------------------------------------------------------------------------
  | GET OTHER USER NAME
  |--------------------------------------------------------------------------
  */

  function getOtherName() {
    if (!chat || !user) {
      return "";
    }

    return user.uid === chat.buyerId
      ? chat.sellerName
      : chat.buyerName;
  }

  /*
  |--------------------------------------------------------------------------
  | FORMAT MESSAGE TIME
  |--------------------------------------------------------------------------
  */

  function formatTime(
    ts: { seconds: number } | null
  ) {
    if (!ts) return "";

    return new Date(
      ts.seconds * 1000
    ).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /*
  |--------------------------------------------------------------------------
  | LOADING SCREEN
  |--------------------------------------------------------------------------
  */

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2
            size={32}
            className="animate-spin text-primary"
          />

          <p className="text-sm text-muted-foreground">
            Loading conversation...
          </p>
        </div>
      </div>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | ERROR SCREEN
  |--------------------------------------------------------------------------
  */

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 bg-background">
        <MessageCircle
          size={48}
          className="text-muted-foreground"
        />

        <div className="text-center">
          <h2 className="font-bold text-lg">
            Unable to open chat
          </h2>

          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            {error}
          </p>
        </div>

        <Button
          onClick={() =>
            setLocation("/chats")
          }
        >
          Back to Messages
        </Button>
      </div>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | MAIN CHAT UI
  |--------------------------------------------------------------------------
  */

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* HEADER */}
      <header className="flex-shrink-0 bg-card border-b border-border px-4 h-14 flex items-center gap-3 z-40">
        <button
          data-testid="button-back"
          onClick={() =>
            setLocation("/chats")
          }
          className="p-1 -ml-1 rounded-lg hover:bg-muted transition-colors"
        >
          <ChevronLeft size={22} />
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          {chat?.type === "job_application" ? (
  <Link
    href={`/jobs/${chat.jobId}`}
    className="text-xs text-primary truncate block"
  >
    {chat.jobTitle} · {chat.company}
  </Link>
) : chat?.type === "product" && chat?.productTitle ? (
  <Link
    href={`/product/${chat.productId}`}
    className="text-xs text-primary truncate block"
  >
    {chat.productTitle}
  </Link>
) : (
  <span className="text-xs text-muted-foreground">
    Seller
  </span>
)}

          <div className="min-w-0">
            <p
              data-testid="text-chat-header-name"
              className="font-bold text-sm truncate"
            >
              {getOtherName()}
            </p>

            {chat?.type === "job_application" ? (
  <Link
    href={`/jobs/${chat.jobId}`}
    className="text-xs text-primary truncate block"
  >
    {chat.jobTitle} · {chat.company}
  </Link>
) : chat?.productTitle ? (
  <Link
    href={`/product/${chat.productId}`}
    className="text-xs text-primary truncate block"
    data-testid="link-product"
  >
    {chat.productTitle}
  </Link>
) : null}
          </div>
        </div>
      </header>

      {/* MESSAGES */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-sm">
              Send a message to start the conversation
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine =
              msg.senderId ===
              user?.uid;

            return (
              <div
                key={msg.id}
                data-testid={`message-${msg.id}`}
                className={`flex ${
                  isMine
                    ? "justify-end"
                    : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[78%] px-4 py-2.5 rounded-2xl ${
                    isMine
                      ? "bg-primary text-white rounded-br-md"
                      : "bg-card border border-border rounded-bl-md"
                  }`}
                >
                  <p className="text-sm leading-relaxed break-words">
                    {msg.text}
                  </p>

                  <p
                    className={`text-[10px] mt-1 ${
                      isMine
                        ? "text-white/60 text-right"
                        : "text-muted-foreground"
                    }`}
                  >
                    {formatTime(
                      msg.createdAt
                    )}
                  </p>
                </div>
              </div>
            );
          })
        )}

        <div ref={bottomRef} />
      </div>

      {/* MESSAGE INPUT */}
      <form
        onSubmit={sendMessage}
        className="flex-shrink-0 flex items-center gap-2 px-4 py-3 bg-card border-t border-border"
        style={{
          paddingBottom:
            "calc(0.75rem + env(safe-area-inset-bottom))",
        }}
      >
        <Input
          data-testid="input-message"
          placeholder="Type a message..."
          value={text}
          onChange={(e) =>
            setText(e.target.value)
          }
          className="flex-1 h-11 rounded-full"
          autoComplete="off"
        />

        <Button
          data-testid="button-send"
          type="submit"
          size="icon"
          className="h-11 w-11 rounded-full flex-shrink-0"
          disabled={
            !text.trim() ||
            sending
          }
        >
          {sending ? (
            <Loader2
              size={16}
              className="animate-spin"
            />
          ) : (
            <Send size={16} />
          )}
        </Button>
      </form>
    </div>
  );
  }
