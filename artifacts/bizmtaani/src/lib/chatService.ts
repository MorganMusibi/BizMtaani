import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

/*
|--------------------------------------------------------------------------
| TYPES
|--------------------------------------------------------------------------
*/

export type ChatType =
  | "direct"
  | "product"
  | "job_application";

export interface ChatParticipant {
  uid: string;
  name: string;
  photoURL?: string;
}

export interface ChatData {
  type: ChatType;
  participants: string[];

  participantNames?: Record<string, string>;
  participantPhotos?: Record<string, string>;

  productId?: string;
  productTitle?: string;
  productImage?: string;

  jobId?: string;
  jobTitle?: string;
  company?: string;

  lastMessage?: string;
  lastMessageAt?: Timestamp | null;
  lastSenderId?: string;

  unreadCount?: Record<string, number>;

  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface ChatMessage {
  senderId: string;
  senderName: string;
  text: string;
  createdAt?: Timestamp | null;
}

export interface StartChatResult {
  chatId: string;
  created: boolean;
}

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function sortedParticipants(
  uidA: string,
  uidB: string
): string[] {
  return [uidA, uidB].sort();
}

function createParticipantNames(
  users: ChatParticipant[]
): Record<string, string> {
  return Object.fromEntries(
    users.map((user) => [
      user.uid,
      user.name?.trim() || "User",
    ])
  );
}

function createParticipantPhotos(
  users: ChatParticipant[]
): Record<string, string> {
  return Object.fromEntries(
    users
      .filter((user) => Boolean(user.photoURL))
      .map((user) => [
        user.uid,
        user.photoURL!,
      ])
  );
}

function createUnreadCounts(
  users: ChatParticipant[]
): Record<string, number> {
  return Object.fromEntries(
    users.map((user) => [
      user.uid,
      0,
    ])
  );
}

function validateUsers(
  userA: ChatParticipant,
  userB: ChatParticipant
): void {
  if (!userA?.uid || !userB?.uid) {
    throw new Error(
      "Both chat participants are required."
    );
  }

  if (userA.uid === userB.uid) {
    throw new Error(
      "You cannot start a conversation with yourself."
    );
  }
}

function validateMessage(
  chatId: string,
  senderId: string,
  text: string
): string {
  if (!chatId || !senderId) {
    throw new Error(
      "Chat and sender are required."
    );
  }

  const cleanText = text.trim();

  if (!cleanText) {
    throw new Error(
      "Message cannot be empty."
    );
  }

  if (cleanText.length > 5000) {
    throw new Error(
      "Message cannot exceed 5000 characters."
    );
  }

  return cleanText;
}

/*
|--------------------------------------------------------------------------
| CHAT IDS
|--------------------------------------------------------------------------
*/

export function getDirectChatId(
  uidA: string,
  uidB: string
): string {
  const [a, b] =
    sortedParticipants(uidA, uidB);

  return `direct_${a}_${b}`;
}

export function getProductChatId(
  productId: string,
  uidA: string,
  uidB: string
): string {
  const [a, b] =
    sortedParticipants(uidA, uidB);

  return `product_${productId}_${a}_${b}`;
}

export function getJobChatId(
  jobId: string,
  uidA: string,
  uidB: string
): string {
  const [a, b] =
    sortedParticipants(uidA, uidB);

  return `job_${jobId}_${a}_${b}`;
}

/*
|--------------------------------------------------------------------------
| CREATE OR GET CHAT
|--------------------------------------------------------------------------
*/

async function createOrGetChat(
  chatId: string,
  chatData: Record<string, unknown>
): Promise<StartChatResult> {
  const chatRef =
    doc(db, "chats", chatId);

  const result =
    await runTransaction(
      db,
      async (transaction) => {
        const existingChat =
          await transaction.get(chatRef);

        if (existingChat.exists()) {
          return false;
        }

        transaction.set(
          chatRef,
          chatData
        );

        return true;
      }
    );

  return {
    chatId,
    created: result,
  };
}

/*
|--------------------------------------------------------------------------
| DIRECT CHAT
|--------------------------------------------------------------------------
*/

export async function startDirectChat(
  currentUser: ChatParticipant,
  otherUser: ChatParticipant
): Promise<StartChatResult> {
  validateUsers(
    currentUser,
    otherUser
  );

  const users = [
    currentUser,
    otherUser,
  ];

  const chatId =
    getDirectChatId(
      currentUser.uid,
      otherUser.uid
    );

  return createOrGetChat(
    chatId,
    {
      type: "direct",

      participants:
        sortedParticipants(
          currentUser.uid,
          otherUser.uid
        ),

      participantNames:
        createParticipantNames(users),

      participantPhotos:
        createParticipantPhotos(users),

      lastMessage: "",
      lastMessageAt: null,
      lastSenderId: "",

      unreadCount:
        createUnreadCounts(users),

      createdAt:
        serverTimestamp(),

      updatedAt:
        serverTimestamp(),
    }
  );
}

/*
|--------------------------------------------------------------------------
| PRODUCT CHAT
|--------------------------------------------------------------------------
*/

export async function startProductChat(params: {
  currentUser: ChatParticipant;
  seller: ChatParticipant;
  productId: string;
  productTitle: string;
  productImage?: string;
}): Promise<StartChatResult> {
  const {
    currentUser,
    seller,
    productId,
    productTitle,
    productImage,
  } = params;

  // Validate users
  validateUsers(currentUser, seller);

  // Validate product
  if (!productId) {
    throw new Error(
      "The product could not be identified."
    );
  }

  // The currently signed-in user MUST be one of the participants
  if (!currentUser.uid) {
    throw new Error(
      "You must be signed in to start a chat."
    );
  }

  // Create a deterministic chat ID
  const participants = sortedParticipants(
    currentUser.uid,
    seller.uid
  );

  const chatId = getProductChatId(
    productId,
    currentUser.uid,
    seller.uid
  );

  const chatRef = doc(
    db,
    "chats",
    chatId
  );

  // Check if chat already exists
  const existingChat = await getDoc(chatRef);

  if (existingChat.exists()) {
    const existingData =
      existingChat.data() as ChatData;

    // Make sure the existing chat is actually between
    // these two users
    const validParticipants =
      Array.isArray(existingData.participants) &&
      existingData.participants.length === 2 &&
      participants.every((uid) =>
        existingData.participants.includes(uid)
      );

    if (!validParticipants) {
      throw new Error(
        "A conflicting chat already exists for this product."
      );
    }

    return {
      chatId,
      created: false,
    };
  }

  const users = [
    currentUser,
    seller,
  ];

  // Create the chat
  await setDoc(chatRef, {
    type: "product",

    participants,

    participantNames:
      participantNames(users),

    participantPhotos:
      participantPhotos(users),

    productId,

    productTitle,

    productImage:
      productImage || "",

    lastMessage: "",

    lastMessageAt:
      null,

    lastSenderId: "",

    unreadCount:
      unreadCounts(users),

    createdAt:
      serverTimestamp(),

    updatedAt:
      serverTimestamp(),
  });

  return {
    chatId,
    created: true,
  };
}


/*
|--------------------------------------------------------------------------
| JOB APPLICATION CHAT
|--------------------------------------------------------------------------
*/

export async function startJobApplicationChat(
  params: {
    applicant: ChatParticipant;
    employer: ChatParticipant;
    jobId: string;
    jobTitle: string;
    company: string;
  }
): Promise<StartChatResult> {
  const {
    applicant,
    employer,
    jobId,
    jobTitle,
    company,
  } = params;

  validateUsers(
    applicant,
    employer
  );

  if (!jobId) {
    throw new Error(
      "The job could not be identified."
    );
  }

  const participants =
    sortedParticipants(
      applicant.uid,
      employer.uid
    );

  const chatId =
    getJobChatId(
      jobId,
      applicant.uid,
      employer.uid
    );

  const chatRef =
    doc(db, "chats", chatId);

  const messageRef =
    doc(
      collection(
        db,
        "chats",
        chatId,
        "messages"
      )
    );

  const initialMessage =
    `Hello, I'm interested in applying for the ${jobTitle} position at ${company}. I'd like to know more about the opportunity and how I can apply.`;

  const users = [
    applicant,
    employer,
  ];

  const created =
    await runTransaction(
      db,
      async (transaction) => {
        const existingChat =
          await transaction.get(chatRef);

        if (existingChat.exists()) {
          return false;
        }

        transaction.set(
          chatRef,
          {
            type: "job_application",

            participants,

            participantNames:
              createParticipantNames(users),

            participantPhotos:
              createParticipantPhotos(users),

            jobId,

            jobTitle:
              jobTitle?.trim() ||
              "Job",

            company:
              company?.trim() ||
              "",

            lastMessage:
              initialMessage,

            lastMessageAt:
              serverTimestamp(),

            lastSenderId:
              applicant.uid,

            unreadCount: {
              [applicant.uid]: 0,
              [employer.uid]: 1,
            },

            createdAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp(),
          }
        );

        transaction.set(
          messageRef,
          {
            senderId:
              applicant.uid,

            senderName:
              applicant.name?.trim() ||
              "User",

            text:
              initialMessage,

            createdAt:
              serverTimestamp(),
          }
        );

        return true;
      }
    );

  return {
    chatId,
    created,
  };
}

/*
|--------------------------------------------------------------------------
| SEND MESSAGE
|--------------------------------------------------------------------------
|
| Everything is handled in ONE Firestore transaction:
|
| 1. Verify chat exists
| 2. Verify sender is a participant
| 3. Create message
| 4. Update chat preview
| 5. Update lastMessageAt
| 6. Update lastSenderId
| 7. Increment recipient unread count
|
| This prevents unread counts and chat previews from
| becoming inconsistent when messages are sent quickly.
|
*/

export async function sendChatMessage(
  params: {
    chatId: string;
    senderId: string;
    senderName: string;
    text: string;
  }
): Promise<void> {
  const {
    chatId,
    senderId,
    senderName,
    text,
  } = params;

  const cleanText =
    validateMessage(
      chatId,
      senderId,
      text
    );

  const chatRef =
    doc(db, "chats", chatId);

  const messageRef =
    doc(
      collection(
        db,
        "chats",
        chatId,
        "messages"
      )
    );

  await runTransaction(
    db,
    async (transaction) => {
      const chatSnap =
        await transaction.get(
          chatRef
        );

      if (!chatSnap.exists()) {
        throw new Error(
          "This conversation no longer exists."
        );
      }

      const chat =
        chatSnap.data() as ChatData;

      if (
        !Array.isArray(
          chat.participants
        )
      ) {
        throw new Error(
          "This conversation has invalid participants."
        );
      }

      if (
        !chat.participants.includes(
          senderId
        )
      ) {
        throw new Error(
          "You are not a participant in this conversation."
        );
      }

      const recipientUid =
        chat.participants.find(
          (uid) =>
            uid !== senderId
        );

      if (!recipientUid) {
        throw new Error(
          "Unable to find the other participant."
        );
      }

      const currentUnread =
        chat.unreadCount || {};

      const recipientUnread =
        Number(
          currentUnread[
            recipientUid
          ] || 0
        );

      transaction.set(
        messageRef,
        {
          senderId,

          senderName:
            senderName?.trim() ||
            "User",

          text:
            cleanText,

          createdAt:
            serverTimestamp(),
        }
      );

      transaction.update(
        chatRef,
        {
          lastMessage:
            cleanText,

          lastMessageAt:
            serverTimestamp(),

          lastSenderId:
            senderId,

          unreadCount: {
            ...currentUnread,

            [senderId]: 0,

            [recipientUid]:
              recipientUnread + 1,
          },

          updatedAt:
            serverTimestamp(),
        }
      );
    }
  );
}

/*
|--------------------------------------------------------------------------
| MARK CHAT AS READ
|--------------------------------------------------------------------------
*/

export async function markChatAsRead(
  chatId: string,
  userId: string
): Promise<void> {
  if (!chatId || !userId) {
    return;
  }

  const chatRef =
    doc(db, "chats", chatId);

  await runTransaction(
    db,
    async (transaction) => {
      const chatSnap =
        await transaction.get(
          chatRef
        );

      if (!chatSnap.exists()) {
        return;
      }

      const chat =
        chatSnap.data() as ChatData;

      if (
        !Array.isArray(
          chat.participants
        ) ||
        !chat.participants.includes(
          userId
        )
      ) {
        throw new Error(
          "You are not a participant in this conversation."
        );
      }

      transaction.update(
        chatRef,
        {
          unreadCount: {
            ...(chat.unreadCount || {}),
            [userId]: 0,
          },

          updatedAt:
            serverTimestamp(),
        }
      );
    }
  );
}

/*
|--------------------------------------------------------------------------
| CHAT DISPLAY HELPERS
|--------------------------------------------------------------------------
*/

export function getOtherParticipant(
  chat: ChatData,
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

export function getParticipantName(
  chat: ChatData,
  uid: string
): string {
  return (
    chat.participantNames?.[uid] ||
    "User"
  );
}

export function getParticipantPhoto(
  chat: ChatData,
  uid: string
): string {
  return (
    chat.participantPhotos?.[uid] ||
    ""
  );
}
