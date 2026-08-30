import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  serverTimestamp, 
  writeBatch, 
  Timestamp,
  query,
  where,
  limit,
  increment,
  arrayUnion,
  arrayRemove,
  runTransaction,
  DocumentReference,
  getCountFromServer
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, auth, functions } from "@/lib/firebase";

/*
|--------------------------------------------------------------------------
| TYPES
|--------------------------------------------------------------------------
*/

export type ChatType = "direct" | "product" | "job_application";

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
  mutedBy?: string[];
  deletedFor?: string[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  // ✅ Add last message preview for inbox
  lastMessagePreview?: string;
}

export interface StartChatResult {
  chatId: string;
  created: boolean;
}

export interface ReplyTo {
  messageId: string;
  senderId: string;
  senderName?: string;
  text: string;
}

export interface ChatMessage {
  messageId: string;
  senderId: string;
  senderName?: string;
  text: string;
  replyTo?: ReplyTo | null;
  productContext?: {
    productId: string;
    productTitle: string;
    productImage?: string;
  } | null;
  createdAt?: Timestamp | null;
  deletedFor?: string[];
  deletedForEveryone?: boolean;
  forwarded?: boolean;
  // ✅ Add read tracking
  readBy?: Record<string, boolean>;
  deliveredAt?: Timestamp | null;
  readAt?: Timestamp | null;
}

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function sortedParticipants(uidA: string, uidB: string): string[] {
  return [uidA, uidB].sort();
}

function participantNames(users: ChatParticipant[]): Record<string, string> {
  return Object.fromEntries(
    users.map((user) => [user.uid, user.name || "User"])
  );
}

function participantPhotos(users: ChatParticipant[]): Record<string, string> {
  return Object.fromEntries(
    users
      .filter((user) => user.photoURL)
      .map((user) => [user.uid, user.photoURL as string])
  );
}

function unreadCounts(users: ChatParticipant[]): Record<string, number> {
  return Object.fromEntries(
    users.map((user) => [user.uid, 0])
  );
}

function validateUsers(userA: ChatParticipant, userB: ChatParticipant): void {
  if (!userA?.uid || !userB?.uid) {
    throw new Error("Both users are required.");
  }
  if (userA.uid === userB.uid) {
    throw new Error("You cannot chat with yourself.");
  }
}

/*
|--------------------------------------------------------------------------
| CHAT ID
|--------------------------------------------------------------------------
*/

