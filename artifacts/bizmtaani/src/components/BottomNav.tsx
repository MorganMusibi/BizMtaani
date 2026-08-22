import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { LayoutGrid, Package, MessageCircle, User, Briefcase, Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { prefetchRoute } from "@/lib/prefetch";

interface Chat {
  unreadCount?: Record<string, number>;
}

export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();
  const [unreadTotal, setUnreadTotal] = useState(0);

  useEffect(() => {
    if (!user) {
      setUnreadTotal(0);
      return;
    }
    const q = query(
      collection(db, "chats"),
      where("participants", "array-contains", user.uid)
    );
    const unsub = onSnapshot(q, (snap) => {
      const total = snap.docs.reduce((sum, d) => {
        const data = d.data() as Chat;
        return sum + (data.unreadCount?.[user.uid] ?? 0);
      }, 0);
      setUnreadTotal(total);
    });
    return unsub;
  }, [user]);

  // "/" is Home — already loaded on first paint, so it's excluded.
  // Every other nav destination gets its chunk warmed on hover/touch.
  const prefetchMap: Record<string, () => Promise<unknown>> = {
    "/jobs": () => import("@/pages/Jobs"),
    "/my-listings": () => import("@/pages/MyListings"),
    "/chats": () => import("@/pages/ChatList"),
    "/about": () => import("@/pages/About"),
    "/profile": () => import("@/pages/Profile"),
  };

  const navItems = [
    { path: "/", label: "Discover", icon: LayoutGrid, badge: 0 },
    { path: "/jobs", label: "Jobs", icon: Briefcase, badge: 0 },
    { path: "/my-listings", label: "Listings", icon: Package, badge: 0 },
    { path: "/chats", label: "Chats", icon: MessageCircle, badge: unreadTotal },
    { path: "/about", label: "About", icon: Info, badge: 0 },
    { path: "/profile", label: "Profile", icon: User, badge: 0 },
  ];

  return (
    <nav
      data-testid="bottom-nav"
      className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-stretch h-16">
        {navItems.map(({ path, label, icon: Icon, badge }) => {
          const isActive =
            path === "/" ? location === "/" : location.startsWith(path);
          return (
            <Link
              key={path}
              href={path}
              data-testid={`nav-${label.toLowerCase()}`}
              onMouseEnter={() => {
                const load = prefetchMap[path];
                if (load) prefetchRoute(path, load);
              }}
              onTouchStart={() => {
                const load = prefetchMap[path];
                if (load) prefetchRoute(path, load);
              }}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors relative ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <div className="relative">
                <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8} />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-destructive border-2 border-card flex items-center justify-center text-[9px] font-bold text-white leading-none">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] font-medium tracking-wide ${isActive ? "text-primary" : ""}`}
              >
                {label}
              </span>
              {isActive && (
                <span className="absolute bottom-0 w-6 h-0.5 rounded-t-full bg-primary" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
