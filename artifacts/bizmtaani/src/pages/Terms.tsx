import { useLocation } from "wouter";
import { ArrowLeft, ChevronRight } from "lucide-react";


export default function Terms() {
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
          Terms of Service
        </span>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-6 pb-24">
        <div className="max-w-2xl mx-auto">

          {/* Introduction */}
          <section className="mb-7">
            <h1 className="text-xl font-black mb-2">
              BizMtaani Terms of Service
            </h1>

            <p className="text-xs text-muted-foreground mb-4">
              Effective date: August 11, 2026
            </p>

            <p className="text-sm text-muted-foreground leading-relaxed">
              These Terms of Service govern your use of BizMtaani. By
              accessing or using BizMtaani, you agree to follow these Terms.
              If you do not agree with them, please do not use the service.
            </p>
          </section>

          {/* 1 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              1. About BizMtaani
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              BizMtaani is a local marketplace platform designed to help users
              discover and advertise products, services, businesses, rentals,
              jobs, events, and other opportunities. BizMtaani provides the
              platform and tools for users to connect with one another.
            </p>
          </section>

          {/* 2 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              2. Eligibility and Account Use
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              You are responsible for providing accurate information when
              creating or using an account.
            </p>

            <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
              <li>Do not impersonate another person or business.</li>
              <li>
                Do not use another person's account without authorization.
              </li>
              <li>
                Keep your login credentials and authentication information
                secure.
              </li>
              <li>
                Notify BizMtaani if you believe your account has been
                compromised.
              </li>
            </ul>
          </section>

          {/* 3 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              3. Posting Adverts
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              When posting an advert, you agree that the information you
              provide is accurate and that you have the right to advertise
              the product, service, property, job, event, or other item.
            </p>

            <p className="text-sm text-muted-foreground leading-relaxed">
              You are responsible for the content of your adverts and for
              responding honestly and appropriately to people who contact you.
            </p>
          </section>

          {/* 4 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              4. Prohibited Activities
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              You must not use BizMtaani to:
            </p>

            <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
              <li>Commit or facilitate fraud or scams.</li>
              <li>Advertise stolen or unlawfully obtained goods.</li>
              <li>Advertise illegal goods or services.</li>
              <li>Sell counterfeit goods while claiming they are genuine.</li>
              <li>Publish intentionally misleading advertisements.</li>
              <li>Impersonate another person, business, or organization.</li>
              <li>Harass, threaten, or abuse other users.</li>
              <li>Upload malicious software or harmful content.</li>
              <li>Spam users or misuse BizMtaani communication features.</li>
              <li>
                Upload content that infringes another person's intellectual
                property or other legal rights.
              </li>
            </ul>
          </section>

          {/* 5 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              5. Advert Expiration
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              Advertisements may have a defined active period depending on
              the selected plan.
            </p>

            <div className="mt-3 bg-card border border-border rounded-2xl p-4 space-y-2">
              <div className="flex justify-between gap-4 text-sm">
                <span className="font-semibold">Free</span>
                <span className="text-muted-foreground">7 days</span>
              </div>

              <div className="flex justify-between gap-4 text-sm">
                <span className="font-semibold">Premium Weekly</span>
                <span className="text-muted-foreground">7 days</span>
              </div>

              <div className="flex justify-between gap-4 text-sm">
                <span className="font-semibold">Premium Monthly</span>
                <span className="text-muted-foreground">30 days</span>
              </div>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              Expired adverts may be archived and may be eligible for
              renewal depending on the features available at the time.
            </p>
          </section>

          {/* 6 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              6. Premium Services and Payments
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              Some BizMtaani features may require payment. Premium services
              and their prices are displayed within the app before payment.
              Payments may be processed through M-Pesa or another supported
              payment provider.
            </p>

            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              You should only approve a payment that you intentionally
              initiated. BizMtaani will never ask you to provide your M-Pesa
              PIN, password, or authentication code through chat, phone calls,
              or messages.
            </p>
          </section>

          {/* 7 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              7. Marketer Program
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              BizMtaani offers an optional referral marketer program. Approval
              to become a marketer is at BizMtaani's sole discretion and
              requires submitting accurate identifying and payout information,
              including your full name, national ID number, and M-Pesa number.
            </p>

            <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
              <li>
                Approved marketers receive a unique referral code to share
                with prospective users.
              </li>
              <li>
                A commission is earned only when a user who registered using
                your referral code completes their first successful Premium
                payment. Subsequent payments by the same referred user do not
                generate additional commission.
              </li>
              <li>
                Commission rates, minimum payout thresholds, and payout
                timing are set by BizMtaani and may be updated from time to
                time. Current terms are displayed within the app.
              </li>
              <li>
                Payouts are made to the M-Pesa number on file for your
                marketer account. You are responsible for keeping this
                information accurate and up to date.
              </li>
              <li>
                BizMtaani may withhold, delay, or deny commission payments
                where there is a reasonable basis to suspect fraudulent
                referrals, self-referral, fake accounts, or other abuse of
                the program.
              </li>
              <li>
                BizMtaani may suspend or terminate a marketer's participation
                in the program, or the program itself, at any time.
              </li>
              <li>
                Referral codes may only be used for new user sign-ups and
                cannot be applied retroactively to existing accounts.
              </li>
            </ul>
          </section>

          {/* 8 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              8. User-to-User Transactions
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              BizMtaani provides a platform for users to discover and connect
              with advertisers. Unless expressly stated otherwise, BizMtaani
              is not a party to transactions between users.
            </p>

            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              Users are responsible for verifying products, services,
              businesses, properties, jobs, sellers, buyers, and other
              information before entering into a transaction.
            </p>
          </section>

          {/* 9 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
  9. Safety
</h2>

            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              For your safety, consider the following:
            </p>

            <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
              <li>Verify important information before making a payment.</li>
              <li>
                Avoid sending money to someone you have not properly verified.
              </li>
              <li>
                Meet in safe and appropriate locations when meeting another
                user.
              </li>
              <li>Do not share passwords or payment PINs.</li>
              <li>Report suspicious or fraudulent activity.</li>
            </ul>
          </section>

          {/* 10 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              10. Reporting and Moderation
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              Users can report adverts, accounts, technical problems, scams,
              inappropriate content, or other issues through the reporting
              tools provided by BizMtaani.
            </p>

            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              BizMtaani may review reported content and may remove content,
              restrict features, suspend accounts, or take other appropriate
              action where necessary.
            </p>
          </section>

          {/* 11 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              11. User Content
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              You retain responsibility for content you submit to BizMtaani.
              By submitting content, you give BizMtaani permission to host,
              store, display, and process that content as reasonably necessary
              to provide and operate the service.
            </p>
          </section>

          {/* 12 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              12. Intellectual Property
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              BizMtaani's software, branding, design, logos, trademarks,
              text, and other platform materials may be protected by applicable
              intellectual property laws. You may not copy, modify, distribute,
              or commercially exploit BizMtaani materials without appropriate
              authorization.
            </p>
          </section>

          {/* 13 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              13. Account Suspension or Removal
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              BizMtaani may restrict, suspend, or terminate accounts or remove
              adverts where there is a reasonable basis to believe that a user
              has violated these Terms, created a security risk, engaged in
              fraud or abuse, or otherwise misused the service.
            </p>
          </section>

          {/* 14 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              14. Service Availability
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              We aim to keep BizMtaani available and reliable, but we cannot
              guarantee uninterrupted access. The service may occasionally be
              unavailable because of maintenance, technical problems,
              infrastructure failures, network issues, or circumstances
              outside our reasonable control.
            </p>
          </section>

          {/* 15 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              15. Marketplace Disclaimer
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              BizMtaani does not guarantee the accuracy, quality, legality,
              availability, ownership, or suitability of every product,
              service, property, job, business, event, or other item posted by
              users.
            </p>

            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              Users should independently verify information and use appropriate
              caution before entering into transactions.
            </p>
          </section>

          {/* 16 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              16. Limitation of Liability
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              To the extent permitted by applicable law, BizMtaani is not
              responsible for losses arising from transactions or interactions
              between users, inaccurate information supplied by users,
              unauthorized conduct by third parties, or events outside
              BizMtaani's reasonable control.
            </p>
          </section>

          {/* 17 */}
          <section className="mb-7">
            <h2 className="text-base font-black mb-2">
              17. Changes to These Terms
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              We may update these Terms from time to time. Updated Terms will
              be made available through BizMtaani. Continued use of the service
              after an update may constitute acceptance of the updated Terms,
              subject to applicable law.
            </p>
          </section>

          {/* 18 */}
          <section className="mb-8">
            <h2 className="text-base font-black mb-2">
              18. Contact Us
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed">
              If you have questions about these Terms or your use of
              BizMtaani, contact us:
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
              onClick={() => setLocation("/privacy")}
              className="w-full flex items-center justify-between gap-3 bg-card border border-border rounded-2xl p-4 text-left active:scale-[0.98] transition-transform"
            >
              <div>
                <p className="font-bold text-sm">Privacy Policy</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Learn how BizMtaani handles your information
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
