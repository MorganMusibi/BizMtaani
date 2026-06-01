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
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  userProfile: null,
  profileLoading: true,
  refreshProfile: async () => {},
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
    <AuthContext.Provider value={{ user, loading, userProfile, profileLoading, refreshProfile }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
