import { useLocation } from "wouter";
import {
  ArrowLeft,
  Search,
  MapPin,
  Plus,
  ShieldCheck,
  MessageCircle,
  Phone,
  Mail,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";

const HOW_IT_WORKS = [
  {
    icon: Search,
    title: "Browse nearby adverts",
    body: "See products, services, and listings from sellers close to you first — BizMtaani shows what's around your area automatically.",
  },
  {
    icon: Plus,
    title: "Post your own advert",
    body: "Sell products, list a service, or advertise your business. Free adverts stay visible locally; premium plans reach further and last longer.",
  },
  {
    icon: MapPin,
    title: "Set your area",
    body: "Your location decides what you see first. You can adjust it anytime if you move or want to browse a different area.",
  },
  {
    icon: ShieldCheck,
    title: "Verified & premium sellers",
    body: "Premium and verified accounts get a badge, wider visibility, and priority placement — a quick way to spot trusted sellers.",
  },
];

const FAQ = [
  {
    q: "How do I post an advert?",
    a: "Tap the + button on the home screen, fill in your product or service details, add photos, and submit. Free adverts go live immediately.",
  },
  {
    q: "How long does my advert stay active?",
    a: "Free adverts run for 7 days. Weekly premium runs 7 days with wider reach; monthly premium runs 30 days.",
  },
  {
    q: "What happens when my advert expires?",
    a: "It's archived automatically, not deleted — your data is kept safe. Renewing your subscription reactivates eligible listings.",
  },
  {
    q: "How do I pay for premium?",
    a: "Payments are handled securely through M-Pesa. You'll get an STK push prompt on your phone to complete payment.",
  },
  {
    q: "Is my phone number visible to everyone?",
    a: "Only shown to users who view your advert, so genuine buyers can reach you directly.",
  },
];

export default function AboutUs() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <header className="flex-shrink-0 bg-card border-b border-border px-4 h-14 flex items-center gap-3 z-40">
        <button
          onClick={() => setLocation("/")}
          className="p-2 -ml-2 rounded-xl hover:bg-muted transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <span className="font-black text-lg tracking-tight">About BizMtaani</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 pb-24">
        {/* Intro */}
        <div className="mb-8">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center mb-3">
            <span className="text-white text-xl font-black">B</span>
          </div>
          <h1 className="text-xl font-black mb-2">Buy, sell, and connect locally</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            BizMtaani connects buyers and sellers within their own neighborhoods and beyond
            across Kenya — from products and vehicles to services, accommodation,
            and local eateries.
          </p>
        </div>

        {/* How it works */}
        <div className="mb-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">
            How it works
          </h2>
          <div className="space-y-3">
            {HOW_IT_WORKS.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="flex gap-3 bg-card border border-border rounded-2xl p-4"
              >
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon size={18} className="text-primary" />
                </div>
                <div>
                  <p className="font-bold text-sm">{title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">
            Frequently asked questions
          </h2>
          <div className="space-y-2">
            {FAQ.map(({ q, a }) => (
              <details
                key={q}
                className="bg-card border border-border rounded-2xl p-4 group"
              >
                <summary className="font-semibold text-sm cursor-pointer list-none flex items-center justify-between">
                  {q}
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">
                    ▾
                  </span>
                </summary>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  {a}
                </p>
              </details>
            ))}
          </div>
        </div>

        {/* Get help / support */}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">
            Need help?
          </h2>
          <div className="space-y-2">
            <a
              href="https://wa.me/254702278606"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 bg-card border border-border rounded-2xl p-4 active:scale-[0.98] transition-transform"
            >
              <div className="w-9 h-9 rounded-xl bg-[#25D366]/10 flex items-center justify-center flex-shrink-0">
                <MessageCircle size={18} className="text-[#25D366]" />
              </div>
              <div>
                <p className="font-bold text-sm">Chat with us on WhatsApp</p>
                <p className="text-xs text-muted-foreground">Fastest way to get help</p>
              </div>
            </a>

            <a
              href="tel:+254702278606"
              className="flex items-center gap-3 bg-card border border-border rounded-2xl p-4 active:scale-[0.98] transition-transform"
            >
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Phone size={18} className="text-primary" />
              </div>
              <div>
                <p className="font-bold text-sm">Call support</p>
                <p className="text-xs text-muted-foreground">+254 702278606</p>
              </div>
            </a>

            <a
              href="mailto:morganmusibi@gmail.com"
              className="flex items-center gap-3 bg-card border border-border rounded-2xl p-4 active:scale-[0.98] transition-transform"
            >
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Mail size={18} className="text-primary" />
              </div>
              <div>
                <p className="font-bold text-sm">Email us</p>
                <p className="text-xs text-muted-foreground">morganmusibi@gmail.com</p>
              </div>
            </a>
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  );
                }
