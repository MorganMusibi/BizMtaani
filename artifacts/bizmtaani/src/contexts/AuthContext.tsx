import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { type User, onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot, Timestamp } from "firebase/firestore"; // Added onSnapshot, removed getDoc
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

  setProfileDirectly: () => {},
  reloadUser: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const setProfileDirectly = useCallback((profile: UserProfile) => {
    setUserProfile(profile);
  }, []);

  const reloadUser = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) return;
    await current.reload();
    setUser(Object.assign(Object.create(Object.getPrototypeOf(current)), current));
  }, []);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);

      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = undefined;
      }

      if (currentUser) {
        setProfileLoading(true);
        const docRef = doc(db, "users", currentUser.uid);
        
        unsubscribeProfile = onSnapshot(
          docRef,
          (snap) => {
            setUserProfile(snap.exists() ? (snap.data() as UserProfile) : null);
            setProfileLoading(false);
          },
          (error) => {
            console.error("Profile subscription error:", error);
            setUserProfile(null);
            setProfileLoading(false);
          }
        );
      } else {
        setUserProfile(null);
        setProfileLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  const subscriptionPlan: "free" | "premium_weekly" | "premium_monthly" =
    userProfile?.subscriptionPlan ?? "free";

  const premiumEndsAt = userProfile?.premiumEndsAt ?? null;

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
        setProfileDirectly,
        reloadUser,
      }}
    >
      {!loading && children}
    </AuthContext.Provider>
  );
}
