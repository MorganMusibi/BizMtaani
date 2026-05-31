import { useLocation } from "wouter";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background gap-4 px-4">
      <div className="w-16 h-16 rounded-3xl bg-destructive/10 flex items-center justify-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
      </div>
      <h1 className="text-2xl font-black text-foreground">Page Not Found</h1>
      <p className="text-sm text-muted-foreground text-center">
        The page you're looking for doesn't exist.
      </p>
      <button
        onClick={() => setLocation("/")}
        className="px-6 py-2.5 rounded-xl bg-primary text-white font-semibold text-sm"
      >
        Go Home
      </button>
    </div>
  );
}
