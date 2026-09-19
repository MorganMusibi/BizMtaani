import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  type User,
  onAuthStateChanged,
  getIdTokenResult,
} from "firebase/auth";
import {
  doc,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getFirebaseErrorMessage } from "@/lib/firebaseErrors";
import { registerForNotifications } from "@/lib/notifications";

const OPTIMISTIC_AUTH_KEY = "bizmtaani_was_signed_in";

export interface HomeLocation {
  lat: number;
  lng: number;
  areaName: string;
  constituency: string;
  county: string;
}

export interface UserProfile {
  displayName: string;
  isBusinessOwner: boolean;
  businessName?: string;
  homeLocation?: HomeLocation;
  createdAt?: string;

  subscriptionPlan?: "free" | "premium_weekly" | "premium_monthly";
  premiumEndsAt?: Timestamp;

  // Optional Firestore role for display/reference.
  // Actual admin authorization should rely on
  // the Firebase Authentication custom claim.
  role?: string;

  // Referrals & rewards
  myReferralCode?: string;
  points?: number;
  referredBy?: string;       // set if signed up using a marketer's code
  referredByUser?: string;   // set if signed up using another user's own code
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  // Optimistic, localStorage-backed flag: true if the user was signed
  // in as of their last session, set synchronously before Firebase
  // Auth's own session-restore chain (App Check exchange, accounts:lookup,
  // token refresh — can take ~2s+) has had a chance to resolve. Lets UI
  // that only needs "is someone probably signed in" (e.g. the Advertise
  // button) render instantly instead of waiting on that full chain.
  // Corrected the moment onAuthStateChanged actually fires.
  likelySignedIn: boolean;

  userProfile: UserProfile | null;
  profileLoading: boolean;

  subscriptionPlan:
    | "free"
    | "premium_weekly"
    | "premium_monthly";

  premiumEndsAt: Timestamp | null;
  hasActivePremium: boolean;

  // Admin access
  isAdmin: boolean;
  adminLoading: boolean;

  setProfileDirectly: (profile: UserProfile) => void;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  likelySignedIn: false,

  userProfile: null,
  profileLoading: true,

  subscriptionPlan: "free",
  premiumEndsAt: null,
  hasActivePremium: false,

  isAdmin: false,
  adminLoading: true,

  setProfileDirectly: () => {},
  reloadUser: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Read synchronously at mount, before Firebase Auth has resolved
  // anything — lets the UI assume "probably signed in" instantly on
  // a repeat visit instead of waiting out the full session-restore
  // chain. See the interface comment above for why this exists.
  const [likelySignedIn, setLikelySignedIn] = useState(
    () => {
      try {
        return localStorage.getItem(OPTIMISTIC_AUTH_KEY) === "1";
      } catch {
        return false;
      }
    }
  );

  const [userProfile, setUserProfile] =
    useState<UserProfile | null>(null);

  const [profileLoading, setProfileLoading] = useState(true);

