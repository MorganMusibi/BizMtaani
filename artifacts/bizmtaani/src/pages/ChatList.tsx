import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

import {
  MessageCircle,
  Loader2,
  Briefcase,
  User,
} from "lucide-react";

import { BottomNav } from "@/components/BottomNav";

import {
  getParticipantName,
  getParticipantPhoto,
  type ChatData,
} from "@/lib/chatService";

/*
|--------------------------------------------------------------------------
| CHAT LIST ITEM
|--------------------------------------------------------------------------
*/

interface ChatListItem
  extends ChatData {
  id: string;
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
  if (!ts) {
    return "";
  }

  const date =
    new Date(ts.seconds * 1000);

  const now =
    new Date();

  const diffMs =
    now.getTime() -
    date.getTime();

  const diffDays =
    Math.floor(
      diffMs / 86400000
    );

  /*
  |--------------------------------------------------------------------------
  | TODAY
  |--------------------------------------------------------------------------
  */

  if (diffDays === 0) {
    return date.toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    );
  }

  /*
  |--------------------------------------------------------------------------
  | YESTERDAY
  |--------------------------------------------------------------------------
  */

  if (diffDays === 1) {
    return "Yesterday";
  }

  /*
  |--------------------------------------------------------------------------
  | THIS WEEK
  |--------------------------------------------------------------------------
  */

  if (diffDays < 7) {
    return date.toLocaleDateString(
      [],
      {
        weekday: "short",
      }
    );
  }

  /*
  |--------------------------------------------------------------------------
  | OLDER
  |--------------------------------------------------------------------------
  */

  return date.toLocaleDateString(
    [],
    {
      month: "short",
      day: "numeric",
    }
  );
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
  if (
    !Array.isArray(
      chat.participants
    )
  ) {
    return null;
  }

  return (
    chat.participants.find(
      (uid) =>
        uid !== currentUserId
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
  const otherUserId =
    getOtherParticipantId(
      chat,
      currentUserId
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
| GET CHAT DISPLAY PHOTO
|--------------------------------------------------------------------------
*/

function getChatDisplayPhoto(
  chat: ChatListItem,
  currentUserId: string
): string {
  const otherUserId =
    getOtherParticipantId(
      chat,
      currentUserId
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
| GET CHAT CONTEXT LABEL
|--------------------------------------------------------------------------
*/

function getChatContext(
  chat: ChatListItem
): string {
  /*
  |--------------------------------------------------------------------------
  | JOB APPLICATION
  |--------------------------------------------------------------------------
  */

  if (
    chat.type ===
    "job_application"
  ) {
    return `Job Application · ${
      chat.jobTitle ||
      "Job"
    }`;
  }

  /*
  |--------------------------------------------------------------------------
  | PRODUCT CHAT
  |--------------------------------------------------------------------------
  */

  if (
    chat.type === "product"
  ) {
    return (
      chat.productTitle ||
      "Product Chat"
    );
  }

  /*
  |--------------------------------------------------------------------------
  | DIRECT CHAT
  |--------------------------------------------------------------------------
  */

  return "Direct Message";
}

/*
|--------------------------------------------------------------------------
| GET CHAT ICON
|--------------------------------------------------------------------------
*/

function ChatAvatar({
  chat,
  photoURL,
}: {
  chat: ChatListItem;
  photoURL: string;
}) {
  /*
  |--------------------------------------------------------------------------
  | JOB APPLICATION
  |--------------------------------------------------------------------------
  */

  if (
    chat.type ===
    "job_application"
  ) {
    return (
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Briefcase
          size={20}
          className="text-primary"
        />
      </div>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | USER PROFILE PHOTO
  |--------------------------------------------------------------------------
  */

  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt="User"
        className="w-12 h-12 rounded-full object-cover flex-shrink-0"
      />
    );
  }

  /*
  |--------------------------------------------------------------------------
  | DEFAULT USER ICON
  |--------------------------------------------------------------------------
  */

  if (
    chat.type === "direct"
  ) {
    return (
      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        <User
          size={20}
          className="text-primary"
        />
      </div>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | PRODUCT CHAT FALLBACK
  |--------------------------------------------------------------------------
  */

  if (
    chat.productImage
  ) {
    return (
      <img
        src={chat.productImage}
        alt={
          chat.productTitle ||
          "Product"
        }
        className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
      />
    );
  }

  /*
  |--------------------------------------------------------------------------
  | DEFAULT CHAT ICON
  |--------------------------------------------------------------------------
  */

  return (
    <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
      <MessageCircle
        size={20}
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

  const { user } =
    useAuth();

  const [chats, setChats] =
    useState<ChatListItem[]>(
      []
    );

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  /*
  |--------------------------------------------------------------------------
  | LOAD USER CHATS
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    /*
    |--------------------------------------------------------------------------
    | AUTHENTICATION CHECK
    |--------------------------------------------------------------------------
    */

    if (!user) {
      setLoading(false);
      setLocation("/login");
      return;
    }

    setLoading(true);
    setError("");

    /*
    |--------------------------------------------------------------------------
    | CHAT QUERY
    |--------------------------------------------------------------------------
    |
    | Finds every chat where the current user
    | is included in the participants array.
    |
    */

    const chatsQuery =
      query(
        collection(
          db,
          "chats"
        ),
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

    /*
    |--------------------------------------------------------------------------
    | REAL-TIME CHAT LISTENER
    |--------------------------------------------------------------------------
    */

    const unsubscribe =
      onSnapshot(
        chatsQuery,

        (snap) => {
          const loadedChats =
            snap.docs.map(
              (chatDoc) =>
                ({
                  id:
                    chatDoc.id,

                  ...chatDoc.data(),
                } as ChatListItem)
            );

          setChats(
            loadedChats
          );

          setLoading(false);
        },

        (firebaseError) => {
          console.error(
            "Error loading chats:",
            firebaseError
          );

          setError(
            firebaseError.message ||
              "Unable to load your messages."
          );

          setLoading(false);
        }
      );

    /*
    |--------------------------------------------------------------------------
    | CLEANUP
    |--------------------------------------------------------------------------
    */

    return unsubscribe;
  }, [
    user,
    setLocation,
  ]);

  /*
  |--------------------------------------------------------------------------
  | CALCULATE TOTAL UNREAD
  |--------------------------------------------------------------------------
  */

  const totalUnread =
    chats.reduce(
      (total, chat) => {
        if (!user) {
          return total;
        }

        return (
          total +
          (
            chat.unreadCount?.[
              user.uid
            ] || 0
          )
        );
      },
      0
    );

  /*
  |--------------------------------------------------------------------------
  | LOADING SCREEN
  |--------------------------------------------------------------------------
  */

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-20">

        <header className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center">
          <h1 className="font-black text-lg">
            Messages
          </h1>
        </header>

        <div className="flex flex-col items-center justify-center py-20 gap-3">

          <Loader2
            size={28}
            className="animate-spin text-primary"
          />

          <p className="text-sm text-muted-foreground">
            Loading messages...
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

        <header className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center">
          <h1 className="font-black text-lg">
            Messages
          </h1>
        </header>

        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">

          <MessageCircle
            size={40}
            className="text-muted-foreground mb-3"
          />

          <p className="font-bold text-lg">
            Unable to load messages
          </p>

          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            {error}
          </p>

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

      <header className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center justify-between">

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

      </header>

      {/* ================================================================ */}
      {/* EMPTY STATE */}
      {/* ================================================================ */}

      {chats.length === 0 ? (

        <div className="flex flex-col items-center justify-center py-24 gap-4 px-6">

          <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center">

            <MessageCircle
              size={36}
              className="text-muted-foreground"
            />

          </div>

          <div className="text-center">

            <p className="font-bold text-lg">
              No messages yet
            </p>

            <p className="text-muted-foreground text-sm mt-1 max-w-xs">
              When you chat with sellers, buyers, employers, or other users, your conversations will appear here.
            </p>

          </div>

        </div>

      ) : (

        /*
        |--------------------------------------------------------------------------
        | CHAT LIST
        |--------------------------------------------------------------------------
        */

        <div className="divide-y divide-border">

          {chats.map(
            (chat) => {

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
                getChatContext(
                  chat
                );

              const unread =
                chat.unreadCount?.[
                  user.uid
                ] || 0;

              return (
                <Link
                  key={chat.id}
                  href={`/chat/${chat.id}`}
                  data-testid={`chat-item-${chat.id}`}
                  className={`flex items-center gap-3 px-4 py-3.5 hover:bg-muted/50 transition-colors ${
                    unread > 0
                      ? "bg-primary/5"
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
                        className={`text-xs flex-shrink-0 ${
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

                    <p className="text-xs text-primary truncate mt-0.5">

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
                        {chat.lastMessage ||
                          "Start a conversation"}
                      </p>

                      {/* ========================================== */}
                      {/* UNREAD BADGE */}
                      {/* ========================================== */}

                      {unread > 0 && (
                        <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                          {unread > 99
                            ? "99+"
                            : unread}
                        </span>
                      )}

                    </div>

                  </div>

                </Link>
              );
            }
          )}

        </div>

      )}

      {/* ================================================================ */}
      {/* BOTTOM NAV */}
      {/* ================================================================ */}

      <BottomNav />

    </div>
  );
          }
