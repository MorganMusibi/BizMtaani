import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
  writeBatch,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/*
|--------------------------------------------------------------------------
| CHAT TYPES
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

  /*
  |--------------------------------------------------------------------------
  | PRODUCT CONTEXT
  |--------------------------------------------------------------------------
  */

  productId?: string;
  productTitle?: string;
  productImage?: string;

  /*
  |--------------------------------------------------------------------------
  | JOB CONTEXT
  |--------------------------------------------------------------------------
  */

  jobId?: string;
  jobTitle?: string;
  company?: string;

  /*
  |--------------------------------------------------------------------------
  | LAST MESSAGE
  |--------------------------------------------------------------------------
  */

  lastMessage?: string;

  lastMessageAt?: Timestamp | null;

  lastSenderId?: string;

  /*
  |--------------------------------------------------------------------------
  | UNREAD COUNTS
  |--------------------------------------------------------------------------
  */

  unreadCount?: Record<string, number>;

  /*
  |--------------------------------------------------------------------------
  | TIMESTAMPS
  |--------------------------------------------------------------------------
  */

  createdAt?: Timestamp | null;

  updatedAt?: Timestamp | null;
}

export interface StartChatResult {
  chatId: string;
  created: boolean;
}

/*
|--------------------------------------------------------------------------
| NORMALISE PARTICIPANTS
|--------------------------------------------------------------------------
|
| Always sort user IDs.
|
| This ensures:
|
| User A → User B
|
| and
|
| User B → User A
|
| produce the same chat ID.
|
|--------------------------------------------------------------------------
*/

function sortedParticipants(
  uidA: string,
  uidB: string
): string[] {
  return [uidA, uidB].sort();
}

/*
|--------------------------------------------------------------------------
| CREATE DETERMINISTIC CHAT IDS
|--------------------------------------------------------------------------
*/

export function getDirectChatId(
  uidA: string,
  uidB: string
): string {
  const participants =
    sortedParticipants(uidA, uidB);

  return `direct_${participants[0]}_${participants[1]}`;
}

export function getProductChatId(
  productId: string,
  uidA: string,
  uidB: string
): string {
  const participants =
    sortedParticipants(uidA, uidB);

  return `product_${productId}_${participants[0]}_${participants[1]}`;
}

export function getJobChatId(
  jobId: string,
  uidA: string,
  uidB: string
): string {
  const participants =
    sortedParticipants(uidA, uidB);

  return `job_${jobId}_${participants[0]}_${participants[1]}`;
}

/*
|--------------------------------------------------------------------------
| CREATE PARTICIPANT MAPS
|--------------------------------------------------------------------------
*/

function createParticipantNames(
  participants: ChatParticipant[]
): Record<string, string> {
  return participants.reduce(
    (result, participant) => {
      result[participant.uid] =
        participant.name || "User";

      return result;
    },
    {} as Record<string, string>
  );
}

function createParticipantPhotos(
  participants: ChatParticipant[]
): Record<string, string> {
  return participants.reduce(
    (result, participant) => {
      if (participant.photoURL) {
        result[participant.uid] =
          participant.photoURL;
      }

      return result;
    },
    {} as Record<string, string>
  );
}

function createUnreadCounts(
  participants: ChatParticipant[]
): Record<string, number> {
  return participants.reduce(
    (result, participant) => {
      result[participant.uid] = 0;
      return result;
    },
    {} as Record<string, number>
  );
}

/*
|--------------------------------------------------------------------------
| START DIRECT CHAT
|--------------------------------------------------------------------------
|
| Used when one user wants to message another
| user directly.
|
|--------------------------------------------------------------------------
*/

