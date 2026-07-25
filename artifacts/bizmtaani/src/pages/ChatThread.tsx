import { useState, useEffect, useRef } from "react";
import { useLocation, useParams, Link } from "wouter";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft,
  Send,
  Loader2,
  MessageCircle,
  Briefcase,
  User,
} from "lucide-react";

import {
  sendChatMessage,
  markChatAsRead,
  getOtherParticipant,
  getParticipantName,
  getParticipantPhoto,
  type ChatData,
} from "@/lib/chatService";

interface Message {
  id: string;
  senderId: string;
  senderName?: string;
  text: string;
  createdAt: {
    seconds: number;
    nanoseconds?: number;
  } | null;
  read?: boolean;
}

export default function ChatThread() {
  const { chatId } = useParams<{
    chatId: string;
  }>();

  const [, setLocation] = useLocation();

  const { user } = useAuth();

  const [chat, setChat] =
    useState<ChatData | null>(null);

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
  | LOAD CHAT
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

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
        | GET CHAT DOCUMENT
        |--------------------------------------------------------------------------
        */

        const chatRef = doc(
          db,
          "chats",
          chatId
        );

        const chatSnap =
          await getDoc(chatRef);

        if (!chatSnap.exists()) {
          setError(
            "This conversation does not exist or may have been deleted."
          );

          setLoading(false);
          return;
        }

        const chatData =
          chatSnap.data() as ChatData;

        /*
        |--------------------------------------------------------------------------
        | CHECK PARTICIPATION
        |--------------------------------------------------------------------------
        */

        const isParticipant =
          Array.isArray(
            chatData.participants
          ) &&
          chatData.participants.includes(
            user.uid
          );

        if (!isParticipant) {
          setError(
            "You don't have permission to access this conversation."
          );

          setLoading(false);
          return;
        }

        /*
        |--------------------------------------------------------------------------
        | SAVE CHAT
        |--------------------------------------------------------------------------
        */

        setChat(chatData);

        /*
        |--------------------------------------------------------------------------
        | MARK CHAT AS READ
        |--------------------------------------------------------------------------
        |
        | Reset the current user's unread count.
        |
        */

        try {
          await markChatAsRead(
            chatId,
            user.uid
          );
        } catch (readError) {
          console.error(
            "Unable to mark chat as read:",
            readError
          );
        }

        /*
        |--------------------------------------------------------------------------
        | LISTEN FOR MESSAGES
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
                  (messageDoc) =>
                    ({
                      id: messageDoc.id,
                      ...messageDoc.data(),
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
    | CLEANUP
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
  | AUTO-SCROLL TO LATEST MESSAGE
  |--------------------------------------------------------------------------
    */

  useEffect(() => {
    if (!bottomRef.current) {
      return;
    }

    bottomRef.current.scrollIntoView({
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

    const messageText =
      text.trim();

    setSending(true);

    /*
    |--------------------------------------------------------------------------
    | CLEAR INPUT IMMEDIATELY
    |--------------------------------------------------------------------------
    */

    setText("");

    try {
      /*
      |--------------------------------------------------------------------------
      | SEND THROUGH CHAT SERVICE
      |--------------------------------------------------------------------------
      |
      | chatService handles:
      |
      | 1. Creating the message
      | 2. Updating lastMessage
      | 3. Updating lastMessageAt
      | 4. Updating lastSenderId
      | 5. Updating unread counts
      |
      */

      await sendChatMessage({
        chatId,
        senderId: user.uid,
        senderName:
          user.displayName ||
          user.email ||
          "User",
        text: messageText,
      });

      /*
      |--------------------------------------------------------------------------
      | CHAT DOCUMENT WILL UPDATE THROUGH FIRESTORE REAL-TIME LISTENER
      |--------------------------------------------------------------------------
      */

    } catch (sendError: any) {
      console.error(
        "Error sending message:",
        sendError
      );

      /*
      |--------------------------------------------------------------------------
      | RESTORE MESSAGE IF SEND FAILED
      |--------------------------------------------------------------------------
      */

      setText(messageText);

      setError(
        sendError?.message ||
          "Unable to send message."
      );
    } finally {
      setSending(false);
    }
  }

  /*
  |--------------------------------------------------------------------------
  | GET OTHER PARTICIPANT
  |--------------------------------------------------------------------------
  */

  function getOtherUserId() {
    if (!chat || !user) {
      return null;
    }

    return getOtherParticipant(
      chat,
      user.uid
    );
  }

  /*
  |--------------------------------------------------------------------------
  | GET OTHER USER NAME
  |--------------------------------------------------------------------------
  */

  function getOtherName() {
    if (!chat || !user) {
      return "User";
    }

    const otherUserId =
      getOtherParticipant(
        chat,
        user.uid
      );

    if (!otherUserId) {
      return "User";
    }

    return getParticipantName(
      chat,
      otherUserId
    );
  }

  /*
  |--------------------------------------------------------------------------
  | GET OTHER USER PHOTO
  |--------------------------------------------------------------------------
  */

  function getOtherPhoto() {
    if (!chat || !user) {
      return "";
    }

    const otherUserId =
      getOtherParticipant(
        chat,
        user.uid
      );

    if (!otherUserId) {
      return "";
    }

    return getParticipantPhoto(
      chat,
      otherUserId
    );
  }

  /*
  |--------------------------------------------------------------------------
  | FORMAT MESSAGE TIME
  |--------------------------------------------------------------------------
  */

  function formatTime(
    ts:
      | {
          seconds: number;
          nanoseconds?: number;
        }
      | null
      | undefined
  ) {
    if (!ts) {
      return "";
    }

    return new Date(
      ts.seconds * 1000
    ).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /*
  |--------------------------------------------------------------------------
  | GET CHAT CONTEXT
  |--------------------------------------------------------------------------
  */

  function getChatContext() {
    if (!chat) {
      return null;
    }

    if (
      chat.type ===
      "job_application"
    ) {
      return {
        label: "Job Application",
        title:
          chat.jobTitle ||
          "Job Application",
      };
    }

    if (
      chat.type === "product"
    ) {
      return {
        label: "Product",
        title:
          chat.productTitle ||
          "Product Chat",
      };
    }

    return {
      label: "Direct Message",
      title: "Conversation",
    };
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
  | SAFETY CHECK
  |--------------------------------------------------------------------------
  */

  if (!chat || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">
          Conversation unavailable.
        </p>
      </div>
    );
  }

  const otherName =
    getOtherName();

  const otherPhoto =
    getOtherPhoto();

  const chatContext =
    getChatContext();

  /*
  |--------------------------------------------------------------------------
  | MAIN CHAT UI
  |--------------------------------------------------------------------------
  */

  return (
    <div className="flex flex-col h-screen bg-background">

      {/* ================================================================ */}
      {/* HEADER */}
      {/* ================================================================ */}

      <header className="flex-shrink-0 bg-card border-b border-border px-4 h-16 flex items-center gap-3 z-40">

        {/* BACK BUTTON */}

        <button
          data-testid="button-back"
          onClick={() =>
            setLocation("/chats")
          }
          className="p-1 -ml-1 rounded-lg hover:bg-muted transition-colors"
        >
          <ChevronLeft size={22} />
        </button>

        {/* PROFILE IMAGE */}

        {otherPhoto ? (
          <img
            src={otherPhoto}
            alt={otherName}
            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <User
              size={20}
              className="text-primary"
            />
          </div>
        )}

        {/* CHAT INFORMATION */}

        <div className="flex-1 min-w-0">

          <p
            data-testid="text-chat-header-name"
            className="font-bold text-sm truncate"
          >
            {otherName}
          </p>

          {chatContext && (
            <>
              {chat.type ===
                "job_application" &&
              chat.jobId ? (
                <Link
                  href={`/jobs/${chat.jobId}`}
                  className="text-xs text-primary truncate block"
                >
                  {chatContext.label} ·{" "}
                  {chatContext.title}
                </Link>
              ) : chat.type ===
                  "product" &&
                chat.productId ? (
                <Link
                  href={`/product/${chat.productId}`}
                  className="text-xs text-primary truncate block"
                  data-testid="link-product"
                >
                  {chatContext.label} ·{" "}
                  {chatContext.title}
                </Link>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {chatContext.label}
                </span>
              )}
            </>
          )}

        </div>
      </header>

      {/* ================================================================ */}
      {/* MESSAGES */}
      {/* ================================================================ */}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">

        {messages.length === 0 ? (

          <div className="flex flex-col items-center justify-center h-full gap-3">

            {chat.type ===
            "job_application" ? (
              <Briefcase
                size={40}
                className="text-muted-foreground"
              />
            ) : (
              <MessageCircle
                size={40}
                className="text-muted-foreground"
              />
            )}

            <p className="text-muted-foreground text-sm text-center">
              {chat.type ===
              "job_application"
                ? "Start the conversation about this job application."
                : "Send a message to start the conversation."}
            </p>

          </div>

        ) : (

          messages.map((msg) => {

            const isMine =
              msg.senderId ===
              user.uid;

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

                  {/* SENDER NAME FOR OTHER USER */}

                  {!isMine && (
                    <p className="text-[10px] font-bold mb-1 opacity-70">
                      {msg.senderName ||
                        getParticipantName(
                          chat,
                          msg.senderId
                        )}
                    </p>
                  )}

                  {/* MESSAGE */}

                  <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
                    {msg.text}
                  </p>

                  {/* TIME */}

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

      {/* ================================================================ */}
      {/* ERROR MESSAGE */}
      {/* ================================================================ */}

      {error && (
        <div className="flex-shrink-0 px-4 py-2 bg-destructive/10 border-t border-destructive/20">
          <p className="text-xs text-destructive text-center">
            {error}
          </p>
        </div>
      )}

      {/* ================================================================ */}
      {/* MESSAGE INPUT */}
      {/* ================================================================ */}

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
          disabled={sending}
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