  // Admin state
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminLoading, setAdminLoading] =
    useState(true);

  const setProfileDirectly = useCallback(
    (profile: UserProfile) => {
      setUserProfile(profile);
    },
    []
  );

  const reloadUser = useCallback(async () => {
    const current = auth.currentUser;

    if (!current) {
      return;
    }

    await current.reload();

    setUser(
      Object.assign(
        Object.create(
          Object.getPrototypeOf(current)
        ),
        current
      )
    );

    // Force Firebase to refresh the ID token.
    // This is important after an admin custom claim
    // has been added to the account.
    try {
      await current.getIdToken(true);

      const tokenResult =
        await getIdTokenResult(current);

      setIsAdmin(
        tokenResult.claims.admin === true
      );
    } catch (error) {
      console.error(
        "Failed to refresh admin claim:",
        error
      );

      setIsAdmin(false);
    }
  }, []);

  useEffect(() => {
    let unsubscribeProfile:
      | (() => void)
      | undefined;

    const unsubscribeAuth =
      onAuthStateChanged(
        auth,
        async (currentUser) => {
          setUser(currentUser);
          setLoading(false);

          try {
            if (currentUser) {
              localStorage.setItem(OPTIMISTIC_AUTH_KEY, "1");
            } else {
              localStorage.removeItem(OPTIMISTIC_AUTH_KEY);
            }
          } catch {
            // localStorage unavailable — safe to ignore
          }
          setLikelySignedIn(!!currentUser);

          // Reset admin state whenever auth changes.
          setIsAdmin(false);

          if (unsubscribeProfile) {
            unsubscribeProfile();
            unsubscribeProfile = undefined;
          }

          // No logged-in user
          if (!currentUser) {
            setUserProfile(null);
            setProfileLoading(false);
            setAdminLoading(false);
            return;
          }

          // Mark the profile as loading immediately, before any
          // awaits — closes the race window where `user` is set but
          // `profileLoading` is still false and `userProfile` is
          // still null from a previous state, which made
          // ProfileSetupGate think this was a brand-new user with no
          // profile and re-show the business-owner/buyer prompt.
          setProfileLoading(true);

          // Register for push notifications — fire and forget, never
// block auth state resolution on this. Only once per browser
// session/tab, not on every reload/auth-state re-fire, to avoid
// unnecessary repeated token fetches and Firestore writes for a
// user who's already registered this session.
const notifRegisteredKey = `bizmtaani_notif_registered_${currentUser.uid}`;
if (!sessionStorage.getItem(notifRegisteredKey)) {
  registerForNotifications(currentUser.uid)
    .then(() => {
      try {
        sessionStorage.setItem(notifRegisteredKey, "1");
      } catch {
        // sessionStorage unavailable — safe to ignore, will just retry next reload
      }
    })
    .catch(() => {});
}
// --------------------------------------------------
          // ADMIN CLAIM CHECK
          // Runs in parallel with the profile listener below, not
          // before it — the admin check is a network round-trip that
          // only matters for one account, and it was previously
          // blocking every regular user's own profile from loading
          // until it finished.
          // --------------------------------------------------

          setAdminLoading(true);

          getIdTokenResult(currentUser)
            .then((tokenResult) => {
              setIsAdmin(tokenResult.claims.admin === true);
            })
            .catch((error) => {
              console.error(
                "Failed to check administrator access:",
                error
              );
              setIsAdmin(false);
            })
            .finally(() => {
              setAdminLoading(false);
            });

          // --------------------------------------------------
          // USER PROFILE
          // --------------------------------------------------

          const docRef = doc(
            db,
            "users",
            currentUser.uid
          );

          unsubscribeProfile = onSnapshot(
            docRef,
            (snap) => {
              setUserProfile(
                snap.exists()
                  ? (snap.data() as UserProfile)
                  : null
              );

              setProfileLoading(false);
            },
            (error) => {
              console.error(
                "Profile subscription error:",
                getFirebaseErrorMessage(
                  error,
                  "Unable to load your profile. Please try again."
                )
              );

              // Don't expose technical Firebase
              // errors to the user.
              // The app can continue using
              // the default free plan.
              setUserProfile(null);
              setProfileLoading(false);
            }
          );

        }
      );

    return () => {
      unsubscribeAuth();

      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, []);

  const subscriptionPlan:
    | "free"
    | "premium_weekly"
    | "premium_monthly" =
    userProfile?.subscriptionPlan ?? "free";

  const premiumEndsAt =
    userProfile?.premiumEndsAt ?? null;

  const hasActivePremium =
    (subscriptionPlan === "premium_weekly" ||
      subscriptionPlan === "premium_monthly") &&
    premiumEndsAt !== null &&
    premiumEndsAt.toMillis() > Date.now();

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        likelySignedIn,

        userProfile,
        profileLoading,

        subscriptionPlan,
        premiumEndsAt,
        hasActivePremium,

        isAdmin,
        adminLoading,

        setProfileDirectly,
        reloadUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
  }
