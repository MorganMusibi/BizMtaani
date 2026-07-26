import { useEffect, useRef, useState, } from "react";
import { collection, doc, onSnapshot, orderBy, query, } from "firebase/firestore";
import { useLocation, useParams, Link, } from "wouter";
import { ChevronLeft, Send, Loader2, MessageCircle, Briefcase, User,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { sendChatMessage, markChatAsRead, markMessagesAsDelivered, getOtherParticipant, getParticipantName, getParticipantPhoto, type ChatData,
} from "@/lib/chatService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/*
|--------------------------------------------------------------------------
| TYPES
|--------------------------------------------------------------------------
*/
interface Message {
  id: string;
  senderId: string;
  senderName?: string;
  text: string;

  createdAt?: {
    seconds: number;
    nanoseconds?: number;
  } | null;

  deliveredAt?: {
    seconds: number;
    nanoseconds?: number;
  } | null;

  readAt?: {
    seconds: number;
    nanoseconds?: number;
  } | null;
}

/*
|--------------------------------------------------------------------------
| CHAT THREAD
|--------------------------------------------------------------------------
*/
export default function ChatThread() {

  /*
  |--------------------------------------------------------------------------
  | ROUTING
  |--------------------------------------------------------------------------
  */

  const { chatId } =
    useParams<{
      chatId: string;
    }>();

  const [, setLocation] =
    useLocation();

/*
  |--------------------------------------------------------------------------
  | AUTHENTICATION
  |--------------------------------------------------------------------------
  */

  const { user } =
    useAuth();

/*
  |--------------------------------------------------------------------------
  | STATE
  |--------------------------------------------------------------------------
  */

  const [chat, setChat] =
    useState<ChatData | null>(null);

  const [messages, setMessages] =
    useState<Message[]>([]);

  const [text, setText] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [sending, setSending] =
    useState(false);

  const [error, setError] =
    useState("");

  const [sendError, setSendError] =
    useState("");
const [selectedMessage, setSelectedMessage] =
  useState<Message | null>(null);
/*
  |--------------------------------------------------------------------------
  | REFS
  |--------------------------------------------------------------------------
  */

  const bottomRef =
    useRef<HTMLDivElement>(null);
  const inputRef =
  useRef<HTMLInputElement>(null);
  const longPressTimerRef =
  useRef<ReturnType<typeof setTimeout> | null>(null);

/*
  |--------------------------------------------------------------------------
  | LOAD CHAT + REAL-TIME LISTENERS
  |--------------------------------------------------------------------------
  |
  | One listener watches the chat document.
  |
  | One listener watches the messages subcollection.
  |
  | Both listeners are automatically cleaned up
  | when the user leaves the conversation.
  |
  */

  useEffect(() => {

    if (!user) {
      setLoading(false);
      return;
    }

    if (!chatId) {
      setError(
        "Invalid conversation."
      );

      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    /*
    |--------------------------------------------------------------------------
    | CHAT DOCUMENT LISTENER
    |--------------------------------------------------------------------------
    */

    const chatRef =
      doc(
        db,
        "chats",
        chatId
      );

    const unsubscribeChat =
      onSnapshot(
        chatRef,

        async (snapshot) => {

          if (!snapshot.exists()) {
            setChat(null);

            setError(
              "This conversation does not exist or has been deleted."
            );

            setLoading(false);

            return;
          }

          const chatData =
            snapshot.data() as ChatData;

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

            setChat(null);

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
          | MARK AS READ
          |--------------------------------------------------------------------------
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

          setLoading(false);
        },

        (firebaseError) => {

          console.error(
            "Chat listener error:",
            firebaseError
          );

          setError(
            firebaseError.message ||
              "Unable to load this conversation."
          );

          setLoading(false);
        }
      );
    /*
    |--------------------------------------------------------------------------
    | MESSAGES LISTENER
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

    const unsubscribeMessages =
      onSnapshot(
        messagesQuery,

        (snapshot) => {

          const loadedMessages =
            snapshot.docs.map(
              (messageDoc) => {

                const data =
                  messageDoc.data();

                return {
  id:
    messageDoc.id,

  senderId:
    data.senderId || "",

  senderName:
    data.senderName ||
    "User",

  text:
    data.text || "",

  createdAt:
    data.createdAt || null,

  deliveredAt:
    data.deliveredAt || null,

  readAt:
    data.readAt || null,
};
              }
            );

          setMessages(
  loadedMessages
);

if (user) {
  markMessagesAsDelivered(
    chatId,
    user.uid
  ).catch((deliveryError) => {

    console.error(
      "Unable to mark messages as delivered:",
      deliveryError
    );

  });
}
        },

        (firebaseError) => {

          console.error(
            "Messages listener error:",
            firebaseError
          );

          setError(
            firebaseError.message ||
              "Unable to load messages."
          );

          setLoading(false);
        }
      );
    /*
    |--------------------------------------------------------------------------
    | CLEANUP
    |--------------------------------------------------------------------------
    */

    return () => {

      unsubscribeChat();

      unsubscribeMessages();

    };

  }, [
    user,
    chatId,
  ]);
/*
  |--------------------------------------------------------------------------
  | AUTO-SCROLL
  |--------------------------------------------------------------------------
  */

  useEffect(() => {

    if (!bottomRef.current) {
      return;
    }

    bottomRef.current.scrollIntoView({
      behavior: "smooth",
    });

  }, [
    messages.length,
  ]);
  useEffect(() => {
  if (loading || error || !chat || !user) {
    return;
  }

  const timer = setTimeout(() => {
    inputRef.current?.focus();
  }, 500);

  return () => clearTimeout(timer);
}, [loading, error, chat, user]);


  /*
  |--------------------------------------------------------------------------
  | SEND MESSAGE
  |--------------------------------------------------------------------------
  */

  async function handleSendMessage(
    event: React.FormEvent
  ) {

    event.preventDefault();

    if (
      sending ||
      !user ||
      !chatId
    ) {
      return;
    }

    const messageText =
      text.trim();

    if (!messageText) {
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | CLEAR PREVIOUS SEND ERROR
    |--------------------------------------------------------------------------
    */

    setSendError("");

    /*
    |--------------------------------------------------------------------------
    | LOCK SENDING
    |--------------------------------------------------------------------------
    */

    setSending(true);

    /*
    |--------------------------------------------------------------------------
    | CLEAR INPUT
    |--------------------------------------------------------------------------
    */

    setText("");

    try {

      await sendChatMessage({

        chatId,

        senderId:
          user.uid,

        senderName:
          user.displayName ||
          user.email ||
          "User",

        text:
          messageText,

      });

    } catch (sendError: any) {

      console.error(
        "Unable to send message:",
        sendError
      );

      /*
      |--------------------------------------------------------------------------
      | RESTORE INPUT
      |--------------------------------------------------------------------------
      */

      setText(
        messageText
      );

      setSendError(
        sendError?.message ||
          "Unable to send message. Please try again."
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

  const otherUserId =
    chat && user
      ? getOtherParticipant(
          chat,
          user.uid
        )
      : null;

/*
  |--------------------------------------------------------------------------
  | OTHER USER NAME
  |--------------------------------------------------------------------------
  */

  const otherName =
    chat && otherUserId
      ? getParticipantName(
          chat,
          otherUserId
        )
      : "User";

 /*
  |--------------------------------------------------------------------------
  | OTHER USER PHOTO
  |--------------------------------------------------------------------------
  */

  const otherPhoto =
    chat && otherUserId
      ? getParticipantPhoto(
          chat,
          otherUserId
        )
      : "";

 /*
  |--------------------------------------------------------------------------
  | CHAT CONTEXT
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
        label:
          "Job Application",

        title:
          chat.jobTitle ||
          "Job Application",
      };

    }

    if (
      chat.type ===
      "product"
    ) {

      return {
        label:
          "Product",

        title:
          chat.productTitle ||
          "Product Chat",
      };

    }

    return {
      label:
        "Direct Message",

      title:
        "Conversation",
    };

  }

/*
  |--------------------------------------------------------------------------
  | FORMAT TIME
  |--------------------------------------------------------------------------
  */

  function formatMessageTime(
    timestamp:
      | {
          seconds: number;
          nanoseconds?: number;
        }
      | null
      | undefined
  ): string {

    if (!timestamp) {
      return "";
    }

    return new Date(
      timestamp.seconds * 1000
    ).toLocaleTimeString(
      [],
      {
        hour:
          "2-digit",

        minute:
          "2-digit",
      }
    );

  }
  function formatMessageDate(
  timestamp:
    | {
        seconds: number;
        nanoseconds?: number;
      }
    | null
    | undefined
): string {

  if (!timestamp) {
    return "";
  }

  const date =
    new Date(
      timestamp.seconds * 1000
    );

  const today =
    new Date();

  const yesterday =
    new Date();

  yesterday.setDate(
    yesterday.getDate() - 1
  );

  if (
    date.toDateString() ===
    today.toDateString()
  ) {
    return "Today";
  }

  if (
    date.toDateString() ===
    yesterday.toDateString()
  ) {
    return "Yesterday";
  }

  return date.toLocaleDateString(
    [],
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    }
  );
  }
  function getMessageStatus(
  message: Message
) {
  if (message.readAt) {
    return {
      icon: "✓✓",
      className: "text-blue-400",
    };
  }

  if (message.deliveredAt) {
    return {
      icon: "✓✓",
      className: "text-white/60",
    };
  }

  return {
    icon: "✓",
    className: "text-white/60",
  };
  }
  function handleMessagePressStart(
  message: Message
) {
  longPressTimerRef.current =
    setTimeout(() => {
      setSelectedMessage(message);
    }, 600);
}

function handleMessagePressEnd() {
  if (longPressTimerRef.current) {
    clearTimeout(
      longPressTimerRef.current
    );

    longPressTimerRef.current = null;
  }
}

/*
  |--------------------------------------------------------------------------
  | LOADING
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
  | FATAL ERROR
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
            setLocation(
              "/chats"
            )
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

  if (
    !chat ||
    !user
  ) {

    return (
      <div className="min-h-screen flex items-center justify-center bg-background">

        <p className="text-muted-foreground">
          Conversation unavailable.
        </p>

      </div>
    );

  }


  const chatContext =
    getChatContext();

/*
  |--------------------------------------------------------------------------
  | MAIN UI
  |--------------------------------------------------------------------------
  */

  return (
    <div className="flex flex-col h-screen bg-background">

      {/* ================================================================
          HEADER
      ================================================================ */}

      <header className="flex-shrink-0 bg-card border-b border-border px-4 h-16 flex items-center gap-3 z-40">

        <button
          data-testid="button-back"
          onClick={() =>
            setLocation(
              "/chats"
            )
          }
          className="p-1 -ml-1 rounded-lg hover:bg-muted transition-colors"
          aria-label="Back to messages"
        >

          <ChevronLeft
            size={22}
          />

        </button>


        {/* ============================================================
            PROFILE IMAGE
        ============================================================ */}

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


        {/* ============================================================
            CHAT INFO
        ============================================================ */}

        <div className="flex-1 min-w-0">

          <p
            data-testid="text-chat-header-name"
            className="font-bold text-sm truncate"
          >
            {otherName}
          </p>


          {chatContext && (

            chat.type ===
              "job_application" &&
            chat.jobId ? (

              <Link
                href={`/jobs/${chat.jobId}`}
                className="text-xs text-primary truncate block"
              >
                {chatContext.label}
                {" · "}
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
                {chatContext.label}
                {" · "}
                {chatContext.title}
              </Link>

            ) : (

              <span className="text-xs text-muted-foreground">
                {chatContext.label}
              </span>

            )

          )}

        </div>

      </header>


      {/* ================================================================
          MESSAGES
      ================================================================ */}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 bg-muted/30">

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

                  messages.map(
            (message, index) => {

              const isMine =
                message.senderId === user.uid;
              const messageStatus =
  getMessageStatus(message);

              const currentDate =
                formatMessageDate(
                  message.createdAt
                );

              const previousDate =
                index > 0
                  ? formatMessageDate(
                      messages[index - 1].createdAt
                    )
                  : null;

              const showDateSeparator =
                currentDate !== previousDate;

              return (
                <div
                  key={message.id}
                >

                  {showDateSeparator && (
                    <div className="flex items-center justify-center my-4">
                      <span className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-[11px] font-medium">
                        {currentDate}
                      </span>
                    </div>
                  )}

                  <div
                    data-testid={`message-${message.id}`}
                    className={`flex ${
                      isMine
                        ? "justify-end"
                        : "justify-start"
                    }`}
                  >

                    <div
  onTouchStart={() =>
    handleMessagePressStart(message)
  }
  onTouchEnd={
    handleMessagePressEnd
  }
  onTouchCancel={
    handleMessagePressEnd
  }
  onMouseDown={() =>
    handleMessagePressStart(message)
  }
  onMouseUp={
    handleMessagePressEnd
  }
  onMouseLeave={
    handleMessagePressEnd
  }
  className={`max-w-[78%] px-4 py-2.5 rounded-2xl ${
                        isMine
                       ? "bg-primary text-white rounded-br-md"
                       : "bg-muted border border-border rounded-bl-md"
                      }`}
                    >

                      {!isMine && (
                        <p className="text-[10px] font-bold mb-1 opacity-70">
                          {message.senderName ||
                            getParticipantName(
                              chat,
                              message.senderId
                            )}
                        </p>
                      )}

                      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
                        {message.text}
                      </p>

                      <div
                        className={`flex items-center gap-1 mt-1 ${
                          isMine
                            ? "justify-end"
                            : "justify-start"
                        }`}
                      >

                        <p
                          className={`text-[10px] ${
                            isMine
                              ? "text-white/60"
                              : "text-muted-foreground"
                          }`}
                        >
                          {formatMessageTime(
                            message.createdAt
                          )}
                        </p>

                        {isMine && (
                          <span
  className={`text-[11px] font-semibold ${
    messageStatus.className
  }`}
                            aria-label={
                              message.readAt
                                ? "Read"
                                : message.deliveredAt
                                ? "Delivered"
                                : "Sent"
                            }
                          >
                            {
  messageStatus.icon
}
                          </span>
                        )}

                      </div>

                    </div>

                  </div>

                </div>
              );

                        }
          )
        )}

        <div
          ref={bottomRef}
        />

      </div>


      {/* ================================================================
          SEND ERROR
      ================================================================ */}

      {sendError && (

        <div className="flex-shrink-0 px-4 py-2 bg-destructive/10 border-t border-destructive/20">

          <p className="text-xs text-destructive text-center">
            {sendError}
          </p>

        </div>

      )}


      {/* ================================================================
          MESSAGE INPUT
      ================================================================ */}

      <form
        onSubmit={
          handleSendMessage
        }
        className="flex-shrink-0 flex items-center gap-2 px-4 py-3 bg-card border-t border-border"
        style={{
          paddingBottom:
            "calc(0.75rem + env(safe-area-inset-bottom))",
        }}
      >

        <Input
  ref={inputRef}
  data-testid="input-message"
  placeholder="Type a message..."
  value={text}
  onChange={(event) =>
    setText(event.target.value)
  }
  className="flex-1 h-11 rounded-full"
  autoComplete="off"
  autoFocus
  disabled={sending}
  maxLength={5000}
/>


        <Button
          data-testid="button-send"
          type="submit"
          size="icon"
          className="h-11 w-11 rounded-full flex-shrink-0"
          disabled={
            sending ||
            !text.trim()
          }
          aria-label="Send message"
        >

          {sending ? (

            <Loader2
              size={16}
              className="animate-spin"
            />

          ) : (

            <Send
              size={16}
            />

          )}

        </Button>

            </form>

    </div>
  );
}

