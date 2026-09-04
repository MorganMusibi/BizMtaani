import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Store } from "lucide-react";



// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Listing {
  id: string;
  title: string;
  price: number;
  rentPerMonth?: number;
  category: string;
  imageUrl?: string;
  imageUrls?: string[];
  createdAt?: { seconds: number } | null;
  stockQty?: number | null;
  trackStock?: boolean;
  status?: string;
  expiresAt?: { seconds: number } | null;
}

interface Order {
  id: string;
  listingId: string;
  listingTitle: string;
  listingImage?: string;
  buyerId: string;
  buyerName: string;
  buyerPhone: string;
  sellerId: string;
  amount: number;
  note: string;
  status:
    | "pending"
    | "confirmed"
    | "rejected"
    | "completed";
  createdAt?: { seconds: number } | null;
}

/**
 * Product inquiry chat.
 *
 * This matches the new chatService.ts structure:
 *
 * type: "product"
 * participants: [...]
 * productId
 * productTitle
 * productImage
 * unreadCount
 */
interface ProductInquiry {
  chatId: string;
  productId: string;
  productTitle: string;
  productImage?: string;

  buyerId?: string;
  buyerName?: string;

  lastMessage?: string;
  lastActivity?: {
    seconds: number;
  } | null;

  unreadCount: number;
}

/**
 * Job application chat.
 *
 * This matches:
 *
 * type: "job_application"
 * participants: [...]
 * jobId
 * jobTitle
 * company
 * participantNames
 */
interface JobApplication {
  chatId: string;
  jobId: string;
  jobTitle: string;
  company: string;

  applicantId?: string;
  applicantName?: string;

  lastMessage?: string;
  lastActivity?: {
    seconds: number;
  } | null;

  unreadCount: number;
}

type Tab =
  | "overview"
  | "orders"
  | "inventory"
  | "inquiries"
  | "profile";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function timeAgo(seconds: number): string {
  const d =
    Math.floor(Date.now() / 1000) -
    seconds;

  if (d < 60) {
    return "Just now";
  }

  if (d < 3600) {
    return `${Math.floor(d / 60)}m ago`;
  }

  if (d < 86400) {
    return `${Math.floor(d / 3600)}h ago`;
  }

  return `${Math.floor(d / 86400)}d ago`;
}

/**
 * API helper.
 *
 * Kept for your existing Orders backend.
 */
async function apiRequest(
  path: string,
  options?: RequestInit
) {
  const token =
    await auth.currentUser?.getIdToken();

  return fetch(path, {
    ...options,

    headers: {
      "Content-Type":
        "application/json",

      Authorization:
        `Bearer ${token}`,

      ...options?.headers,
    },
  });
}

const STATUS_COLORS: Record<
  Order["status"],
  string
> = {
  pending:
    "text-amber-700 bg-amber-100",

  confirmed:
    "text-blue-700 bg-blue-100",

  completed:
    "text-[#00A651] bg-[#00A651]/10",

  rejected:
    "text-destructive bg-destructive/10",
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function Business() {
  const [, navigate] = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      navigate("/login");
    }
  }, [user, navigate]);

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex-shrink-0 bg-card border-b border-border px-4 h-14 flex items-center gap-3">
        <button
          onClick={() => navigate("/profile")}
          className="p-1.5 rounded-xl hover:bg-muted transition-colors"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
            <Store size={13} className="text-white" />
          </div>
          <span className="font-black text-base truncate">My Business</span>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4 text-center">
        <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center">
          <Store size={36} className="text-primary" />
        </div>
        <div>
          <p className="font-black text-xl">Coming Soon</p>
          <p className="text-muted-foreground text-sm mt-1">
            Business management tools are on the way. Check back soon.
          </p>
        </div>
        <Button onClick={() => navigate("/profile")}>
          Back to Profile
        </Button>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// STAT CARD
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  badge,
}: {
  icon: typeof ShoppingBag;
  label: string;
  value:
    | string
    | number;
  color: string;
  badge?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">

      <div
        className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${color}`}
      >
        <Icon
          size={18}
        />
      </div>

      <p className="font-black text-xl leading-none">
        {value}
      </p>

      <p className="text-xs text-muted-foreground mt-1">
        {label}
      </p>

      {badge && (
        <span className="mt-1.5 inline-block text-[10px] font-bold text-amber-700">
          {badge}
        </span>
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION ROW
// ─────────────────────────────────────────────────────────────────────────────

function ActionRow({
  icon: Icon,
  label,
  sub,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-border bg-card hover:bg-muted/40 transition-all text-left active:scale-[0.98]"
    >

      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Icon
          size={17}
          className="text-primary"
        />
      </div>

      <div className="flex-1 min-w-0">

        <p className="font-bold text-sm">
          {label}
        </p>

        <p className="text-xs text-muted-foreground">
          {sub}
        </p>

      </div>

      <ChevronRight
        size={16}
        className="text-muted-foreground flex-shrink-0"
      />

    </button>
  );
}
