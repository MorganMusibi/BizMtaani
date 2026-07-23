import { FirebaseError } from "firebase/app";

/**
 * Converts Firebase/Auth/Firestore/Storage/Functions/network errors
 * into clean, user-friendly messages for BizMtaani users.
 */
export function getFirebaseErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  // Handle non-Firebase errors
  if (!(error instanceof FirebaseError)) {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (
        message.includes("network") ||
        message.includes("failed to fetch") ||
        message.includes("fetch failed")
      ) {
        return "Please check your internet connection and try again.";
      }
    }

    return fallback;
  }

  switch (error.code) {
    // =========================================
    // AUTHENTICATION
    // =========================================

    // Login
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "Incorrect email or password. Please try again.";

    case "auth/user-not-found":
      return "No account was found with this email.";

    case "auth/invalid-email":
      return "Please enter a valid email address.";

    case "auth/user-disabled":
      return "This account has been disabled. Please contact support.";

    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";

    case "auth/network-request-failed":
      return "Please check your internet connection and try again.";

    // Registration
    case "auth/email-already-in-use":
      return "An account with this email already exists. Please log in instead.";

    case "auth/weak-password":
      return "Your password is too weak. Please choose a stronger password.";

    case "auth/operation-not-allowed":
      return "This sign-in method is currently unavailable. Please try again later.";

    // Password reset
    case "auth/missing-email":
      return "Please enter your email address.";

    // Google / OAuth
    case "auth/popup-closed-by-user":
      return "The sign-in window was closed before authentication was completed.";

    case "auth/popup-blocked":
      return "Your browser blocked the sign-in window. Please allow pop-ups and try again.";

    case "auth/cancelled-popup-request":
      return "The sign-in request was cancelled. Please try again.";

    case "auth/account-exists-with-different-credential":
      return "An account already exists with this email using a different sign-in method.";

    case "auth/credential-already-in-use":
      return "This account is already linked to another user.";

    case "auth/provider-already-linked":
      return "This sign-in method is already linked to your account.";

    // Security / session
    case "auth/requires-recent-login":
      return "For your security, please sign in again before continuing.";

    case "auth/session-cookie-expired":
    case "auth/id-token-expired":
    case "auth/id-token-revoked":
      return "Your session has expired. Please sign in again.";

    // =========================================
    // FIRESTORE
    // =========================================

    case "permission-denied":
      return "You don't have permission to perform this action.";

    case "unauthenticated":
      return "Please sign in to continue.";

    case "not-found":
      return "The requested information could not be found.";

    case "already-exists":
      return "This information already exists.";

    case "aborted":
    case "cancelled":
      return "The request was interrupted. Please try again.";

    case "deadline-exceeded":
      return "The request took too long. Please check your connection and try again.";

    case "failed-precondition":
      return "This action cannot be completed right now. Please try again.";

    case "resource-exhausted":
      return "The service is temporarily busy. Please try again later.";

    case "unavailable":
      return "The service is temporarily unavailable. Please try again.";

    case "data-loss":
      return "A data error occurred. Please try again.";

    case "internal":
      return "Something went wrong on our servers. Please try again later.";

    case "invalid-argument":
      return "Some of the information provided is invalid. Please check and try again.";

    case "out-of-range":
      return "The information provided is outside the allowed range.";

    case "unimplemented":
      return "This feature is not currently available.";

    case "unknown":
      return "An unexpected error occurred. Please try again.";

    // =========================================
    // FIREBASE STORAGE
    // =========================================

    case "storage/object-not-found":
      return "The requested file could not be found.";

    case "storage/unauthorized":
      return "You don't have permission to access this file.";

    case "storage/canceled":
      return "The file upload was cancelled.";

    case "storage/unknown":
      return "An unexpected file storage error occurred. Please try again.";

    case "storage/quota-exceeded":
      return "Storage capacity has been reached. Please try again later.";

    case "storage/unauthenticated":
      return "Your session has expired. Please sign in again.";

    case "storage/retry-limit-exceeded":
      return "The upload took too long. Please check your connection and try again.";

    case "storage/invalid-checksum":
      return "The file could not be uploaded correctly. Please try again.";

    case "storage/invalid-url":
      return "The file location is invalid.";

    case "storage/invalid-argument":
      return "The file information provided is invalid.";

    case "storage/server-file-wrong-size":
      return "The uploaded file could not be processed correctly. Please try again.";

    // =========================================
    // CLOUD FUNCTIONS
    // =========================================

    case "functions/cancelled":
      return "The request was cancelled. Please try again.";

    case "functions/unknown":
      return "An unexpected server error occurred. Please try again.";

    case "functions/invalid-argument":
      return "Some of the information provided is invalid.";

    case "functions/deadline-exceeded":
      return "The request took too long. Please try again.";

    case "functions/not-found":
      return "The requested service could not be found.";

    case "functions/already-exists":
      return "This request has already been processed.";

    case "functions/permission-denied":
      return "You don't have permission to perform this action.";

    case "functions/unauthenticated":
      return "Please sign in to continue.";

    case "functions/resource-exhausted":
      return "The service is temporarily busy. Please try again later.";

    case "functions/failed-precondition":
      return "This action cannot be completed right now. Please try again.";

    case "functions/aborted":
      return "The request was interrupted. Please try again.";

    case "functions/out-of-range":
      return "The information provided is outside the allowed range.";

    case "functions/unimplemented":
      return "This feature is not currently available.";

    case "functions/internal":
      return "Something went wrong on our servers. Please try again later.";

    case "functions/unavailable":
      return "The service is temporarily unavailable. Please try again.";

    case "functions/data-loss":
      return "A server data error occurred. Please try again.";

    // =========================================
    // DEFAULT
    // =========================================

    default:
      return fallback;
  }
}
