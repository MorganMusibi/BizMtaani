import { useState } from "react";
import { useLocation } from "wouter";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { SiGoogle } from "react-icons/si";
import { Loader2 } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      setLocation("/");
    } catch (err: unknown) {
      toast({
        title: "Login failed",
        description: err instanceof Error ? err.message : "Check your credentials.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setGoogleLoading(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      setLocation("/");
    } catch (err: unknown) {
      toast({
        title: "Google sign-in failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 flex flex-col justify-center px-6 py-12 max-w-sm mx-auto w-full">
        <div className="mb-10">
          <div className="w-14 h-14 mb-6">
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <defs>
                <linearGradient id="lbg" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#047857"/>
                  <stop offset="100%" stopColor="#022C22"/>
                </linearGradient>
                <linearGradient id="law" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FB923C"/>
                  <stop offset="100%" stopColor="#EA580C"/>
                </linearGradient>
              </defs>
              <rect width="100" height="100" rx="22" fill="url(#lbg)"/>
              <path d="M14 40 L50 24 L86 40 L82 49 L18 49 Z" fill="url(#law)"/>
              <rect x="18" y="47" width="64" height="34" rx="3" fill="white" opacity="0.97"/>
              <rect x="23" y="53" width="15" height="11" rx="2.5" fill="#D1FAE5"/>
              <rect x="43" y="55" width="14" height="26" rx="2" fill="#065F46"/>
              <rect x="62" y="53" width="15" height="11" rx="2.5" fill="#D1FAE5"/>
              <rect x="12" y="79" width="76" height="4" rx="2" fill="#F97316" opacity="0.45"/>
            </svg>
          </div>
          <h1 className="text-3xl font-black text-foreground">Welcome back</h1>
          <p className="text-muted-foreground mt-1">Sign in to BizMtaani</p>
        </div>

        <Button
          data-testid="button-google-signin"
          type="button"
          variant="outline"
          className="w-full h-12 gap-3 font-semibold mb-6"
          onClick={handleGoogleLogin}
          disabled={googleLoading}
        >
          {googleLoading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <SiGoogle size={18} />
          )}
          Continue with Google
        </Button>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-background px-3 text-xs text-muted-foreground uppercase tracking-wider">
              or
            </span>
          </div>
        </div>

        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              data-testid="input-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-12"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              data-testid="input-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-12"
            />
          </div>
          <Button
            data-testid="button-login"
            type="submit"
            className="w-full h-12 font-bold text-base"
            disabled={loading}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link href="/register" className="text-primary font-semibold">
            Create one free
          </Link>
        </p>
      </div>
    </div>
  );
}
