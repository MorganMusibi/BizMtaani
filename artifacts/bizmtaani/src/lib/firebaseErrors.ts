import { FirebaseError } from "firebase/app";

export function getFirebaseErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  if (!(error instanceof FirebaseError)) {
    return fallback;
  }

  switch (error.code) {
    case "auth/email-already-in-use":
      return "An account with this email already exists. Please log in instead.";

    case "auth/invalid-email":
      return "Please enter a valid email address.";

    case "auth/weak-password":
      return "Your password is too weak. Please choose a stronger password.";

    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";

    case "auth/user-disabled":
      return "This account has been disabled. Please contact support.";

    case "auth/too-many-requests":
      return "Too many attempts. Please wait a while and try again.";

    case "auth/network-request-failed":
      return "Network error. Please check your internet connection and try again.";

    case "auth/requires-recent-login":
      return "For security reasons, please log in again and try this action.";

    case "auth/popup-closed-by-user":
      return "The sign-in window was closed before the process was completed.";

    case "auth/popup-blocked":
      return "Your browser blocked the sign-in window. Please allow pop-ups and try again.";

    case "auth/credential-already-in-use":
      return "This account is already linked to another user.";

    case "auth/operation-not-allowed":
      return "This sign-in method is currently unavailable.";

    case "auth/expired-action-code":
      return "This link has expired. Please request a new one.";

    case "auth/invalid-action-code":
      return "This link is invalid or has already been used.";

    case "permission-denied":
    case "firestore/permission-denied":
      return "You don't have permission to perform this action.";

    case "not-found":
    case "firestore/not-found":
      return "The requested information could not be found.";

    case "already-exists":
    case "firestore/already-exists":
      return "This information already exists.";

    case "unavailable":
    case "firestore/unavailable":
      return "The service is temporarily unavailable. Please try again.";

    case "deadline-exceeded":
    case "firestore/deadline-exceeded":
      return "The request took too long. Please check your connection and try again.";

    case "storage/unauthorized":
      return "You don't have permission to upload this file.";

    case "storage/canceled":
      return "The upload was cancelled.";

    case "storage/quota-exceeded":
      return "Storage is temporarily unavailable. Please try again later.";

    case "storage/retry-limit-exceeded":
      return "The upload took too long. Please check your connection and try again.";

    case "storage/unknown":
      return "Unable to upload the file. Please try again.";

    default:
      return fallback;
  }
}
