import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

import {
  Briefcase,
  Loader2,
  MessageCircle,
  Search,
  User,
  X,
} from "lucide-react";

import { BottomNav } from "@/components/BottomNav";

import {
  getParticipantName,
  getParticipantPhoto,
  deleteChatForMe,
  toggleMuteChat,
  type ChatData,
} from "@/lib/chatService";

/*
|--------------------------------------------------------------------------
| CHAT LIST ITEM
|--------------------------------------------------------------------------
*/

interface ChatListItem extends ChatData {
  id: string;
}

function getChatThumbnailUrl(url: string): string {
  if (!url) return "";
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", "/upload/f_auto,q_auto,w_128,h_128,c_fill/");
  }
  return url;
}

/*
|--------------------------------------------------------------------------
| FORMAT CHAT TIME
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
  if (!ts?.seconds) {
    return "";
  }

  const date = new Date(ts.seconds * 1000);
  const now = new Date();

  const diffMs = now.getTime() - date.getTime();

  // Future timestamps can happen because of serverTimestamp().
  if (diffMs < 0) {
    return "";
  }

  const diffDays = Math.floor(diffMs / 86400000);

  // Today
  if (diffDays === 0) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Yesterday
  if (diffDays === 1) {
    return "Yesterday";
  }

  // This week
  if (diffDays < 7) {
    return date.toLocaleDateString([], {
      weekday: "short",
    });
  }

  // Older
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

/*
|--------------------------------------------------------------------------
| GET OTHER PARTICIPANT
|--------------------------------------------------------------------------
*/

function getOtherParticipantId(
  chat: ChatListItem,
  currentUserId: string
): string | null {
  if (!Array.isArray(chat.participants)) {
    return null;
  }

  return (
    chat.participants.find(
      (uid) => uid !== currentUserId
    ) || null
  );
}

/*
|--------------------------------------------------------------------------
| GET CHAT DISPLAY NAME
|--------------------------------------------------------------------------
*/

function getChatDisplayName(
  chat: ChatListItem,
  currentUserId: string
): string {
  const otherUserId = getOtherParticipantId(
    chat,
    currentUserId
  );

  if (!otherUserId) {
    return "User";
  }

  return (
    getParticipantName(
      chat,
      otherUserId
    ) || "User"
  );
}

/*
|--------------------------------------------------------------------------
| GET CHAT DISPLAY PHOTO
|--------------------------------------------------------------------------
*/

function getChatDisplayPhoto(
  chat: ChatListItem,
  currentUserId: string
): string {
  const otherUserId = getOtherParticipantId(
    chat,
    currentUserId
  );

  if (!otherUserId) {
    return "";
  }

  return (
    getParticipantPhoto(
      chat,
      otherUserId
    ) || ""
  );
}

/*
|--------------------------------------------------------------------------
| GET CHAT CONTEXT
|--------------------------------------------------------------------------
*/

function getChatContext(
  chat: ChatListItem
): string {
  if (chat.type === "job_application") {
    return `Job Application · ${
      chat.jobTitle || "Job"
    }`;
  }

  if (chat.type === "product") {
    return (
      chat.productTitle ||
      "Product Chat"
    );
  }

  return "Direct Message";
}

/*
|--------------------------------------------------------------------------
| GET LAST MESSAGE PREFIX
|--------------------------------------------------------------------------
*/

function getLastMessagePrefix(
  chat: ChatListItem,
  currentUserId: string
): string {
  if (
    chat.lastSenderId &&
    chat.lastSenderId === currentUserId
  ) {
    return "You: ";
  }

  return "";
}

/*
|--------------------------------------------------------------------------
| CHAT AVATAR
|--------------------------------------------------------------------------
*/

