import { useEffect, useRef, useState, useCallback } from "react";
import { collection, doc, onSnapshot, orderBy, query, where, limitToLast, getDocs, limit, startAfter, getDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { useLocation, useParams, Link, useSearch } from "wouter";
import { ChevronLeft, Send, Loader2, MessageCircle, Briefcase, User, ChevronUp } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { sendChatMessage, forwardChatMessage, markChatAsRead, markMessagesAsDelivered, getOtherParticipant, getParticipantName, getParticipantPhoto, deleteMessageForMe, deleteMessageForEveryone, reportMessage, type ChatData, type ReplyTo } from "@/lib/chatService";
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
  deletedFor?: string[];
  deletedForEveryone?: boolean;
  forwarded?: boolean;
  replyTo?: ReplyTo | null;
  productContext?: {
    productId: string;
    productTitle: string;
    productImage?: string;
  } | null;
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

function getChatThumbnailUrl(url: string): string {
  if (!url) return "";
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", "/upload/f_auto,q_auto,w_128,h_128,c_fill/");
  }
  return url;
}

// Throttle helper for markAsRead
const READ_THROTTLE_MS = 5000;

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

  const { chatId } = useParams<{ chatId: string }>();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const cameFromProductReply = new URLSearchParams(searchString).get("ref") === "product";

  /*
  |--------------------------------------------------------------------------
  | AUTHENTICATION
  |--------------------------------------------------------------------------
  */

  const { user } = useAuth();

  /*
  |--------------------------------------------------------------------------
  | STATE
  |--------------------------------------------------------------------------
  */

  const [chat, setChat] = useState<ChatData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [forwardChats, setForwardChats] = useState<(ChatData & { id: string })[]>([]);
  const [forwardChatsLoading, setForwardChatsLoading] = useState(false);
  const [forwardLastDoc, setForwardLastDoc] = useState<any>(null);
  const [hasMoreChats, setHasMoreChats] = useState(true);
  const [showProductAttachment, setShowProductAttachment] = useState(true);
  
  // ✅ Pagination state for messages
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [firstDoc, setFirstDoc] = useState<any>(null);
  const [initialMessagesLoaded, setInitialMessagesLoaded] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | REFS
  |--------------------------------------------------------------------------
  */

  const bottomRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readThrottleRef = useRef<{ timeout: NodeJS.Timeout | null; lastRead: number }>({
    timeout: null,
    lastRead: 0
  });
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number>(0);

  /*
  |--------------------------------------------------------------------------
  | LOAD CHAT + OPTIMIZED MESSAGE LISTENER
  |--------------------------------------------------------------------------
  |
  | 1. Initial load uses getDocs (one-time read)
  | 2. Only listens for NEW messages after initial load
  | 3. Supports pagination for loading older messages
  |
  */

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    if (!chatId) {
      setError("Invalid conversation.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    setInitialMessagesLoaded(false);

    // ─── CHAT DOCUMENT LISTENER ─────────────────────────────────────────

    const chatRef = doc(db, "chats", chatId);
    const unsubscribeChat = onSnapshot(
      chatRef,
      async (snapshot) => {
        if (!snapshot.exists()) {
          setChat(null);
          setError("This conversation does not exist or has been deleted.");
          setLoading(false);
          return;
        }

        const chatData = snapshot.data() as ChatData;
        const isParticipant = Array.isArray(chatData.participants) && chatData.participants.includes(user.uid);

        if (!isParticipant) {
          setChat(null);
          setError("You don't have permission to access this conversation.");
          setLoading(false);
          return;
        }

        setChat(chatData);
        setLoading(false);
      },
      (firebaseError) => {
        console.error("Chat listener error:", firebaseError);
        setError(firebaseError.message || "Unable to load this conversation.");
        setLoading(false);
      }
    );

    let unsubscribeNewMessages: (() => void) | null = null;

    const setupNewMessagesListener = (loadedMessages: Message[]) => {
      if (!chatId) return;

      const lastMessage = loadedMessages[loadedMessages.length - 1];
      const lastTimestamp = lastMessage?.createdAt;

      let q = query(
        collection(db, "chats", chatId, "messages"),
        orderBy("createdAt", "asc")
      );

      if (lastTimestamp) {
        q = query(q, where("createdAt", ">", lastTimestamp));
      } else {
        q = query(q, limitToLast(1));
      }

      unsubscribeNewMessages = onSnapshot(
        q,
        (snapshot) => {
          const newMessages = snapshot.docs
            .map((doc) => ({
              id: doc.id,
              ...doc.data(),
            }))
            .filter((message) => !message.deletedFor?.includes(user.uid));

          if (newMessages.length > 0) {
            setMessages((prev) => {
              const existingIds = new Set(prev.map((m) => m.id));
              const uniqueNew = newMessages.filter((m) => !existingIds.has(m.id));
              return [...prev, ...uniqueNew];
            });

            throttleMarkAsRead();
          }
        },
        (error) => {
          console.error("New messages listener error:", error);
        }
      );
    };

    const loadInitialMessages = async () => {
      try {
        const q = query(
          collection(db, "chats", chatId, "messages"),
          orderBy("createdAt", "desc"),
          limitToLast(20)
        );

        const snapshot = await getDocs(q);
        const loadedMessages = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Reverse to get chronological order
        const sortedMessages = loadedMessages.reverse();

        // Filter out deleted messages
        const filteredMessages = sortedMessages.filter(
          (message) => !message.deletedFor?.includes(user.uid)
        );

        setMessages(filteredMessages);
        setInitialMessagesLoaded(true);

        // Store first doc for pagination
        if (snapshot.docs.length > 0) {
          setFirstDoc(snapshot.docs[0]);
        }
        setHasMoreMessages(snapshot.docs.length === 20);

        // ✅ Throttled markAsRead
        throttleMarkAsRead();

        // FIX: attach the live listener now, using the array we just
        // fetched — not stale `messages` state, and not gated behind
        // state that hasn't re-rendered yet.
        setupNewMessagesListener(filteredMessages);

      } catch (error) {
        console.error("Failed to load initial messages:", error);
        setError("Unable to load messages.");
        setLoading(false);
      }
    };

    loadInitialMessages();

    
    // ─── CLEANUP ──────────────────────────────────────────────────────

    return () => {
      unsubscribeChat();
      if (unsubscribeNewMessages) unsubscribeNewMessages();
      if (readThrottleRef.current.timeout) {
        clearTimeout(readThrottleRef.current.timeout);
      }
    };
  }, [user, chatId]);

  /*
  |--------------------------------------------------------------------------
  | THROTTLED MARK AS READ
  |--------------------------------------------------------------------------
  */

  const throttleMarkAsRead = useCallback(() => {
    if (!chatId || !user) return;

    const now = Date.now();

    if (now - readThrottleRef.current.lastRead > READ_THROTTLE_MS) {
      readThrottleRef.current.lastRead = now;
      markChatAsRead(chatId, user.uid).catch((error) => {
        console.error("Unable to mark messages as read:", error);
      });
    } else {
      if (readThrottleRef.current.timeout) {
        clearTimeout(readThrottleRef.current.timeout);
      }
      readThrottleRef.current.timeout = setTimeout(() => {
        readThrottleRef.current.lastRead = Date.now();
        markChatAsRead(chatId, user.uid).catch((error) => {
          console.error("Unable to mark messages as read:", error);
        });
      }, READ_THROTTLE_MS);
    }
  }, [chatId, user]);

  /*
  |--------------------------------------------------------------------------
  | LOAD MORE MESSAGES (Pagination)
  |--------------------------------------------------------------------------
  */

  const loadMoreMessages = useCallback(async () => {
    if (loadingMore || !hasMoreMessages || !chatId || !initialMessagesLoaded) return;
    setLoadingMore(true);

    try {
      // Save current scroll height for position restoration
      if (messagesContainerRef.current) {
        prevScrollHeightRef.current = messagesContainerRef.current.scrollHeight;
      }

      let q = query(
        collection(db, "chats", chatId, "messages"),
        orderBy("createdAt", "desc"),
        startAfter(firstDoc),
        limit(20)
      );

      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        setHasMoreMessages(false);
        setLoadingMore(false);
        return;
      }

      const olderMessages = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))
        .filter((message) => !message.deletedFor?.includes(user.uid))
        .reverse(); // Reverse to maintain chronological order

      setMessages((prev) => {
        // Avoid duplicates
        const existingIds = new Set(prev.map((m) => m.id));
        const uniqueOlder = olderMessages.filter((m) => !existingIds.has(m.id));
        return [...uniqueOlder, ...prev];
      });

      setFirstDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMoreMessages(snapshot.docs.length === 20);

      // Restore scroll position
      setTimeout(() => {
        if (messagesContainerRef.current && prevScrollHeightRef.current) {
          const newScrollHeight = messagesContainerRef.current.scrollHeight;
          messagesContainerRef.current.scrollTop = newScrollHeight - prevScrollHeightRef.current;
        }
      }, 50);

    } catch (error) {
      console.error("Failed to load more messages:", error);
      setSendError("Unable to load older messages.");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMoreMessages, chatId, initialMessagesLoaded, firstDoc, user]);

  /*
  |--------------------------------------------------------------------------
  | AUTO-SCROLL
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!bottomRef.current || !initialMessagesLoaded) return;
    bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, initialMessagesLoaded]);

  /*
  |--------------------------------------------------------------------------
  | FORWARD CHATS PICKER - PAGINATED
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!forwardingMessage || !user) return;

    // Reset state when forward modal opens
    setForwardChats([]);
    setForwardLastDoc(null);
    setHasMoreChats(true);
    loadForwardChats(false);

  }, [forwardingMessage, user]);

  const loadForwardChats = useCallback(async (loadMore = false) => {
    if (forwardChatsLoading || !user) return;
    setForwardChatsLoading(true);

    try {
      let q = query(
        collection(db, "chats"),
        where("participants", "array-contains", user.uid),
        orderBy("lastMessageAt", "desc"),
        limit(20)
      );

      if (loadMore && forwardLastDoc) {
        q = query(q, startAfter(forwardLastDoc));
      }

      const snapshot = await getDocs(q);
      const chats = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as ChatData & { id: string }))
      .filter((chat) => chat.id !== chatId);

      setForwardChats((prev) => loadMore ? [...prev, ...chats] : chats);
      setForwardLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMoreChats(snapshot.docs.length === 20);
    } catch (error) {
      console.error("Failed to load chats for forwarding:", error);
      setSendError("Unable to load conversations.");
    } finally {
      setForwardChatsLoading(false);
    }
  }, [user, forwardLastDoc, chatId, forwardChatsLoading]);

  /*
  |--------------------------------------------------------------------------
  | SEND MESSAGE
  |--------------------------------------------------------------------------
  */

  async function handleSendMessage(event: React.FormEvent) {
    event.preventDefault();

    if (sending || !user || !chatId) return;

    const messageText = text.trim();
    if (!messageText) return;

    setSendError("");
    setSending(true);
    setText("");

    try {
      await sendChatMessage({
        chatId,
        senderId: user.uid,
        senderName: user.displayName || user.email || "User",
        text: messageText,
        replyTo: replyingTo
          ? {
              messageId: replyingTo.id,
              senderId: replyingTo.senderId,
              senderName: replyingTo.senderName || getParticipantName(chat, replyingTo.senderId),
              text: replyingTo.text,
            }
          : null,
        productContext: showProductPreview
          ? {
              productId: chat.productId || "",
              productTitle: chat.productTitle || "",
              productImage: chat.productImage || "",
            }
          : null,
      });

      setReplyingTo(null);
      setShowProductAttachment(false);

    } catch (sendError: any) {
      console.error("Unable to send message:", sendError);
      setText(messageText);
      setSendError(sendError?.message || "Unable to send message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  /*
  |--------------------------------------------------------------------------
  | GET OTHER PARTICIPANT
  |--------------------------------------------------------------------------
  */

  const otherUserId = chat && user ? getOtherParticipant(chat, user.uid) : null;
  const otherName = chat && otherUserId ? getParticipantName(chat, otherUserId) : "User";
  const otherPhoto = chat && otherUserId ? getParticipantPhoto(chat, otherUserId) : "";

  /*
  |--------------------------------------------------------------------------
  | CHAT CONTEXT
  |--------------------------------------------------------------------------
  */

  function getChatContext() {
    if (!chat) return null;
    if (chat.type === "job_application") {
      return {
        label: "Job Application",
        title: chat.jobTitle || "Job Application",
      };
    }
    if (chat.type === "product") {
      return {
        label: "Product",
        title: chat.productTitle || "Product Chat",
      };
    }
    return {
      label: "Direct Message",
      title: "Conversation",
    };
  }

  /*
  |--------------------------------------------------------------------------
  | FORMAT TIME
  |--------------------------------------------------------------------------
  */

  function formatMessageTime(timestamp: { seconds: number; nanoseconds?: number } | null | undefined): string {
    if (!timestamp) return "";
    return new Date(timestamp.seconds * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatMessageDate(timestamp: { seconds: number; nanoseconds?: number } | null | undefined): string {
    if (!timestamp) return "";
    const date = new Date(timestamp.seconds * 1000);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString([], {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  /*
  |--------------------------------------------------------------------------
  | MESSAGE ACTIONS
  |--------------------------------------------------------------------------
  */

  function handleMessagePressStart(message: Message) {
    longPressTimerRef.current = setTimeout(() => {
      setSelectedMessage(message);
    }, 600);
  }

  function handleMessagePressEnd() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  async function handleDeleteForMe() {
    if (!selectedMessage || !user || !chatId) return;
    try {
      await deleteMessageForMe(chatId, selectedMessage.id, user.uid);
      setSelectedMessage(null);
    } catch (error) {
      console.error("Unable to delete message for me:", error);
      setSendError("Unable to delete this message. Please try again.");
    }
  }

  async function handleDeleteForEveryone() {
    if (!selectedMessage || !user || !chatId) return;
    try {
      await deleteMessageForEveryone(chatId, selectedMessage.id, user.uid);
      setSelectedMessage(null);
    } catch (error) {
      console.error("Unable to delete message for everyone:", error);
      setSendError("Unable to delete this message for everyone.");
    }
  }

  async function handleReportMessage() {
    if (!selectedMessage || !user || !chatId) return;
    try {
      await reportMessage(chatId, selectedMessage.id, user.uid, "Reported from chat");
      setSelectedMessage(null);
      setSendError("Message reported successfully.");
    } catch (error) {
      console.error("Unable to report message:", error);
      setSendError("Unable to report this message. Please try again.");
    }
  }

  async function handleForwardMessage(targetChatId: string) {
    if (!forwardingMessage || !user) return;
    try {
      await forwardChatMessage({
        sourceChatId: chatId,
        targetChatId,
        senderId: user.uid,
        senderName: user.displayName || user.email || "User",
        originalMessage: {
          ...forwardingMessage,
          messageId: forwardingMessage.id,
        },
      });
      setForwardingMessage(null);
      setSendError("Message forwarded successfully.");
    } catch (error) {
      console.error("Unable to forward message:", error);
      setSendError("Unable to forward this message. Please try again.");
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
          <Loader2 size={32} className="animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading conversation...</p>
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
        <MessageCircle size={48} className="text-muted-foreground" />
        <div className="text-center">
          <h2 className="font-bold text-lg">Unable to open chat</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">{error}</p>
        </div>
        <Button onClick={() => setLocation("/chats")}>Back to Messages</Button>
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Conversation unavailable.</p>
      </div>
    );
  }

  const showProductPreview = chat.type === "product" && cameFromProductReply && showProductAttachment && !!chat.productTitle;
  const chatContext = getChatContext();

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
          onClick={() => setLocation("/chats")}
          className="p-1 -ml-1 rounded-lg hover:bg-muted transition-colors"
          aria-label="Back to messages"
        >
          <ChevronLeft size={22} />
        </button>

        {otherPhoto ? (
          <img
            src={otherPhoto}
            alt={otherName}
            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <User size={20} className="text-primary" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p data-testid="text-chat-header-name" className="font-bold text-sm truncate">
            {otherName}
          </p>

          {chatContext && (
            chat.type === "job_application" && chat.jobId ? (
              <Link href={`/jobs/${chat.jobId}`} className="text-xs text-primary truncate block">
                {chatContext.label} · {chatContext.title}
              </Link>
            ) : chat.type === "product" && chat.productId ? (
              <Link href={`/product/${chat.productId}`} className="text-xs text-primary truncate block" data-testid="link-product">
                {chatContext.label} · {chatContext.title}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">{chatContext.label}</span>
            )
          )}
        </div>
      </header>

      {/* ================================================================
          MESSAGES
      ================================================================ */}

      <div
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 bg-muted/30"
      >
        {/* Load More Button */}
        {hasMoreMessages && initialMessagesLoaded && (
          <div className="flex justify-center my-2">
            <button
              type="button"
              onClick={loadMoreMessages}
              disabled={loadingMore}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors disabled:opacity-50"
            >
              {loadingMore ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <ChevronUp size={14} />
                  Load older messages
                </>
              )}
            </button>
          </div>
        )}

        <div ref={topRef} />

        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            {chat.type === "job_application" ? (
              <Briefcase size={40} className="text-muted-foreground" />
            ) : (
              <MessageCircle size={40} className="text-muted-foreground" />
            )}
            <p className="text-muted-foreground text-sm text-center">
              {chat.type === "job_application"
                ? "Start the conversation about this job application."
                : "Send a message to start the conversation."}
            </p>
          </div>
        ) : (
          messages.map((message, index) => {
            const isMine = message.senderId === user.uid;
            const currentDate = formatMessageDate(message.createdAt);
            const previousDate = index > 0 ? formatMessageDate(messages[index - 1].createdAt) : null;
            const showDateSeparator = currentDate !== previousDate;

            return (
              <div key={message.id}>
                {showDateSeparator && (
                  <div className="flex items-center justify-center my-4">
                    <span className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-[11px] font-medium">
                      {currentDate}
                    </span>
                  </div>
                )}

                <div
                  data-testid={`message-${message.id}`}
                  className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    onTouchStart={() => {
                      if (!message.deletedForEveryone) {
                        handleMessagePressStart(message);
                      }
                    }}
                    onTouchEnd={handleMessagePressEnd}
                    onTouchCancel={handleMessagePressEnd}
                    onMouseDown={() => {
                      if (!message.deletedForEveryone) {
                        handleMessagePressStart(message);
                      }
                    }}
                    onMouseUp={handleMessagePressEnd}
                    onMouseLeave={handleMessagePressEnd}
                    className={`max-w-[78%] px-4 py-2.5 rounded-2xl select-none ${
                      isMine
                        ? "bg-primary text-white rounded-br-md"
                        : "bg-muted border border-border rounded-bl-md"
                    }`}
                    style={{
                      WebkitUserSelect: "none",
                      userSelect: "none",
                      WebkitTouchCallout: "none",
                    }}
                  >
                    {!isMine && (
                      <p className="text-[10px] font-bold mb-1 opacity-70">
                        {message.senderName || getParticipantName(chat, message.senderId)}
                      </p>
                    )}
                    {message.forwarded && !message.deletedForEveryone && (
                      <p className="text-[10px] italic opacity-60 mb-1">↪ Forwarded</p>
                    )}

                    {message.replyTo && !message.deletedForEveryone && (
                      <div className="mb-2 border-l-2 border-primary/60 bg-black/5 dark:bg-white/5 rounded-r-md px-2 py-1.5">
                        <p className="text-[10px] font-semibold text-primary truncate">
                          {message.replyTo.senderId === user.uid
                            ? "You"
                            : message.replyTo.senderName || getParticipantName(chat, message.replyTo.senderId)}
                        </p>
                        <p className="text-xs opacity-70 truncate">{message.replyTo.text}</p>
                      </div>
                    )}

                    {message.productContext && !message.deletedForEveryone && (
                      <div className="mb-2 flex items-center gap-2 bg-black/5 dark:bg-white/5 rounded-lg px-2 py-1.5">
                        {message.productContext.productImage ? (
                          <img
                            src={getChatThumbnailUrl(message.productContext.productImage)}
                            alt={message.productContext.productTitle}
                            className="w-8 h-8 rounded object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-primary">
                            {message.productContext.productTitle.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <p className="text-xs font-semibold truncate">{message.productContext.productTitle}</p>
                      </div>
                    )}

                    <p
                      className={`text-sm leading-relaxed break-words whitespace-pre-wrap ${
                        message.deletedForEveryone ? "italic opacity-60" : ""
                      }`}
                    >
                      {message.deletedForEveryone ? "🚫 This message was deleted." : message.text}
                    </p>

                    {!message.deletedForEveryone && (
                      <div className={`flex items-center gap-1 mt-1 ${isMine ? "justify-end" : "justify-start"}`}>
                        <p className={`text-[10px] ${isMine ? "text-white/60" : "text-muted-foreground"}`}>
                          {formatMessageTime(message.createdAt)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        <div ref={bottomRef} />
      </div>

      {/* ================================================================
          MESSAGE ACTION MENU
      ================================================================ */}

      {selectedMessage && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => setSelectedMessage(null)}
        >
          <div
            className="w-full max-w-md bg-card rounded-t-2xl p-2 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="w-full text-left px-4 py-3 rounded-xl hover:bg-muted transition-colors"
              onClick={() => {
                setReplyingTo(selectedMessage);
                setSelectedMessage(null);
                inputRef.current?.focus();
              }}
            >
              ↩️ Reply
            </button>

            <button
              type="button"
              className="w-full text-left px-4 py-3 rounded-xl hover:bg-muted transition-colors"
              onClick={() => {
                setForwardingMessage(selectedMessage);
                setSelectedMessage(null);
              }}
            >
              ➡️ Forward
            </button>

            <button
              type="button"
              className="w-full text-left px-4 py-3 rounded-xl hover:bg-muted transition-colors"
              onClick={() => {
                navigator.clipboard.writeText(selectedMessage.text);
                setSelectedMessage(null);
              }}
            >
              📋 Copy
            </button>

            {selectedMessage.senderId === user.uid && (
              <button
                type="button"
                className="w-full text-left px-4 py-3 rounded-xl hover:bg-muted transition-colors text-destructive"
                onClick={handleDeleteForMe}
              >
                🗑️ Delete for me
              </button>
            )}

            {selectedMessage.senderId === user.uid && (
              <button
                type="button"
                className="w-full text-left px-4 py-3 rounded-xl hover:bg-muted transition-colors text-destructive"
                onClick={handleDeleteForEveryone}
              >
                🗑️ Delete for everyone
              </button>
            )}

            {selectedMessage.senderId !== user.uid && (
              <button
                type="button"
                className="w-full text-left px-4 py-3 rounded-xl hover:bg-muted transition-colors text-destructive"
                onClick={handleReportMessage}
              >
                🚩 Report
              </button>
            )}

            <button
              type="button"
              className="w-full text-left px-4 py-3 rounded-xl hover:bg-muted transition-colors font-medium"
              onClick={() => setSelectedMessage(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ================================================================
          FORWARD MODAL - PAGINATED
      ================================================================ */}

      {forwardingMessage && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => setForwardingMessage(null)}
        >
          <div
            className="w-full max-w-md bg-card rounded-t-2xl p-4 shadow-xl max-h-[80vh] flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <h3 className="font-bold text-base">Forward message</h3>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-lg"
                onClick={() => setForwardingMessage(null)}
                aria-label="Cancel forwarding"
              >
                ×
              </button>
            </div>

            <div className="mb-4 p-3 rounded-xl bg-muted flex-shrink-0">
              <p className="text-xs text-muted-foreground mb-1">Message to forward</p>
              <p className="text-sm break-words">{forwardingMessage.text}</p>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1">
              {forwardChatsLoading && forwardChats.length === 0 ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-primary" />
                </div>
              ) : forwardChats.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No other conversations available.
                </p>
              ) : (
                <>
                  {forwardChats.map((forwardChat) => {
                    const recipientId = forwardChat.participants?.find((uid) => uid !== user.uid);
                    const recipientName = recipientId ? getParticipantName(forwardChat, recipientId) : "Conversation";
                    const recipientPhoto = recipientId ? getParticipantPhoto(forwardChat, recipientId) : "";

                    return (
                      <button
                        key={forwardChat.id}
                        type="button"
                        className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted transition-colors text-left"
                        onClick={() => handleForwardMessage(forwardChat.id)}
                      >
                        {recipientPhoto ? (
                          <img
                            src={recipientPhoto}
                            alt={recipientName}
                            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <User size={18} className="text-primary" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{recipientName}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {forwardChat.type === "product"
                              ? forwardChat.productTitle || "Product Chat"
                              : forwardChat.type === "job_application"
                              ? forwardChat.jobTitle || "Job Application"
                              : "Direct Message"}
                          </p>
                        </div>
                      </button>
                    );
                  })}

                  {hasMoreChats && (
                    <div className="flex justify-center py-2">
                      <button
                        type="button"
                        onClick={() => loadForwardChats(true)}
                        disabled={forwardChatsLoading}
                        className="text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
                      >
                        {forwardChatsLoading ? "Loading..." : "Load more conversations"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================
          SEND ERROR
      ================================================================ */}

      {sendError && (
        <div className="flex-shrink-0 px-4 py-2 bg-destructive/10 border-t border-destructive/20">
          <p className="text-xs text-destructive text-center">{sendError}</p>
        </div>
      )}

      {/* ================================================================
          PRODUCT PREVIEW
      ================================================================ */}

      {showProductPreview && (
        <div className="flex-shrink-0 px-4 py-2 bg-card border-t border-border">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2 border-l-2 border-primary pl-3">
              {chat.productImage ? (
                <img
                  src={getChatThumbnailUrl(chat.productImage)}
                  alt={chat.productTitle}
                  className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-primary">
                  {chat.productTitle?.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-primary">Replying about</p>
                <p className="text-xs text-muted-foreground truncate">{chat.productTitle}</p>
              </div>
            </div>
            <button
              type="button"
              className="flex-shrink-0 text-muted-foreground hover:text-foreground text-lg"
              onClick={() => setShowProductAttachment(false)}
              aria-label="Remove advert attachment"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ================================================================
          REPLY PREVIEW
      ================================================================ */}

      {replyingTo && (
        <div className="flex-shrink-0 px-4 py-2 bg-card border-t border-border">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 border-l-2 border-primary pl-3">
              <p className="text-xs font-semibold text-primary">
                Replying to{" "}
                {replyingTo.senderId === user.uid
                  ? "yourself"
                  : replyingTo.senderName || getParticipantName(chat, replyingTo.senderId)}
              </p>
              <p className="text-xs text-muted-foreground truncate">{replyingTo.text}</p>
            </div>
            <button
              type="button"
              className="flex-shrink-0 text-muted-foreground hover:text-foreground text-lg"
              onClick={() => setReplyingTo(null)}
              aria-label="Cancel reply"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ================================================================
          MESSAGE INPUT
      ================================================================ */}

      <form
        onSubmit={handleSendMessage}
        className="flex-shrink-0 flex items-center gap-2 px-4 py-3 bg-card border-t border-border"
        style={{
          paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))",
        }}
      >
        <Input
          ref={inputRef}
          data-testid="input-message"
          placeholder="Type a message..."
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="flex-1 h-11 rounded-full"
          autoComplete="off"
          disabled={sending}
          maxLength={5000}
        />

        <Button
          data-testid="button-send"
          type="submit"
          size="icon"
          className="h-11 w-11 rounded-full flex-shrink-0"
          disabled={sending || !text.trim()}
          aria-label="Send message"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </Button>
      </form>
    </div>
  );
            }
