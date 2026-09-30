import { useState, useCallback } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LocationProvider } from "@/contexts/LocationContext"; // <-- ADD THIS
import { useNotifications } from "@/hooks/useNotifications";
import { ProfileSetupModal } from "@/components/ProfileSetupModal";
import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";
import { InstallPrompt } from "@/components/InstallPrompt";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { RecaptchaDisclosure } from "@/components/RecaptchaDisclosure";
import { lazy, Suspense } from "react";
import { useLocation } from "wouter";
import Home from "@/pages/Home";
import { BottomNav } from "@/components/BottomNav";

const NotFound = lazy(() => import("@/pages/not-found"));
const Login = lazy(() => import("@/pages/Login"));
const Register = lazy(() => import("@/pages/Register"));
const About = lazy(() => import("@/pages/About"));
const Privacy = lazy(() => import("@/pages/Privacy"));
const Terms = lazy(() => import("@/pages/Terms"));
const Report = lazy(() => import("@/pages/Report"));
const PostProduct = lazy(() => import("@/pages/PostProduct"));
const ProductDetail = lazy(() => import("@/pages/ProductDetail"));
const MyListings = lazy(() => import("@/pages/MyListings"));
const ChatList = lazy(() => import("@/pages/ChatList"));
const ChatThread = lazy(() => import("@/pages/ChatThread"));
const Profile = lazy(() => import("@/pages/Profile"));
const Business = lazy(() => import("@/pages/Business"));
const Jobs = lazy(() => import("@/pages/Jobs"));
const PostJob = lazy(() => import("@/pages/PostJob"));
const JobDetail = lazy(() => import("@/pages/JobDetail"));
const ShopCatalogue = lazy(() => import("@/pages/ShopCatalogue"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const AdminDashboard = lazy(() => import("@/pages/AdminDashboard"));
const CategorySubcategories = lazy(() => import("@/pages/CategorySubcategories"));
const CategoryAds = lazy(() => import("@/pages/CategoryAds"));
const MarketerDashboard = lazy(() => import("@/pages/MarketerDashboard"));
const ClaimListing = lazy(() => import("@/pages/ClaimListing"));
const WardCategoryPage = lazy(() => import("@/pages/WardCategoryPage"));

// Configuration for API requests
// Updated path to correctly reach the root lib folder
import { setBaseUrl } from "../../../lib/api-client-react/src/custom-fetch"; 

// Sets the base URL to your production Firebase Cloud Functions
setBaseUrl('https://us-central1-bizmtaani-f50d5.cloudfunctions.net');

const queryClient = new QueryClient();

function NotificationSetup() {
  useAuth();
  useNotifications();
  return null;
}

function InstallPromptGate() {
  const { user, likelySignedIn } = useAuth();

  // Only offer installation once someone has actually signed up —
  // showing it to a cold, first-time, not-yet-signed-in visitor is
  // exactly the kind of premature ask that erodes trust before it's
  // been earned.
  if (!user && !likelySignedIn) return null;

  return <InstallPrompt />;
}
function ProfileSetupGate() {
  const { user, userProfile, profileLoading } = useAuth();

  // 1. Wait until auth/profile finished loading
  if (!user || profileLoading) return null;

  // 2. If userProfile exists and already has isBusinessOwner defined, skip modal
  if (userProfile && typeof userProfile.isBusinessOwner === "boolean") {
    return null;
  }

  // 3. Otherwise, render setup modal
  return <ProfileSetupModal />;
}


// BottomNav is hidden on full-screen flows where it would get in
// the way: auth screens and the chat thread itself.
const HIDDEN_BOTTOM_NAV_PREFIXES = ["/login", "/register", "/reset-password", "/chat/", "/admin"];
function useShouldShowBottomNav(): boolean {
  const [location] = useLocation();
  return !HIDDEN_BOTTOM_NAV_PREFIXES.some((prefix) => location.startsWith(prefix));
}

function Router() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/login" component={Login} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/register" component={Register} />
        <Route path="/post" component={PostProduct} />
        <Route path="/product/:id" component={ProductDetail} />
        <Route path="/my-listings" component={MyListings} />
        <Route path="/chats" component={ChatList} />
        <Route path="/chat/:chatId" component={ChatThread} />
        <Route path="/about" component={About} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />
        <Route path="/report" component={Report} />
        <Route path="/profile" component={Profile} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/business" component={Business} />
        <Route path="/jobs" component={Jobs} />
        <Route path="/jobs/post" component={PostJob} />
        <Route path="/jobs/:id" component={JobDetail} />
        <Route path="/shop/:userId" component={ShopCatalogue} />
        <Route path="/category/:categoryKey" component={CategorySubcategories} />
        <Route path="/category/:categoryKey/:subcategory" component={CategoryAds} />
        <Route path="/marketer" component={MarketerDashboard} />
        <Route path="/claim/:listingId" component={ClaimListing} />
        <Route path="/:countySlug/:wardSlug/:categorySlug" component={WardCategoryPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  const showBottomNav = useShouldShowBottomNav();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <LocationProvider> {/* <-- WRAP WITH LocationProvider HERE */}
            <NotificationSetup />
            <EmailVerificationBanner />
            <div className="md:max-w-2xl md:mx-auto md:border-x md:border-border md:min-h-screen">
             <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
              </WouterRouter>
              {showBottomNav && <BottomNav />}
             </div>
            <ProfileSetupGate />
            <InstallPromptGate />
            <UpdatePrompt />
            <RecaptchaDisclosure />
            <Toaster />
          </LocationProvider> {/* <-- CLOSE LocationProvider HERE */}
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
