import { ref, uploadBytes, getDownloadURL, deleteObject, } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { signOut, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { LogOut, Package, MessageCircle, Camera, Loader2, Store, Briefcase, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { BottomNav } from "@/components/BottomNav";
import imageCompression from "browser-image-compression";

export default function Profile() {
  const [, setLocation] = useLocation();
  const { user, userProfile } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [showPhotoViewer, setShowPhotoViewer] = useState(false);
const hasPhoto = !!user?.photoURL;

async function handleAvatarChange(
  e: React.ChangeEvent<HTMLInputElement>
) {
  const file = e.target.files?.[0];

  if (!file || !user) return;

  if (file.size > 5 * 1024 * 1024) {
    toast({
      title: "Image too large",
      description: "Maximum 5 MB.",
      variant: "destructive",
    });
    return;
  }

  setUploading(true);

  try {
    // STEP 1: Compress image
    console.log("STEP 1: Compressing image...");

    const compressedFile = await imageCompression(file, {
      maxSizeMB: 0.4,
      maxWidthOrHeight: 800,
      useWebWorker: true,
      initialQuality: 0.85,
      fileType: "image/jpeg",
    });

    console.log(
      "STEP 1 SUCCESS:",
      compressedFile.size,
      "bytes"
    );

    // STEP 2: Create Storage path
    const oldStoragePath =
      userProfile?.photoStoragePath;

    const newStoragePath =
      `avatars/${user.uid}/${Date.now()}.jpg`;

    console.log(
      "STEP 2: Uploading to:",
      newStoragePath
    );

    const storageRef = ref(
      storage,
      newStoragePath
    );

    // STEP 3: Upload to Firebase Storage
    await uploadBytes(
      storageRef,
      compressedFile,
      {
        contentType: "image/jpeg",
        cacheControl:
          "public,max-age=31536000,immutable",
      }
    );

    console.log(
      "STEP 3 SUCCESS: Storage upload complete"
    );

    // STEP 4: Get download URL
    const photoURL =
      await getDownloadURL(storageRef);

    console.log(
      "STEP 4 SUCCESS: Got photo URL"
    );

    // STEP 5: Update Firebase Auth
    await updateProfile(user, {
      photoURL,
    });

    console.log(
      "STEP 5 SUCCESS: Auth profile updated"
    );

    // STEP 6: Update Firestore
    await updateDoc(
      doc(db, "users", user.uid),
      {
        photoURL,
        photoStoragePath:
          newStoragePath,
      }
    );

    console.log(
      "STEP 6 SUCCESS: Firestore updated"
    );

    // STEP 7: Delete old photo
    if (
      oldStoragePath &&
      oldStoragePath !== newStoragePath
    ) {
      try {
        const oldStorageRef =
          ref(storage, oldStoragePath);

        await deleteObject(
          oldStorageRef
        );

        console.log(
          "STEP 7 SUCCESS: Old photo deleted"
        );
      } catch (deleteError) {
        console.warn(
          "Old photo could not be deleted:",
          deleteError
        );
      }
    }

    toast({
      title: "Profile photo updated",
    });

    window.location.reload();

  } catch (error: any) {

    console.error(
      "PROFILE PHOTO ERROR:",
      error
    );

    console.error(
      "ERROR CODE:",
      error?.code
    );

    console.error(
      "ERROR MESSAGE:",
      error?.message
    );

    toast({
      title: "Upload failed",
      description:
        error?.message ||
        "Something went wrong.",
      variant: "destructive",
    });

  } finally {

    setUploading(false);

    if (fileRef.current) {
      fileRef.current.value = "";
    }

    if (cameraRef.current) {
      cameraRef.current.value = "";
    }

  }
}
 
  async function handleDeleteAvatar() {
  if (!user) return;

  try {
    const storagePath = userProfile?.photoStoragePath;

    // Delete the actual current profile photo from Storage.
    if (storagePath) {
      try {
        const storageRef = ref(storage, storagePath);
        await deleteObject(storageRef);
      } catch (deleteError) {
        console.warn("Could not delete profile photo:", deleteError);
      }
    }

    // Remove the photo from Firebase Authentication.
    await updateProfile(user, {
      photoURL: "",
    });

    // Remove the photo information from Firestore.
    await updateDoc(doc(db, "users", user.uid), {
      photoURL: "",
      photoStoragePath: "",
    });

    setShowAvatarMenu(false);

    toast({
      title: "Profile photo removed",
    });

    window.location.reload();
  } catch (error) {
    console.error(error);

    toast({
      title: "Failed to remove photo",
      variant: "destructive",
    });
  }
}

  async function handleSignOut() {
    await signOut(auth);
    toast({ title: "Signed out" });
    setLocation("/");
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background pb-20 flex flex-col items-center justify-center gap-4 px-6">
        <div className="text-center">
          <h2 className="font-black text-2xl">Your Profile</h2>
          <p className="text-muted-foreground mt-1">Sign in to manage your account</p>
        </div>
        <Button data-testid="button-signin" onClick={() => setLocation("/login")} className="w-full max-w-xs">
          Sign In
        </Button>
        <BottomNav />
      </div>
    );
  }

  const displayName = userProfile?.businessName || userProfile?.displayName || user.displayName || "Seller";
  const isBusinessOwner = userProfile?.isBusinessOwner ?? false;

  const initials = displayName
    .split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 bg-card border-b border-border px-4 h-14 flex items-center">
        <h1 className="font-black text-lg">Profile</h1>
      </header>

      <div className="px-4 py-6 max-w-lg mx-auto space-y-6">

        {/* Avatar + info */}
        <div className="flex items-center gap-4">
           <button
  type="button"
  onClick={() => {
    if (uploading) return;

    if (hasPhoto) {
      setShowPhotoViewer(true);
    } else {
      setShowAvatarMenu(true);
    }
  }}
  disabled={uploading}
  className="relative w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 focus:outline-none"
>
  {user.photoURL ? (
    <img
      src={user.photoURL}
      alt={displayName}
      className="w-full h-full object-cover"
    />
  ) : (
    <div className="w-full h-full bg-primary flex items-center justify-center">
      <span className="text-white text-2xl font-black">
        {initials}
      </span>
    </div>
  )}

  <div
    onClick={(e) => {
      e.stopPropagation();
      setShowAvatarMenu(true);
    }}
    className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary border-2 border-white flex items-center justify-center cursor-pointer"
  >
    {uploading ? (
      <Loader2 size={14} className="animate-spin text-white" />
    ) : (
      <Camera size={14} className="text-white" />
    )}
  </div>
</button>

          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleAvatarChange} />

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p data-testid="text-display-name" className="font-black text-xl truncate">
                {displayName}
              </p>
              {isBusinessOwner && (
                <span className="flex-shrink-0 text-[10px] font-black bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  BIZ
                </span>
              )}
            </div>
            <p data-testid="text-email" className="text-muted-foreground text-sm">{user.email}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
  Tap photo to view • Tap camera to change
</p>
          </div>
        </div>

        {showAvatarMenu && (
          <>
            <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setShowAvatarMenu(false)} />
            <div
              className="fixed bottom-0 left-0 right-0 z-50 bg-card rounded-t-3xl border-t border-border px-4 pb-8 pt-4"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)" }}
            >
              <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-5" />
<p className="font-bold text-sm text-center mb-4">Change profile photo</p>

<div className="space-y-2">
  <button
    onClick={() => {
      setShowAvatarMenu(false);
      cameraRef.current?.click();
    }}
    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-muted font-semibold text-sm"
  >
    <Camera size={20} className="text-primary" />
    Take a photo
  </button>

  <button
    onClick={() => {
      setShowAvatarMenu(false);
      fileRef.current?.click();
    }}
    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-muted font-semibold text-sm"
  >
    <Package size={20} className="text-primary" />
    Choose from gallery
  </button>

  {hasPhoto && (
    <button
      onClick={handleDeleteAvatar}
      className="w-full flex items-center justify-center px-4 py-3.5 rounded-2xl bg-red-50 text-red-600 font-semibold text-sm"
    >
      Delete Photo
    </button>
  )}

  <button
    onClick={() => setShowAvatarMenu(false)}
    className="w-full flex items-center justify-center px-4 py-3.5 rounded-2xl font-semibold text-sm text-muted-foreground"
  >
    Cancel
  </button>
</div>
            </div>
          </>
        )}

        {/* Quick links grid */}
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/my-listings"
            data-testid="link-my-listings"
            className="flex flex-col items-center gap-2 p-4 bg-card rounded-2xl border border-border hover:border-primary transition-colors"
          >
            <Package size={22} className="text-primary" />
            <span className="font-semibold text-xs text-center">My Listings</span>
          </Link>
          <Link
            href="/chats"
            data-testid="link-my-chats"
            className="flex flex-col items-center gap-2 p-4 bg-card rounded-2xl border border-border hover:border-primary transition-colors"
          >
            <MessageCircle size={22} className="text-primary" />
            <span className="font-semibold text-xs text-center">Messages</span>
          </Link>
        </div>

        {/* Business management — only for business owners */}
        {isBusinessOwner && (
          <button
            onClick={() => setLocation("/business")}
            className="w-full flex items-center gap-4 px-4 py-4 bg-gradient-to-r from-primary/10 to-orange-50 border-2 border-primary/30 rounded-2xl hover:border-primary transition-all text-left active:scale-[0.98]"
          >
            <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center flex-shrink-0">
              <Store size={22} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm">Manage My Business</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Dashboard, listings, shop profile & tools
              </p>
            </div>
            <ChevronRight size={18} className="text-muted-foreground flex-shrink-0" />
          </button>
        )}

        {/* Jobs link */}
        <button
          onClick={() => setLocation("/jobs")}
          className="w-full flex items-center gap-4 px-4 py-4 bg-card border border-border rounded-2xl hover:border-primary/40 transition-all text-left active:scale-[0.98]"
        >
          <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
            <Briefcase size={22} className="text-blue-700" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm">Jobs Board</p>
            <p className="text-xs text-muted-foreground mt-0.5">Browse jobs or post a vacancy</p>
          </div>
          <ChevronRight size={18} className="text-muted-foreground flex-shrink-0" />
        </button>

        <Button
          data-testid="button-signout"
          variant="outline"
          className="w-full h-12 gap-2 text-destructive border-destructive/30 hover:bg-destructive/5"
          onClick={handleSignOut}
        >
          <LogOut size={16} />
          Sign Out
        </Button>
      </div>
    {showPhotoViewer && (
  <div
    className="fixed inset-0 z-50 bg-black flex items-center justify-center"
    onClick={() => setShowPhotoViewer(false)}
  >
    <img
      src={user.photoURL!}
      alt={displayName}
      className="max-w-full max-h-full object-contain"
      onClick={(e) => e.stopPropagation()}
    />

    <button
      className="absolute top-5 right-5 text-white text-4xl"
      onClick={() => setShowPhotoViewer(false)}
    >
      ✕
    </button>

    <button
      className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-primary text-white px-6 py-3 rounded-xl"
      onClick={(e) => {
        e.stopPropagation();
        setShowPhotoViewer(false);
        setShowAvatarMenu(true);
      }}
    >
      Change Photo
    </button>
  </div>
)}
      <BottomNav />
    </div>
  );
}
