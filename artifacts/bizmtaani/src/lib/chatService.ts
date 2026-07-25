import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  writeBatch,
  Timestamp,
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
  senderName?: string;
  text: string;

  createdAt?: Timestamp | null;

  deliveredAt?: Timestamp | null;

  readAt?: Timestamp | null;
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

function participantNames(
  users: ChatParticipant[]
): Record<string, string> {
  return Object.fromEntries(
    users.map((user) => [
      user.uid,
      user.name || "User",
    ])
  );
}

function participantPhotos(
  users: ChatParticipant[]
): Record<string, string> {
  return Object.fromEntries(
    users
      .filter((user) => user.photoURL)
      .map((user) => [
        user.uid,
        user.photoURL as string,
      ])
  );
}

function unreadCounts(
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
      "Both users are required."
    );
  }

  if (userA.uid === userB.uid) {
    throw new Error(
      "You cannot chat with yourself."
    );
  }
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
| START DIRECT CHAT
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

  const participants =
    sortedParticipants(
      currentUser.uid,
      otherUser.uid
    );

  const chatId =
    getDirectChatId(
      currentUser.uid,
      otherUser.uid
    );

  const chatRef =
    doc(db, "chats", chatId);

  const existingChat =
    await getDoc(chatRef);

  if (existingChat.exists()) {
    return {
      chatId,
      created: false,
    };
  }

  await setDoc(chatRef, {
    type: "direct",

    participants,

    participantNames:
      participantNames(users),

    participantPhotos:
      participantPhotos(users),

    lastMessage: "",

    lastMessageAt:
      serverTimestamp(),

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
| START PRODUCT CHAT
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

  validateUsers(
    currentUser,
    seller
  );

  if (!productId) {
    throw new Error(
      "The product could not be identified."
    );
  }

  const users = [
    currentUser,
    seller,
  ];

  const participants =
    sortedParticipants(
      currentUser.uid,
      seller.uid
    );

  const chatId =
    getProductChatId(
      productId,
      currentUser.uid,
      seller.uid
    );

  const chatRef =
    doc(db, "chats", chatId);

  const existingChat =
    await getDoc(chatRef);

  if (existingChat.exists()) {
    return {
      chatId,
      created: false,
    };
  }

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
      serverTimestamp(),

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
| START JOB APPLICATION CHAT
|--------------------------------------------------------------------------
*/

export async function startJobApplicationChat(params: {
  applicant: ChatParticipant;
  employer: ChatParticipant;
  jobId: string;
  jobTitle: string;
  company: string;
}): Promise<StartChatResult> {

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

  const existingChat =
    await getDoc(chatRef);

  if (existingChat.exists()) {
    return {
      chatId,
      created: false,
    };
  }

  const initialMessage =
    `Hello, I'm interested in applying for the ${jobTitle} position at ${company}. I'd like to know more about the opportunity and how I can apply.`;

  const users = [
    applicant,
    employer,
  ];

  const batch =
    writeBatch(db);

  batch.set(chatRef, {

    type: "job_application",

    participants,

    participantNames:
      participantNames(users),

    participantPhotos:
      participantPhotos(users),

    jobId,

    jobTitle,

    company,

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
  });

  const messageRef =
    doc(
      collection(
        db,
        "chats",
        chatId,
        "messages"
      )
    );

  batch.set(messageRef, {

    senderId:
      applicant.uid,

    senderName:
      applicant.name ||
      "Job Seeker",

    text:
      initialMessage,

    createdAt:
      serverTimestamp(),

    read: false,
  });

  await batch.commit();

  return {
    chatId,
    created: true,
  };
}

/*
|--------------------------------------------------------------------------
| SEND MESSAGE
|--------------------------------------------------------------------------
*/

export async function sendChatMessage(params: {
  chatId: string;
  senderId: string;
  senderName: string;
  text: string;
}): Promise<void> {

  const {
    chatId,
    senderId,
    senderName,
    text,
  } = params;

  const cleanText =
    text.trim();

  if (!chatId || !senderId) {
    throw new Error(
      "Chat and sender are required."
    );
  }

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

  const chatRef =
    doc(
      db,
      "chats",
      chatId
    );

  const chatSnap =
    await getDoc(chatRef);

  if (!chatSnap.exists()) {
    throw new Error(
      "This conversation no longer exists."
    );
  }

  const chat =
    chatSnap.data() as ChatData;

  if (
    !chat.participants?.includes(
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

  const unread =
    chat.unreadCount || {};

  const batch =
    writeBatch(db);

  const messageRef =
    doc(
      collection(
        db,
        "chats",
        chatId,
        "messages"
      )
    );

  batch.set(messageRef, {

    senderId,

    senderName:
      senderName ||
      "User",

    text:
      cleanText,

    createdAt:
      serverTimestamp(),

    read: false,
  });

  batch.update(chatRef, {

    lastMessage:
      cleanText,

    lastMessageAt:
      serverTimestamp(),

    lastSenderId:
      senderId,

    unreadCount: {
      ...unread,

      [senderId]: 0,

      [recipientUid]:
        (unread[recipientUid] || 0) + 1,
    },

    updatedAt:
      serverTimestamp(),
  });

  await batch.commit();
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
    doc(
      db,
      "chats",
      chatId
    );

  const chatSnap =
    await getDoc(chatRef);

  if (!chatSnap.exists()) {
    return;
  }

  const chat =
    chatSnap.data() as ChatData;

  if (
    !chat.participants?.includes(
      userId
    )
  ) {
    throw new Error(
      "You are not a participant in this conversation."
    );
  }

  await updateDoc(
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

/*
|--------------------------------------------------------------------------
| DISPLAY HELPERS
|--------------------------------------------------------------------------
*/

export function getOtherParticipant(
  chat: ChatData,
  currentUserId: string
): string | null {

  return (
    chat.participants?.find(
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