export async function startDirectChat(
  currentUser: ChatParticipant,
  otherUser: ChatParticipant
): Promise<StartChatResult> {
  if (
    !currentUser.uid ||
    !otherUser.uid
  ) {
    throw new Error(
      "Both users are required to start a chat."
    );
  }

  if (
    currentUser.uid ===
    otherUser.uid
  ) {
    throw new Error(
      "You cannot message yourself."
    );
  }

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

  const participantObjects = [
    currentUser,
    otherUser,
  ];

  await setDoc(chatRef, {
    type: "direct",

    participants,

    participantNames:
      createParticipantNames(
        participantObjects
      ),

    participantPhotos:
      createParticipantPhotos(
        participantObjects
      ),

    lastMessage: "",

    lastMessageAt:
      serverTimestamp(),

    lastSenderId: "",

    unreadCount:
      createUnreadCounts(
        participantObjects
      ),

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
|
| Used when a user wants to contact the owner
| of a product/ad.
|
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

  if (!currentUser.uid) {
    throw new Error(
      "You must be logged in to start a chat."
    );
  }

  if (!seller.uid) {
    throw new Error(
      "The seller could not be identified."
    );
  }

  if (
    currentUser.uid === seller.uid
  ) {
    throw new Error(
      "You cannot chat with yourself."
    );
  }

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

  const participantObjects = [
    currentUser,
    seller,
  ];

  await setDoc(chatRef, {
    type: "product",

    participants,

    participantNames:
      createParticipantNames(
        participantObjects
      ),

    participantPhotos:
      createParticipantPhotos(
        participantObjects
      ),

    productId,

    productTitle,

    productImage:
      productImage || "",

    lastMessage: "",

    lastMessageAt:
      serverTimestamp(),

    lastSenderId: "",

    unreadCount:
      createUnreadCounts(
        participantObjects
      ),

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
|
| Creates a job application conversation.
|
| This also creates the applicant's initial
| application message.
|
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

  if (!applicant.uid) {
    throw new Error(
      "You must be logged in to apply."
    );
  }

  if (!employer.uid) {
    throw new Error(
      "The employer could not be identified."
    );
  }

  if (
    applicant.uid === employer.uid
  ) {
    throw new Error(
      "You cannot apply to your own job."
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

  /*
  |--------------------------------------------------------------------------
  | EXISTING APPLICATION CHAT
  |--------------------------------------------------------------------------
  |
  | Do not create another initial message.
  |
  |--------------------------------------------------------------------------
  */

  if (existingChat.exists()) {
    return {
      chatId,
      created: false,
    };
  }

  const applicantName =
    applicant.name ||
    "Job Seeker";

  const initialMessage =
    `Hello, I'm interested in applying for the ${jobTitle} position at ${company}. I'd like to know more about the opportunity and how I can apply.`;

  const participantObjects = [
    applicant,
    employer,
  ];

  /*
  |--------------------------------------------------------------------------
  | CREATE CHAT
  |--------------------------------------------------------------------------
  */

  await setDoc(chatRef, {
    type: "job_application",

    participants,

    participantNames:
      createParticipantNames(
        participantObjects
      ),

    participantPhotos:
      createParticipantPhotos(
        participantObjects
      ),

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

  /*
  |--------------------------------------------------------------------------
  | CREATE INITIAL APPLICATION MESSAGE
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
      senderId:
        applicant.uid,

      senderName:
        applicantName,

      text:
        initialMessage,

      createdAt:
        serverTimestamp(),

      read: false,
    }
  );

  return {
    chatId,
    created: true,
  };
}

/*
|--------------------------------------------------------------------------
| SEND MESSAGE
|--------------------------------------------------------------------------
|
| Sends a message and updates the chat preview.
|
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

  if (!cleanText) {
    throw new Error(
      "Message cannot be empty."
    );
  }

  const chatRef =
    doc(db, "chats", chatId);

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
      senderId,

      senderName,

      text: cleanText,

      createdAt:
        serverTimestamp(),

      read: false,
    }
  );

  /*
  |--------------------------------------------------------------------------
  | UPDATE UNREAD COUNT
  |--------------------------------------------------------------------------
  */

  const currentUnread =
    chat.unreadCount || {};

  const newUnreadCount = {
    ...currentUnread,

    [senderId]: 0,

    [recipientUid]:
      (currentUnread[
        recipientUid
      ] || 0) + 1,
  };

  /*
  |--------------------------------------------------------------------------
  | UPDATE CHAT PREVIEW
  |--------------------------------------------------------------------------
  */

  await updateDoc(
    chatRef,
    {
      lastMessage:
        cleanText,

      lastMessageAt:
        serverTimestamp(),

      lastSenderId:
        senderId,

      unreadCount:
        newUnreadCount,

      updatedAt:
        serverTimestamp(),
    }
  );
}

/*
|--------------------------------------------------------------------------
| MARK CHAT AS READ
|--------------------------------------------------------------------------
|
| Marks all messages from other participants as read
| and resets the current user's unread count.
|
|--------------------------------------------------------------------------
*/

export async function markChatAsRead(
  chatId: string,
  userId: string
): Promise<void> {
  const chatRef =
    doc(db, "chats", chatId);

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

  /*
  |--------------------------------------------------------------------------
  | GET MESSAGES
  |--------------------------------------------------------------------------
  */

  const messagesRef =
    collection(
      db,
      "chats",
      chatId,
      "messages"
    );

  /*
  |--------------------------------------------------------------------------
  | NOTE
  |--------------------------------------------------------------------------
  |
  | For now, the chat-level unread count is reset.
  |
  | Individual message read status can be updated
  | later if needed.
  |
  |--------------------------------------------------------------------------
  */

  const currentUnread =
    chat.unreadCount || {};

  const updatedUnread = {
    ...currentUnread,

    [userId]: 0,
  };

  await updateDoc(
    chatRef,
    {
      unreadCount:
        updatedUnread,

      updatedAt:
        serverTimestamp(),
    }
  );
}

/*
|--------------------------------------------------------------------------
| GET OTHER PARTICIPANT
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

/*
|--------------------------------------------------------------------------
| GET PARTICIPANT NAME
|--------------------------------------------------------------------------
*/

export function getParticipantName(
  chat: ChatData,
  uid: string
): string {
  return (
    chat.participantNames?.[
      uid
    ] ||
    "User"
  );
}

/*
|--------------------------------------------------------------------------
| GET PARTICIPANT PHOTO
|--------------------------------------------------------------------------
*/

export function getParticipantPhoto(
  chat: ChatData,
  uid: string
): string {
  return (
    chat.participantPhotos?.[
      uid
    ] ||
    ""
  );
}
