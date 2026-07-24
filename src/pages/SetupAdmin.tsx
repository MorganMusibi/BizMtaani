import { useState } from "react";
import { useLocation } from "wouter";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

export default function SetupAdmin() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);

  const handleGrantAdmin = async () => {
    if (!user) {
      setStatus("You must be logged in first.");
      return;
    }

    setWorking(true);
    setStatus("Granting administrator access...");

    try {
      const setAdminRole = httpsCallable<
        { uid: string },
        { success: boolean; message: string; uid: string }
      >(functions, "setAdminRole");

      const result = await setAdminRole({
        uid: user.uid,
      });

      console.log("Admin setup result:", result.data);

      // Force Firebase to refresh the ID token
      // so the new admin custom claim is available.
      await user.getIdToken(true);

      setStatus(
        "Success! Administrator access has been granted. Log out and log back in, then open /admin."
      );
    } catch (error: any) {
      console.error("Admin setup failed:", error);

      setStatus(
        error?.message ||
          "Failed to grant administrator access."
      );
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Checking your account...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center">
          <h1 className="text-xl font-bold">
            Administrator Setup
          </h1>

          <p className="mt-2 text-sm text-muted-foreground">
            You must be logged in to continue.
          </p>

          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-6 rounded-md bg-primary px-4 py-2 text-primary-foreground"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-bold">
          BizMtaani Admin Setup
        </h1>

        <p className="mt-2 text-sm text-muted-foreground">
          This page grants administrator access to the
          currently signed-in account.
        </p>

        <div className="mt-6 rounded-lg bg-muted p-4">
          <p className="text-xs text-muted-foreground">
            Signed-in account
          </p>

          <p className="mt-1 break-all text-sm font-medium">
            {user.email || user.uid}
          </p>

          <p className="mt-2 text-xs text-muted-foreground">
            UID
          </p>

          <p className="mt-1 break-all text-xs">
            {user.uid}
          </p>
        </div>

        <button
          type="button"
          disabled={working}
          onClick={handleGrantAdmin}
          className="mt-6 w-full rounded-md bg-primary px-4 py-3 font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {working
            ? "Granting Admin Access..."
            : "Grant Me Admin Access"}
        </button>

        {status && (
          <div className="mt-4 rounded-lg border p-4 text-sm">
            {status}
          </div>
        )}

        <button
          type="button"
          onClick={() => navigate("/")}
          className="mt-4 w-full rounded-md border px-4 py-2 text-sm hover:bg-muted"
        >
          Back to BizMtaani
        </button>
      </div>
    </div>
  );
          }