function ChatAvatar({
  chat,
  photoURL,
}: {
  chat: ChatListItem;
  photoURL: string;
}) {
  const [imageError, setImageError] =
    useState(false);

  /*
  |--------------------------------------------------------------------------
  | JOB APPLICATION
  |--------------------------------------------------------------------------
  */

  if (chat.type === "job_application") {
    return (
      <div className="relative w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Briefcase
          size={21}
          className="text-primary"
        />

        <span className="absolute -right-0.5 -bottom-0.5 w-3.5 h-3.5 rounded-full bg-primary border-2 border-background" />
      </div>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | PROFILE PHOTO
  |--------------------------------------------------------------------------
  */

  if (photoURL && !imageError) {
    return (
      <img
        src={getChatThumbnailUrl(photoURL)}
        alt=""
        loading="lazy"
        onError={() =>
          setImageError(true)
        }
        className="w-12 h-12 rounded-full object-cover flex-shrink-0 bg-muted"
      />
    );
  }

  /*
  |--------------------------------------------------------------------------
  | DIRECT CHAT FALLBACK
  |--------------------------------------------------------------------------
  */

  if (chat.type === "direct") {
    return (
      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        <User
          size={21}
          className="text-primary"
        />
      </div>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | DEFAULT CHAT FALLBACK
  |--------------------------------------------------------------------------
  */

  return (
    <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
      <MessageCircle
        size={21}
        className="text-muted-foreground"
      />
    </div>
  );
}

/*
|--------------------------------------------------------------------------
| CHAT LIST COMPONENT
|--------------------------------------------------------------------------
*/

export default function ChatList() {
  const [, setLocation] =
    useLocation();

  const { user } = useAuth();

  const [chats, setChats] =
    useState<ChatListItem[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [searchQuery, setSearchQuery] =
    useState("");
  const [selectedChat, setSelectedChat] =
    useState<ChatListItem | null>(null);

  const longPressTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const suppressClickRef =
    useRef(false);

  function handleChatPressStart(
    chat: ChatListItem
  ) {
    longPressTimerRef.current =
      setTimeout(() => {
        suppressClickRef.current = true;
        setSelectedChat(chat);
      }, 600);
  }

  function handleChatPressEnd() {
    if (longPressTimerRef.current) {
      clearTimeout(
        longPressTimerRef.current
      );
      longPressTimerRef.current = null;
    }
  }

  /*
  |--------------------------------------------------------------------------
  | LOAD USER CHATS
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setLocation("/login");
      return;
    }

    setLoading(true);
    setError("");

    const chatsQuery = query(
      collection(db, "chats"),
      where(
        "participants",
        "array-contains",
        user.uid
      ),
      orderBy(
        "lastMessageAt",
        "desc"
      )
    );

    const loadedChats =
            snap.docs
              .map(
                (chatDoc) =>
                  ({
                    id: chatDoc.id,
                    ...chatDoc.data(),
                  } as ChatListItem)
              )
              .filter(
                (chat) =>
                  !chat.deletedFor?.includes(
                    user.uid
                  )
              );

          setChats(loadedChats);
          setLoading(false);
        },
        (firebaseError) => {
          console.error(
            "Error loading chats:",
            firebaseError
          );

          setError(
            "We couldn't load your messages. Please try again."
          );

          setLoading(false);
        }
      );

    return unsubscribe;
  }, [user, setLocation]);

  /*
  |--------------------------------------------------------------------------
  | TOTAL UNREAD
  |--------------------------------------------------------------------------
  */

  const totalUnread = useMemo(() => {
    if (!user) {
      return 0;
    }

    return chats.reduce(
      (total, chat) =>
        total +
        (chat.unreadCount?.[
          user.uid
        ] || 0),
      0
    );
  }, [chats, user]);

  /*
  |--------------------------------------------------------------------------
  | FILTER CHATS
  |--------------------------------------------------------------------------
  */

  const filteredChats = useMemo(() => {
    const search = searchQuery
      .trim()
      .toLowerCase();

    if (!search || !user) {
      return chats;
    }

    return chats.filter((chat) => {
      const name =
        getChatDisplayName(
          chat,
          user.uid
        ).toLowerCase();

      const context =
        getChatContext(
          chat
        ).toLowerCase();

      const lastMessage =
        (
          chat.lastMessage || ""
        ).toLowerCase();

      return (
        name.includes(search) ||
        context.includes(search) ||
        lastMessage.includes(search)
      );
    });
  }, [
    chats,
    searchQuery,
    user,
  ]);

  /*
  |--------------------------------------------------------------------------
  | LOADING SCREEN
  |--------------------------------------------------------------------------
  */

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="sticky top-0 z-40 bg-card/95 backdrop-blur border-b border-border px-4 h-14 flex items-center">
          <h1 className="font-black text-lg">
            Messages
          </h1>
        </header>

        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2
              size={24}
              className="animate-spin text-primary"
            />
          </div>

          <p className="text-sm text-muted-foreground">
            Loading your messages...
          </p>
        </div>

        <BottomNav />
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
      <div className="min-h-screen bg-background pb-20">
        <header className="sticky top-0 z-40 bg-card/95 backdrop-blur border-b border-border px-4 h-14 flex items-center">
          <h1 className="font-black text-lg">
            Messages
          </h1>
        </header>

        <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <MessageCircle
              size={30}
              className="text-muted-foreground"
            />
          </div>

          <p className="font-bold text-lg">
            Messages aren't available
          </p>

          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            {error}
          </p>

          <button
            type="button"
            onClick={() =>
              window.location.reload()
            }
            className="mt-5 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold active:scale-95 transition-transform"
          >
            Try Again
          </button>
        </div>

        <BottomNav />
      </div>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | MAIN UI
  |--------------------------------------------------------------------------
  */

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* ================================================================ */}
      {/* HEADER */}
      {/* ================================================================ */}

      <header className="sticky top-0 z-40 bg-card/95 backdrop-blur border-b border-border">
        <div className="px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="font-black text-lg">
              Messages
            </h1>

            {totalUnread > 0 && (
              <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                {totalUnread > 99
                  ? "99+"
                  : totalUnread}
              </span>
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/* SEARCH */}
        {/* ============================================================ */}

        {chats.length > 0 && (
          <div className="px-4 pb-3">
            <div className="relative">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />

              <input
                type="text"
                value={searchQuery}
                onChange={(event) =>
                  setSearchQuery(
                    event.target.value
                  )
                }
                placeholder="Search messages..."
                aria-label="Search messages"
                className="w-full h-10 pl-10 pr-10 rounded-xl bg-muted/70 border border-transparent focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 text-sm"
              />

              {searchQuery && (
                <button
                  type="button"
                  onClick={() =>
                    setSearchQuery("")
                  }
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center hover:bg-background active:scale-95 transition"
                >
                  <X
                    size={16}
                    className="text-muted-foreground"
                  />
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ================================================================ */}
      {/* EMPTY STATE */}
      {/* ================================================================ */}

      {chats.length === 0 ? (
        <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center">
          <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-5">
            <MessageCircle
              size={38}
              className="text-primary"
            />
          </div>

          <p className="font-black text-xl">
            No messages yet
          </p>

          <p className="text-muted-foreground text-sm mt-2 max-w-xs leading-6">
            Your conversations with
            buyers, sellers, employers,
            and other BizMtaani users
            will appear here.
          </p>

          <p className="text-xs text-muted-foreground mt-4">
            Start a conversation from a
            product, job, or user profile.
          </p>
        </div>
      ) : filteredChats.length === 0 ? (
        /*
        |--------------------------------------------------------------------------
        | NO SEARCH RESULTS
        |--------------------------------------------------------------------------
        */

        <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Search
              size={28}
              className="text-muted-foreground"
            />
          </div>

          <p className="font-bold text-lg">
            No conversations found
          </p>

          <p className="text-sm text-muted-foreground mt-2">
            Try searching for another name
            or conversation.
          </p>

          <button
            type="button"
            onClick={() =>
              setSearchQuery("")
            }
            className="mt-4 text-sm font-bold text-primary"
          >
            Clear search
          </button>
        </div>
      ) : (
        /*
        |--------------------------------------------------------------------------
        | CHAT LIST
        |--------------------------------------------------------------------------
        */

        <div className="divide-y divide-border">
          {filteredChats.map((chat) => {
            if (!user) {
              return null;
            }

            const otherUserName =
              getChatDisplayName(
                chat,
                user.uid
              );

            const otherUserPhoto =
              getChatDisplayPhoto(
                chat,
                user.uid
              );

            const context =
              getChatContext(chat);

            const unread =
              chat.unreadCount?.[
                user.uid
              ] || 0;

            const messagePrefix =
              getLastMessagePrefix(
                chat,
                user.uid
              );

            return (
              <Link
                key={chat.id}
                href={`/chat/${chat.id}`}
                data-testid={`chat-item-${chat.id}`}
                onClick={(event) => {
                  if (suppressClickRef.current) {
                    event.preventDefault();
                    suppressClickRef.current = false;
                  }
                }}
                onContextMenu={(event) =>
                  event.preventDefault()
                }
                onTouchStart={() =>
                  handleChatPressStart(chat)
                }
                onTouchEnd={handleChatPressEnd}
                onTouchCancel={handleChatPressEnd}
                onMouseDown={() =>
                  handleChatPressStart(chat)
                }
                onMouseUp={handleChatPressEnd}
                onMouseLeave={handleChatPressEnd}
                style={{
                  WebkitUserSelect: "none",
                  userSelect: "none",
                  WebkitTouchCallout: "none",
                }}
                className={`group flex items-center gap-3 px-4 py-3.5 min-h-[76px] active:bg-muted/70 hover:bg-muted/40 transition-colors select-none ${
                  unread > 0
                    ? "bg-primary/[0.04]"
                    : ""
                }`}
              >
                {/* ================================================== */}
                {/* AVATAR */}
                {/* ================================================== */}

                <ChatAvatar
                  chat={chat}
                  photoURL={
                    otherUserPhoto
                  }
                />

                {/* ================================================== */}
                {/* CHAT CONTENT */}
                {/* ================================================== */}

                <div className="flex-1 min-w-0">
                  {/* ============================================== */}
                  {/* NAME + TIME */}
                  {/* ============================================== */}

                  <div className="flex items-center justify-between gap-2">
                    <p
                      data-testid={`text-chat-party-${chat.id}`}
                      className={`text-sm truncate ${
                        unread > 0
                          ? "font-black"
                          : "font-bold"
                      }`}
                    >
                      {otherUserName}
                    </p>

                    <span
                      className={`text-[11px] flex-shrink-0 ${
                        unread > 0
                          ? "text-primary font-bold"
                          : "text-muted-foreground"
                      }`}
                    >
                      {formatTime(
                        chat.lastMessageAt
                      )}
                    </span>
                  </div>

                  {/* ============================================== */}
                  {/* CHAT CONTEXT */}
                  {/* ============================================== */}

                  <p
                    className={`text-xs truncate mt-0.5 ${
                      chat.type ===
                      "job_application"
                        ? "text-primary font-medium"
                        : "text-muted-foreground"
                    }`}
                  >
                    {context}
                  </p>

                  {/* ============================================== */}
                  {/* LAST MESSAGE */}
                  {/* ============================================== */}

                  <div className="flex items-center gap-2 mt-0.5">
                    <p
                      data-testid={`text-last-message-${chat.id}`}
                      className={`text-sm truncate flex-1 ${
                        unread > 0
                          ? "text-foreground font-semibold"
                          : "text-muted-foreground"
                      }`}
                    >
                      {messagePrefix}
                      {chat.lastMessage ||
                        "Start a conversation"}
                    </p>

                    {/* ========================================== */}
                    {/* UNREAD BADGE */}
                    {/* ========================================== */}

                    {unread > 0 && (
                      <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center flex-shrink-0">
                        {unread > 99
                          ? "99+"
                          : unread}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* ================================================================ */}
      {/* CHAT ACTION MENU */}
      {/* ================================================================ */}

      {selectedChat && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() =>
            setSelectedChat(null)
          }
        >
          <div
            className="w-full max-w-md bg-card rounded-t-2xl p-2 shadow-xl"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <button
              type="button"
              className="w-full text-left px-4 py-3 rounded-xl hover:bg-muted transition-colors"
              onClick={async () => {
                if (!user) return;

                await toggleMuteChat(
                  selectedChat.id,
                  user.uid,
                  !selectedChat.mutedFor?.includes(
                    user.uid
                  )
                );

                setSelectedChat(null);
              }}
            >
              {selectedChat.mutedFor?.includes(
                user?.uid || ""
              )
                ? "🔔 Unmute"
                : "🔕 Mute"}
            </button>

            <button
              type="button"
              className="w-full text-left px-4 py-3 rounded-xl hover:bg-muted transition-colors text-destructive"
              onClick={async () => {
                if (!user) return;

                await deleteChatForMe(
                  selectedChat.id,
                  user.uid
                );

                setSelectedChat(null);
              }}
            >
              🗑️ Delete conversation
            </button>

            <button
              type="button"
              className="w-full text-left px-4 py-3 rounded-xl hover:bg-muted transition-colors font-medium"
              onClick={() =>
                setSelectedChat(null)
              }
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* BOTTOM NAV */}
      {/* ================================================================ */}

      <BottomNav />
    </div>
  );
}
