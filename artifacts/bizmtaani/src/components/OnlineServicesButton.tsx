import { useState } from "react";
import {
  FileText,
  Receipt,
  Landmark,
  GraduationCap,
  ClipboardCheck,
  ChevronRight,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// WhatsApp number in international format, digits only
// (0702278606 becomes 254702278606).
const SERVICES_WHATSAPP_NUMBER = "254702278606";

const SERVICE_PRICE = 200; // KES — every service is the same price for now

interface ServiceItem {
  key: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  // When true, the WhatsApp message also includes the job the person
  // was viewing (useful for CVs and cover letters).
  includeJob?: boolean;
}

const SERVICES: ServiceItem[] = [
  {
    key: "cv",
    title: "CV revamp",
    description: "A clean, professional CV",
    icon: <FileText size={18} />,
    includeJob: true,
  },
  {
    key: "cv-letter",
    title: "CV + cover letter",
    description: "CV and a matching application letter",
    icon: <FileText size={18} />,
    includeJob: true,
  },
  {
    key: "kra",
    title: "KRA services",
    description: "PIN registration, nil returns, annual returns",
    icon: <Receipt size={18} />,
  },
  {
    key: "ecitizen",
    title: "eCitizen applications",
    description: "Passport, good conduct and other eCitizen services",
    icon: <Landmark size={18} />,
  },
  {
    key: "education",
    title: "Education applications",
    description: "KUCCPS, HELB and college applications",
    icon: <GraduationCap size={18} />,
  },
  {
    key: "registrations",
    title: "Registrations",
    description: "SHA, NSSF and business name registration",
    icon: <ClipboardCheck size={18} />,
  },
  {
    key: "documents",
    title: "Documents",
    description: "Typing, formatting, PDF merge or edit, scan to PDF",
    icon: <FileText size={18} />,
  },
];

interface OnlineServicesButtonProps {
  // Shown when the button is used on a job page, so CVs can be tailored.
  jobTitle?: string;
  company?: string;
  jobUrl?: string;
}

function whatsappLink(
  service: ServiceItem,
  { jobTitle, company, jobUrl }: OnlineServicesButtonProps
) {
  let message =
    `Hi, I need help with: ${service.title} (KES ${SERVICE_PRICE}).\n` +
    `My name is ___.\n`;

  if (service.includeJob && jobTitle) {
    message +=
      `I'm applying for: ${jobTitle}${company ? ` at ${company}` : ""}.\n` +
      (jobUrl ? `Job link: ${jobUrl}\n` : "");
  }

  message += `I'll send my details here.`;
  return `https://wa.me/${SERVICES_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function OnlineServicesButton(props: OnlineServicesButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center flex-shrink-0">
            <FileText size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm leading-tight">Online services</p>
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              CV, KRA, eCitizen, HELB, SHA and more. KES {SERVICE_PRICE} each. Done for you, delivered on WhatsApp.
            </p>
          </div>
        </div>

        <Button
          type="button"
          className="w-full h-11 mt-3 font-bold rounded-xl"
          onClick={() => setOpen(true)}
        >
          View online services
        </Button>
      </section>

      {open && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-[61] bg-background rounded-t-3xl border-t border-border max-h-[85vh] flex flex-col md:max-w-2xl md:mx-auto"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
              <div>
                <h3 className="font-black text-lg">Online services</h3>
                <p className="text-xs text-muted-foreground">
                  Tap a service to order on WhatsApp. KES {SERVICE_PRICE} each.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto px-5 space-y-2 pb-2">
              {SERVICES.map((service) => (
                <a
                  key={service.key}
                  href={whatsappLink(service, props)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 active:scale-[0.99] transition-transform"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    {service.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm leading-tight">{service.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                      {service.description}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-black text-primary">KES {SERVICE_PRICE}</p>
                    <ChevronRight size={16} className="text-muted-foreground ml-auto" />
                  </div>
                </a>
              ))}

              <p className="text-[11px] text-muted-foreground leading-snug pt-2 pb-1">
                Government fees (such as passport or application fees) are paid by you directly, separate from our service fee.
                We help with the application but cannot guarantee approval or a job. Never share your passwords with anyone, including us.
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