export function getUnifiedChatId(uidA: string, uidB: string): string {
  const [a, b] = sortedParticipants(uidA, uidB);
  return `${a}_${b}`;
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
  validateUsers(currentUser, otherUser);

  const users = [currentUser, otherUser];
  const participants = sortedParticipants(currentUser.uid, otherUser.uid);
  const chatId = getUnifiedChatId(currentUser.uid, otherUser.uid);
  const chatRef = doc(db, "chats", chatId);

  const existingChat = await getDoc(chatRef);

  if (existingChat.exists()) {
    return { chatId, created: false };
  }

  await setDoc(chatRef, {
    type: "direct",
    participants,
    participantNames: participantNames(users),
    participantPhotos: participantPhotos(users),
    lastMessage: "",
    lastMessageAt: serverTimestamp(),
    lastSenderId: "",
    unreadCount: unreadCounts(users),
    mutedBy: [],
    deletedFor: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return { chatId, created: true };
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
  const { currentUser, seller, productId, productTitle, productImage } = params;

  validateUsers(currentUser, seller);

  if (!productId) {
    throw new Error("The product could not be identified.");
  }

  const cleanSeller: ChatParticipant = {
    ...seller,
    photoURL: seller.photoURL && seller.photoURL !== productImage ? seller.photoURL : "",
  };

  const users = [currentUser, cleanSeller];
  const participants = sortedParticipants(currentUser.uid, cleanSeller.uid);
  const chatId = getUnifiedChatId(currentUser.uid, cleanSeller.uid);
  const chatRef = doc(db, "chats", chatId);

  const existingChat = await getDoc(chatRef);

  if (existingChat.exists()) {
    await updateDoc(chatRef, {
      type: "product",
      productId,
      participantNames: participantNames(users),
      participantPhotos: participantPhotos(users),
      productTitle,
      productImage: productImage || "",
      updatedAt: serverTimestamp(),
    });
    return { chatId, created: false };
  }

  await setDoc(chatRef, {
    type: "product",
    participants,
    participantNames: participantNames(users),
    participantPhotos: participantPhotos(users),
    productId,
    productTitle,
    productImage: productImage || "",
    lastMessage: "",
    lastMessageAt: serverTimestamp(),
    lastSenderId: "",
    unreadCount: unreadCounts(users),
    mutedBy: [],
    deletedFor: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return { chatId, created: true };
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
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("You must be signed in to apply via chat.");
  }

  const applicant: ChatParticipant = {
    ...params.applicant,
    uid: currentUser.uid,
  };

  const { employer, jobId, jobTitle, company } = params;

  validateUsers(applicant, employer);

  if (!jobId) {
    throw new Error("The job could not be identified.");
  }

  const users = [applicant, employer];
  const participants = sortedParticipants(applicant.uid, employer.uid);
  const chatId = getUnifiedChatId(applicant.uid, employer.uid);
  const chatRef = doc(db, "chats", chatId);

  const existingChat = await getDoc(chatRef);

  if (existingChat.exists()) {
    await updateDoc(chatRef, {
      participantNames: participantNames(users),
      participantPhotos: participantPhotos(users),
      jobTitle,
      company,
      updatedAt: serverTimestamp(),
    });
    return { chatId, created: false };
  }

  await setDoc(chatRef, {
    type: "job_application",
    participants,
    participantNames: participantNames(users),
    participantPhotos: participantPhotos(users),
    jobId,
    jobTitle,
    company,
    lastMessage: "",
    lastMessageAt: serverTimestamp(),
    lastSenderId: "",
    unreadCount: {
      [applicant.uid]: 0,
      [employer.uid]: 0,
    },
    mutedBy: [],
    deletedFor: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return { chatId, created: true };
}

/*
|--------------------------------------------------------------------------
| SEND MESSAGE - OPTIMIZED WITH TRANSACTION
|--------------------------------------------------------------------------
*/

export async function sendChatMessage(params: {
  chatId: string;
  senderId: string;
  senderName: string;
  text: string;
  replyTo?: ReplyTo | null;
  productContext?: {
    productId: string;
    productTitle: string;
    productImage?: string;
  } | null;
}): Promise<{ messageId: string }> {
  const { chatId, senderId, senderName, text, replyTo, productContext } = params;

  const cleanText = text.trim();

  if (!chatId || !senderId) {
    throw new Error("Chat and sender are required.");
  }

  if (!cleanText) {
    throw new Error("Message cannot be empty.");
  }

  if (cleanText.length > 5000) {
    throw new Error("Message cannot exceed 5000 characters.");
  }

  const chatRef = doc(db, "chats", chatId);

  // ✅ Use transaction for atomic updates
  const result = await runTransaction(db, async (transaction) => {
    const chatSnap = await transaction.get(chatRef);
    if (!chatSnap.exists()) {
      throw new Error("This conversation no longer exists.");
    }

    const chat = chatSnap.data() as ChatData;

    if (!chat.participants?.includes(senderId)) {
      throw new Error("You are not a participant in this conversation.");
    }

    const recipientUid = chat.participants.find((uid) => uid !== senderId);
    if (!recipientUid) {
      throw new Error("Unable to find the other participant.");
    }

    const unread = chat.unreadCount || {};

    // ✅ Create message with full data
    const messagesRef = collection(db, "chats", chatId, "messages");
    const messageRef = doc(messagesRef);

    const messageData = {
      senderId,
      senderName: senderName || "User",
      text: cleanText,
      replyTo: replyTo || null,
      productContext: productContext || null,
      createdAt: serverTimestamp(),
      deletedFor: [],
      deletedForEveryone: false,
      forwarded: false,
      participants: chat.participants,   // ← new: lets rules skip the get()
      readBy: {
        [senderId]: true,
        [recipientUid]: false,
      },
      deliveredAt: serverTimestamp(),
    };

    transaction.set(messageRef, messageData);

    // ✅ Update chat document for inbox
    const updateData: any = {
      lastMessage: cleanText.slice(0, 100),
      lastMessageAt: serverTimestamp(),
      lastSenderId: senderId,
      updatedAt: serverTimestamp(),
      // ✅ Ensure deletedFor exists
      deletedFor: chat.deletedFor || [],
    };

    updateData[`unreadCount.${senderId}`] = 0;
    updateData[`unreadCount.${recipientUid}`] = (unread[recipientUid] || 0) + 1;

    transaction.update(chatRef, updateData);

    return { messageId: messageRef.id };
  });

  return result;
}

/*
|--------------------------------------------------------------------------
| FORWARD MESSAGE - OPTIMIZED
|--------------------------------------------------------------------------
*/

export async function forwardChatMessage(params: {
  sourceChatId: string;
  targetChatId: string;
  senderId: string;
  senderName: string;
  originalMessage: ChatMessage;
}): Promise<void> {
  const { sourceChatId, targetChatId, senderId, senderName, originalMessage } = params;

  if (!sourceChatId || !targetChatId || !senderId) {
    throw new Error("Source chat, target chat, and sender are required.");
  }

  const targetChatRef = doc(db, "chats", targetChatId);

  // ✅ Use transaction for atomic updates
  await runTransaction(db, async (transaction) => {
    // Verify target chat exists
    const targetChatSnap = await transaction.get(targetChatRef);
    if (!targetChatSnap.exists()) {
      throw new Error("The selected conversation no longer exists.");
    }

    const targetChat = targetChatSnap.data() as ChatData;

    if (!targetChat.participants?.includes(senderId)) {
      throw new Error("You are not a participant in this conversation.");
    }

    const recipientUid = targetChat.participants.find((uid) => uid !== senderId);
    if (!recipientUid) {
      throw new Error("Unable to find the recipient.");
    }

    const forwardedText = originalMessage.text?.trim();
    if (!forwardedText) {
      throw new Error("The message cannot be forwarded because it has no text.");
    }

    const unread = targetChat.unreadCount || {};

    // Create forwarded message
    const messagesRef = collection(db, "chats", targetChatId, "messages");
    const messageRef = doc(messagesRef);

    const messageData = {
      senderId,
      senderName: senderName || "User",
      text: forwardedText,
      createdAt: serverTimestamp(),
      replyTo: null,
      forwarded: true,
      deletedFor: [],
      deletedForEveryone: false,
      participants: targetChat.participants,   // ← new
      readBy: {
        [senderId]: true,
        [recipientUid]: false,
      },
      deliveredAt: serverTimestamp(),
    };
    transaction.set(messageRef, messageData);

    // Update chat document
    const updateData: any = {
      lastMessage: forwardedText.slice(0, 100),
      lastMessageAt: serverTimestamp(),
      lastSenderId: senderId,
      updatedAt: serverTimestamp(),
      deletedFor: targetChat.deletedFor || [],
    };

    updateData[`unreadCount.${senderId}`] = 0;
    updateData[`unreadCount.${recipientUid}`] = (unread[recipientUid] || 0) + 1;

    transaction.update(targetChatRef, updateData);
  });
}

/*
|--------------------------------------------------------------------------
| MARK CHAT AS READ - OPTIMIZED WITH BATCH
|--------------------------------------------------------------------------
*/

export async function markChatAsRead(chatId: string, userId: string): Promise<void> {
  if (!chatId || !userId) return;

  const chatRef = doc(db, "chats", chatId);

  // Clears the unread badge on the chat doc itself. The matching drop
  // in this user's denormalized totalUnreadCount is now handled
  // server-side by the onChatUnreadCountChanged Cloud Function trigger
  // (see functions/index.ts), which diffs this same unreadCount field —
  // not here, and not for other users' docs from client code at all.
  const previousUnread = await runTransaction(db, async (transaction) => {
    const chatSnap = await transaction.get(chatRef);
    if (!chatSnap.exists()) return 0;

    const chat = chatSnap.data() as ChatData;
    if (!chat.participants?.includes(userId)) {
      throw new Error("You are not a participant in this conversation.");
    }

    const unreadForUser = (chat.unreadCount || {})[userId] || 0;
    if (unreadForUser === 0) return 0;

    transaction.update(chatRef, {
      [`unreadCount.${userId}`]: 0,
      updatedAt: serverTimestamp(),
    });

    return unreadForUser;
  });

  if (previousUnread === 0) return;

  const unreadMessagesQuery = query(
    collection(db, "chats", chatId, "messages"),
    where("participants", "array-contains", userId),
    where(`readBy.${userId}`, "==", false),
    limit(50)
  );

  const unreadMessages = await getDocs(unreadMessagesQuery);

  if (!unreadMessages.empty) {
    const batch = writeBatch(db);
    unreadMessages.docs.forEach((doc) => {
      batch.update(doc.ref, {
        [`readBy.${userId}`]: true,
        readAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
}

/*
|--------------------------------------------------------------------------
| GET UNREAD COUNT - OPTIMIZED WITH COUNTS
|--------------------------------------------------------------------------
*/

export async function getUnreadCount(userId: string): Promise<number> {
  if (!userId) return 0;

  // FIX: one document read instead of scanning every chat this user
  // has ever been part of. Relies on totalUnreadCount being kept in
  // sync by sendChatMessage / forwardChatMessage / markChatAsRead.
  const userSnap = await getDoc(doc(db, "users", userId));
  return userSnap.exists() ? ((userSnap.data() as any).totalUnreadCount ?? 0) : 0;
}

/*
|--------------------------------------------------------------------------
| DISPLAY HELPERS
|--------------------------------------------------------------------------
*/

export function getOtherParticipant(chat: ChatData, currentUserId: string): string | null {
  return chat.participants?.find((uid) => uid !== currentUserId) || null;
}

export function getParticipantName(chat: ChatData, uid: string): string {
  return chat.participantNames?.[uid] || "User";
}

export function getParticipantPhoto(chat: ChatData, uid: string): string {
  return chat.participantPhotos?.[uid] || "";
}

/*
|--------------------------------------------------------------------------
| DELETE MESSAGE FOR ME - OPTIMIZED
|--------------------------------------------------------------------------
*/

export async function deleteMessageForMe(
  chatId: string,
  messageId: string,
  userId: string
): Promise<void> {
  if (!chatId || !messageId || !userId) {
    throw new Error("Chat, message, and user are required.");
  }

  const messageRef = doc(db, "chats", chatId, "messages", messageId);
  const messageSnap = await getDoc(messageRef);

  if (!messageSnap.exists()) {
    throw new Error("This message no longer exists.");
  }

  const message = messageSnap.data() as ChatMessage;
  const deletedFor = message.deletedFor || [];

  if (deletedFor.includes(userId)) return;

  await updateDoc(messageRef, {
    deletedFor: [...deletedFor, userId],
  });
}

/*
|--------------------------------------------------------------------------
| DELETE MESSAGE FOR EVERYONE
|--------------------------------------------------------------------------
*/

export async function deleteMessageForEveryone(
  chatId: string,
  messageId: string,
  userId: string
): Promise<void> {
  if (!chatId || !messageId || !userId) {
    throw new Error("Chat, message, and user are required.");
  }

  const messageRef = doc(db, "chats", chatId, "messages", messageId);
  const messageSnap = await getDoc(messageRef);

  if (!messageSnap.exists()) {
    throw new Error("This message no longer exists.");
  }

  const message = messageSnap.data() as ChatMessage;

  if (message.senderId !== userId) {
    throw new Error("You can only delete your own messages for everyone.");
  }

  await updateDoc(messageRef, {
    text: "This message was deleted.",
    deletedForEveryone: true,
  });
}

/*
|--------------------------------------------------------------------------
| REPORT MESSAGE
|--------------------------------------------------------------------------
*/

export async function reportMessage(
  chatId: string,
  messageId: string,
  reporterId: string,
  reason: string
): Promise<void> {
  if (!chatId || !messageId || !reporterId) {
    throw new Error("Chat, message, and reporter are required.");
  }

  const messageRef = doc(db, "chats", chatId, "messages", messageId);
  const messageSnap = await getDoc(messageRef);

  if (!messageSnap.exists()) {
    throw new Error("This message no longer exists.");
  }

  const message = messageSnap.data() as ChatMessage;

  const submitMessageReport = httpsCallable(functions, "submitMessageReport");
  await submitMessageReport({
    chatId,
    messageId,
    reportedUserId: message.senderId,
    messageText: message.text,
    reason: reason.trim() || "No reason provided",
  });
}

/*
|--------------------------------------------------------------------------
| DELETE CHAT FOR ME
|--------------------------------------------------------------------------
*/

export async function deleteChatForMe(chatId: string, userId: string): Promise<void> {
  if (!chatId || !userId) {
    throw new Error("Chat and user are required.");
  }

  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);

  if (!chatSnap.exists()) return;

  const chat = chatSnap.data() as ChatData;
  const deletedFor = chat.deletedFor || [];

  if (deletedFor.includes(userId)) return;

  await updateDoc(chatRef, {
    deletedFor: [...deletedFor, userId],
  });
}

/*
|--------------------------------------------------------------------------
| MUTE / UNMUTE CHAT
|--------------------------------------------------------------------------
*/

export async function toggleMuteChat(
  chatId: string,
  userId: string,
  mute: boolean
): Promise<void> {
  if (!chatId || !userId) {
    throw new Error("Chat and user are required.");
  }

  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);

  if (!chatSnap.exists()) return;

  const chat = chatSnap.data() as ChatData;
  const mutedBy = chat.mutedBy || [];

  const updated = mute
    ? Array.from(new Set([...mutedBy, userId]))
    : mutedBy.filter((uid) => uid !== userId);

  await updateDoc(chatRef, {
    mutedBy: updated,
  });
}
