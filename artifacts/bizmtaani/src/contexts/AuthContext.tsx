import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { type User, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

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
}

interface AuthContextType {
  user: User | null;
  loading: boolean;

  userProfile: UserProfile | null;
  profileLoading: boolean;

  subscriptionPlan: "free" | "premium_weekly" | "premium_monthly";
  premiumEndsAt: Timestamp | null;
  hasActivePremium: boolean;

  refreshProfile: () => Promise<void>;
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

  refreshProfile: async () => {},
  setProfileDirectly: () => {},
  reloadUser: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const loadProfile = useCallback(async (uid: string) => {
    setProfileLoading(true);
    try {
      // Race Firestore against an 8-second timeout so a blocked/slow
      // connection never leaves the app in an infinite loading state.
      const snap = await Promise.race([
        getDoc(doc(db, "users", uid)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("profile-load-timeout")), 8000)
        ),
      ]);
      setUserProfile(snap.exists() ? (snap.data() as UserProfile) : null);
    } catch {
      setUserProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.uid);
  }, [user, loadProfile]);

  /**
   * Call auth.currentUser.reload() to refresh the in-memory user object
   * (picks up emailVerified = true after the user clicks the link).
   * Then force a re-render by cloning the user reference.
   */
  const setProfileDirectly = useCallback((profile: UserProfile) => {
    setUserProfile(profile);
  }, []);

  const reloadUser = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) return;
    await current.reload();
    // Create a new reference so React re-renders components that depend on user
    setUser(Object.assign(Object.create(Object.getPrototypeOf(current)), current));
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
      if (currentUser) {
        void loadProfile(currentUser.uid);
      } else {
        setUserProfile(null);
        setProfileLoading(false);
      }
    });
    return () => unsubscribe();
  }, [loadProfile]);
  const subscriptionPlan =
  userProfile?.subscriptionPlan ?? "free";

const premiumEndsAt =
  userProfile?.premiumEndsAt ?? null;

const hasActivePremium =
  subscriptionPlan !== "free" &&
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

    refreshProfile,
    setProfileDirectly,
    reloadUser,
  }}
>
      {!loading && children}
    </AuthContext.Provider>
  );
}
