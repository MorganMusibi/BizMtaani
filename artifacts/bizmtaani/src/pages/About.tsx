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
  ChevronDown,
  FileText,
  Lock,
  Flag,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";

const HOW_IT_WORKS = [
  {
    icon: Search,
    title: "Browse nearby adverts",
    body: "Discover products, services, businesses, rentals, jobs, and other opportunities around you. Your selected area helps personalize what you see first.",
  },
  {
    icon: Plus,
    title: "Post your own advert",
    body: "Sell a product, offer a service, advertise your business, or post another type of listing. Choose the plan that suits your needs.",
  },
  {
    icon: MapPin,
    title: "Choose your area",
    body: "Your selected area helps determine which adverts you see first. You can change it anytime, and you don't need to be in that area to post an advert.",
  },
  {
    icon: ShieldCheck,
    title: "Premium listings",
    body: "Premium plans can provide wider visibility and longer listing periods, helping your advert reach more potential customers.",
  },
];

const FAQ = [
  {
    q: "How do I post an advert?",
    a: "Tap the + button on the home screen, choose the type of listing you want to create, enter your details, add photos where applicable, and submit your advert.",
  },
  {
    q: "How long does my advert stay active?",
    a: "Free adverts run for 7 days. Premium Weekly runs for 7 days with wider reach, while Premium Monthly runs for 30 days.",
  },
  {
    q: "What happens when my advert expires?",
    a: "Your expired advert is archived rather than permanently deleted. Where eligible, you can renew it to make it active again.",
  },
  {
    q: "How do I pay for premium?",
    a: "Premium payments are handled through M-Pesa. You'll receive an STK Push prompt on your phone to complete the payment.",
  },
  {
    q: "Is my phone number visible to everyone?",
    a: "Your contact details are made available to users who need to contact you about your advert. Only provide contact information you are comfortable sharing.",
  },
  {
    q: "Can I change my selected area?",
    a: "Yes. You can change your selected area whenever you want to browse adverts from a different location.",
  },
];

export default function About() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-card border-b border-border px-4 h-14 flex items-center gap-3 z-40">
        <button
          onClick={() => setLocation("/")}
          className="p-2 -ml-2 rounded-xl hover:bg-muted active:scale-95 transition-all"
          aria-label="Back to home"
        >
          <ArrowLeft size={20} />
        </button>

        <span className="font-black text-lg tracking-tight">
          About BizMtaani
        </span>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-6 pb-24">
        {/* Introduction */}
        <section className="mb-8">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center mb-3">
            <span className="text-white text-xl font-black">B</span>
          </div>

          <h1 className="text-xl font-black mb-2">
            Buy, sell, and connect locally
          </h1>

          <p className="text-sm text-muted-foreground leading-relaxed">
            BizMtaani is a Kenya-focused local marketplace that helps people
            discover products, services, businesses, rentals, jobs, and other
            opportunities around them.
          </p>
        </section>

        {/* How it works */}
        <section className="mb-8">
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
        </section>

        {/* FAQ */}
        <section className="mb-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">
            Frequently asked questions
          </h2>

          <div className="space-y-2">
            {FAQ.map(({ q, a }) => (
              <details
                key={q}
                className="bg-card border border-border rounded-2xl group"
              >
                <summary className="font-semibold text-sm cursor-pointer list-none flex items-center justify-between gap-3 p-4">
                  <span>{q}</span>

                  <ChevronDown
                    size={18}
                    className="text-muted-foreground flex-shrink-0 transition-transform group-open:rotate-180"
                  />
                </summary>

                <p className="text-xs text-muted-foreground px-4 pb-4 leading-relaxed">
                  {a}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* Help & Support */}
        <section className="mb-8">
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
                <p className="font-bold text-sm">
                  Chat with us on WhatsApp
                </p>
                <p className="text-xs text-muted-foreground">
                  Fastest way to get help
                </p>
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
                <p className="text-xs text-muted-foreground">
                  +254 702 278 606
                </p>
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
                <p className="text-xs text-muted-foreground">
                  morganmusibi@gmail.com
                </p>
              </div>
            </a>
          </div>
        </section>

        {/* Legal & Safety */}
        <section className="mb-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">
            Legal & safety
          </h2>

          <div className="space-y-2">
            <button
              onClick={() => setLocation("/privacy")}
              className="w-full flex items-center gap-3 bg-card border border-border rounded-2xl p-4 text-left active:scale-[0.98] transition-transform"
            >
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Lock size={18} className="text-primary" />
              </div>

              <div className="flex-1">
                <p className="font-bold text-sm">Privacy Policy</p>
                <p className="text-xs text-muted-foreground">
                  Learn how BizMtaani handles your information
                </p>
              </div>

              <ChevronDown
                size={17}
                className="-rotate-90 text-muted-foreground"
              />
            </button>

            <button
              onClick={() => setLocation("/terms")}
              className="w-full flex items-center gap-3 bg-card border border-border rounded-2xl p-4 text-left active:scale-[0.98] transition-transform"
            >
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <FileText size={18} className="text-primary" />
              </div>

              <div className="flex-1">
                <p className="font-bold text-sm">Terms of Service</p>
                <p className="text-xs text-muted-foreground">
                  Rules for using BizMtaani
                </p>
              </div>

              <ChevronDown
                size={17}
                className="-rotate-90 text-muted-foreground"
              />
            </button>

            <button
              onClick={() => setLocation("/report")}
              className="w-full flex items-center gap-3 bg-card border border-border rounded-2xl p-4 text-left active:scale-[0.98] transition-transform"
            >
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Flag size={18} className="text-primary" />
              </div>

              <div className="flex-1">
                <p className="font-bold text-sm">Report a problem</p>
                <p className="text-xs text-muted-foreground">
                  Report an advert or other issue
                </p>
              </div>

              <ChevronDown
                size={17}
                className="-rotate-90 text-muted-foreground"
              />
            </button>
          </div>
        </section>

        {/* App information */}
        <section className="text-center pt-2 pb-4">
          <div className="w-10 h-10 rounded-xl bg-primary mx-auto mb-2 flex items-center justify-center">
            <span className="text-white font-black">B</span>
          </div>

          <p className="font-bold text-sm">BizMtaani</p>
          <p className="text-xs text-muted-foreground mt-1">
            Version 1.0.0
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            © 2026 BizMtaani
          </p>
        </section>
      </div>

      <BottomNav />
    </div>
  );
}
