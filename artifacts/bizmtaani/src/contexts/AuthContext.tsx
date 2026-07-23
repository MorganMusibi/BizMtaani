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
} from "firebase/auth";

import {
  doc,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { getFirebaseErrorMessage } from "@/lib/firebaseErrors";

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

  // Admin role stored in Firestore for display/management.
  // Actual security should rely on Firebase Custom Claims.
  role?: "user" | "admin";
}

interface AuthContextType {
  user: User | null;
  loading: boolean;

  userProfile: UserProfile | null;
  profileLoading: boolean;

  subscriptionPlan: "free" | "premium_weekly" | "premium_monthly";
  premiumEndsAt: Timestamp | null;
  hasActivePremium: boolean;

  // Admin status
  isAdmin: boolean;
  adminLoading: boolean;

  setProfileDirectly: (profile: UserProfile) => void;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,

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

  const [userProfile, setUserProfile] =
    useState<UserProfile | null>(null);

  const [profileLoading, setProfileLoading] =
    useState(false);

  // Admin state
  const [isAdmin, setIsAdmin] =
    useState(false);

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

    if (!current) return;

    await current.reload();

    setUser(
      Object.assign(
        Object.create(
          Object.getPrototypeOf(current)
        ),
        current
      )
    );

    // Force refresh of Firebase ID token
    // so newly-added custom claims become available.
    await current.getIdToken(true);
  }, []);

  useEffect(() => {
    let unsubscribeProfile:
      | (() => void)
      | undefined;

    const unsubscribeAuth = onAuthStateChanged(
      auth,
      async (currentUser) => {
        setUser(currentUser);
        setLoading(false);

        if (unsubscribeProfile) {
          unsubscribeProfile();
          unsubscribeProfile = undefined;
        }

        // Reset admin state when logged out
        if (!currentUser) {
          setUserProfile(null);
          setProfileLoading(false);
          setIsAdmin(false);
          setAdminLoading(false);
          return;
        }

        // ─────────────────────────────────────────
        // Check Firebase Custom Claims
        // ─────────────────────────────────────────

        setAdminLoading(true);

        try {
          const tokenResult =
            await currentUser.getIdTokenResult();

          setIsAdmin(
            tokenResult.claims.admin === true
          );
        } catch (error) {
          console.error(
            "Failed to check admin status:",
            error
          );

          setIsAdmin(false);
        } finally {
          setAdminLoading(false);
        }

        // ─────────────────────────────────────────
        // Load Firestore User Profile
        // ─────────────────────────────────────────

        setProfileLoading(true);

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
      {!loading && children}
    </AuthContext.Provider>
  );
}
