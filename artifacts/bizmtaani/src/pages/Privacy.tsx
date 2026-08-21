import { useLocation } from "wouter";
import { ArrowLeft, ChevronRight } from "lucide-react";


export default function Privacy() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-card border-b border-border px-4 h-14 flex items-center gap-3 z-40">
        <button
          onClick={() => setLocation("/about")}
          className="p-2 -ml-2 rounded-xl hover:bg-muted active:scale-95 transition-all"
          aria-label="Back to About"
        >
          <ArrowLeft size={20} />
        </button>

        <span className="font-black text-lg tracking-tight">
          Privacy Policy
        </span>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-6 pb-24">
        <div className="max-w-2xl mx-auto">
          {/* Introduction */}
          <section className="mb-7">
            <h1 className="text-xl font-black mb-2">
              BizMtaani Privacy Policy
            </h1>

            <p className="text-xs text-muted-foreground mb-4">
              Effective date: August 11, 2026
            </p>

            <p className="text-sm text-muted-foreground leading-relaxed">
              BizMtaani respects your privacy and is committed to protecting
              the information you provide when using our marketplace and
              related services. This Privacy Policy explains what information
              we collect, how we use it, and the choices available to you.
            </p>
          </section>

          {/* 1 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              1. Information We Collect
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Depending on how you use BizMtaani, we may collect or receive
              information such as:
            </p>
<ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
              <li>
                Account information such as your name, email address, phone
                number, and profile information.
              </li>
              <li>
                Location information, including your selected area and, where
                you grant permission, device location.
              </li>
              <li>
                Advert information such as titles, descriptions, prices,
                categories, locations, photos, and contact details you choose
                to provide.
              </li>
              <li>
                Information you provide when contacting support or reporting a
                problem.
              </li>
              <li>
                Payment and transaction information associated with purchases
                or premium services.
              </li>
              <li>
                If you apply to become a marketer, your full name, national ID
                number, and M-Pesa number, collected solely to verify your
                identity and process commission payouts.
              </li>
              <li>
                Technical information required to operate, secure, and
                troubleshoot the service.
              </li>
            </ul>

          </section>

          {/* 2 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              2. How We Use Your Information
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              We may use information to:
            </p>

            <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
              <li>Provide and operate BizMtaani.</li>
              <li>Create and manage user accounts.</li>
              <li>Display adverts and marketplace content.</li>
              <li>Personalize local advert discovery.</li>
              <li>Process payments and premium services.</li>
              <li>Respond to customer support requests.</li>
              <li>Investigate reports, fraud, abuse, or security issues.</li>
              <li>Maintain and improve the platform.</li>
              <li>Comply with applicable legal obligations.</li>
            </ul>
          </section>

          {/* 3 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              3. Location Information
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              BizMtaani is designed to help users discover opportunities
              around their selected area. Your selected area may be used to
              determine which adverts are shown to you first. If you grant
              permission for device location, we may use your approximate
              location to improve local discovery.
            </p>

            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              Selecting an area does not mean that you must physically be
              located there to post an advert. You can choose an appropriate
              area when creating a listing.
            </p>
          </section>

          {/* 4 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              4. Information Shown in Adverts
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              Information that you intentionally include in a public advert
              may be visible to other BizMtaani users. This can include your
              advert description, photos, business information, location,
              price, and contact details.
            </p>

            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              Only include personal information that you are comfortable
              sharing publicly or with people contacting you about your
              advert.
            </p>
          </section>

          {/* 5 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              5. Payments
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              Certain BizMtaani services may require payment. Payments may be
              processed through M-Pesa or other payment providers supported by
              BizMtaani.
            </p>

            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              BizMtaani does not ask you to provide your M-Pesa PIN to us.
              Never share your M-Pesa PIN, password, or authentication codes
              with another person.
            </p>
          </section>

          {/* 6 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              6. Marketer Program Data
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              If you apply to become a marketer, we collect your full name,
              national ID number, and M-Pesa number. This information is used
              solely to verify your identity, calculate commissions, and
              process payouts, and is retained for as long as your marketer
              account remains active and as needed to meet our accounting and
              legal obligations.
            </p>

            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              This information is not displayed publicly and is not shared
              with other users. It may be accessed by BizMtaani staff for the
              purposes of reviewing applications and issuing payouts.
            </p>
          </section>

          {/* 7 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              7. Sharing of Information
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              We may share information where reasonably necessary to operate
              BizMtaani, including with:
            </p>

            <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
              <li>Technology and infrastructure service providers.</li>
              <li>Payment and transaction service providers.</li>
              <li>Cloud, storage, hosting, and media service providers.</li>
              <li>Authorities where disclosure is required by law.</li>
              <li>
                Other parties where you have intentionally made information
                public through the platform.
              </li>
            </ul>

            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              We do not sell your personal information as a product to third
              parties.
            </p>
          </section>

          {/* 8 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              8. Advert and User Safety
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              BizMtaani may review reports, adverts, and account activity when
              necessary to investigate fraud, abuse, prohibited content,
              security issues, or violations of our Terms of Service.
            </p>
          </section>

          {/* 9 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              9. Data Retention
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              We retain information for as long as reasonably necessary to
              provide our services, maintain records, resolve disputes,
              enforce our agreements, prevent fraud, and comply with legal or
              regulatory requirements.
            </p>

            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              Advert expiry does not necessarily mean that all associated
              information is immediately and permanently deleted. Some records
              may need to be retained for operational, security, accounting,
              or legal purposes.
            </p>
          </section>

          {/* 10 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              10. Account and Data Requests
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              Depending on applicable law, you may have rights relating to
              your personal information, including requesting access,
              correction, deletion, or other appropriate action.
            </p>

            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              To make a privacy-related request, contact BizMtaani using the
              support details provided below.
            </p>
          </section>

          {/* 11 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              11. Security
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              We use reasonable technical and organizational measures designed
              to protect information against unauthorized access, misuse,
              alteration, or disclosure. However, no internet-based service
              can guarantee absolute security.
            </p>
          </section>

          {/* 12 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              12. Third-Party Services
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              BizMtaani may rely on third-party services for functions such as
              authentication, payments, hosting, cloud infrastructure,
              analytics, maps, messaging, or image storage and delivery.
              Those services may process information according to their own
              privacy policies and applicable agreements.
            </p>
          </section>

          {/* 13 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              13. Children's Privacy
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              BizMtaani is not intended to be used by children in violation of
              applicable law. We do not knowingly seek to collect personal
              information from children where such collection is prohibited.
            </p>
          </section>

          {/* 14 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              14. Changes to This Privacy Policy
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              We may update this Privacy Policy from time to time to reflect
              changes to BizMtaani, our services, or applicable requirements.
              The updated version will be made available through the app.
            </p>
          </section>

          {/* 15 */}
          <section className="mb-8">
            <h2 className="text-base font-black mb-2">
              15. Contact Us
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              If you have questions, concerns, or requests relating to this
              Privacy Policy or your personal information, contact BizMtaani:
            </p>

            <div className="mt-4 bg-card border border-border rounded-2xl p-4">
              <p className="font-bold text-sm">BizMtaani Support</p>

              <p className="text-sm text-muted-foreground mt-2">
                Email: morganmusibi@gmail.com
              </p>

              <p className="text-sm text-muted-foreground mt-1">
                Phone: +254 702 278 606
              </p>
            </div>
          </section>

          {/* Navigation */}
          <div className="border-t border-border pt-5 pb-3">
            <button
              onClick={() => setLocation("/terms")}
              className="w-full flex items-center justify-between gap-3 bg-card border border-border rounded-2xl p-4 text-left active:scale-[0.98] transition-transform"
            >
              <div>
                <p className="font-bold text-sm">Terms of Service</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Read the rules for using BizMtaani
                </p>
              </div>

              <ChevronRight
                size={18}
                className="text-muted-foreground flex-shrink-0"
              />
            </button>
          </div>
        </div>
      </main>

    </div>
  );
}
