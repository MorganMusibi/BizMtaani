export function RecaptchaDisclosure() {
  return (
    <p className="fixed bottom-1 left-1 z-30 text-[9px] text-muted-foreground/60 pointer-events-none pr-2">
      Protected by reCAPTCHA —{" "}
      <a
        href="https://policies.google.com/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className="underline pointer-events-auto"
      >
        Privacy
      </a>{" "}
      &{" "}
      <a
        href="https://policies.google.com/terms"
        target="_blank"
        rel="noopener noreferrer"
        className="underline pointer-events-auto"
      >
        Terms
      </a>
    </p>
  );
}
