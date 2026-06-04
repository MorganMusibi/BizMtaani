import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { type User, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
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
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  userProfile: UserProfile | null;
  profileLoading: boolean;
  refreshProfile: () => Promise<void>;
  /** Re-fetches the Firebase Auth user object to pick up emailVerified changes */
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  userProfile: null,
  profileLoading: true,
  refreshProfile: async () => {},
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
      const snap = await getDoc(doc(db, "users", uid));
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

  return (
    <AuthContext.Provider value={{ user, loading, userProfile, profileLoading, refreshProfile, reloadUser }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
