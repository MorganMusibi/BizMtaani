import { useState } from "react";
import { FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Replace with your WhatsApp number in international format, digits only
// (0702278606 becomes 254702278606).
const CV_WHATSAPP_NUMBER = "254702278606";

const CV_ONLY_PRICE = 250;
const CV_AND_COVER_PRICE = 300;

const HIDDEN_KEY = "bizmtaani_cv_banner_hidden";

interface CvRevampBannerProps {
  // When shown on a job page, these fill in the WhatsApp message so
  // the CV can be tailored to that exact job.
  jobTitle?: string;
  company?: string;
  jobUrl?: string;
}

function whatsappLink(
  service: string,
  price: number,
  { jobTitle, company, jobUrl }: CvRevampBannerProps
) {
  const jobLines = jobTitle
    ? `I'm applying for: ${jobTitle}${company ? ` at ${company}` : ""}.\n` +
      (jobUrl ? `Job link: ${jobUrl}\n` : "")
    : `I'm targeting ___ jobs (job title and company, if I have one in mind).\n`;

  const message =
    `Hi, I'd like my CV revamped (${service}, KES ${price}).\n` +
    `My name is ___.\n` +
    jobLines +
    `I'll send my current CV here.`;
  return `https://wa.me/${CV_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function CvRevampBanner(props: CvRevampBannerProps) {
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(HIDDEN_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (hidden) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(HIDDEN_KEY, "1");
    } catch {
      // sessionStorage unavailable — just hide for this render
    }
    setHidden(true);
  }

  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center flex-shrink-0">
          <FileText size={18} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-black text-sm leading-tight">Need a stronger CV?</p>
          <p className="text-xs text-muted-foreground mt-1 leading-snug">
            Get your CV professionally revamped. Delivered on WhatsApp.
          </p>
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex-shrink-0 p-1.5 rounded-xl hover:bg-muted transition-colors"
        >
          <X size={16} className="text-muted-foreground" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <Button asChild variant="outline" className="h-auto py-2 flex-col gap-0.5 font-bold">
          <a
            href={whatsappLink("CV only", CV_ONLY_PRICE, props)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="text-xs">CV only</span>
            <span className="text-sm text-primary">KES {CV_ONLY_PRICE}</span>
          </a>
        </Button>

        <Button asChild className="h-auto py-2 flex-col gap-0.5 font-bold">
          <a
            href={whatsappLink("CV + cover letter", CV_AND_COVER_PRICE, props)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="text-xs">CV + cover letter</span>
            <span className="text-sm">KES {CV_AND_COVER_PRICE}</span>
          </a>
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
        This improves your CV. It does not guarantee a job.
      </p>
    </section>
  );
}
