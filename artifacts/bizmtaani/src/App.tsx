import { useState, useCallback } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/hooks/useNotifications";
import { ProfileSetupModal } from "@/components/ProfileSetupModal";
import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";
import { InstallPrompt } from "@/components/InstallPrompt";
import { SplashScreen } from "@/components/SplashScreen";
import { RecaptchaDisclosure } from "@/components/RecaptchaDisclosure";
import NotFound from "@/pages/not-found";
import { lazy, Suspense } from "react";
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

// Configuration for API requests
// Updated path to correctly reach the root lib folder
import { setBaseUrl } from "../../../lib/api-client-react/src/custom-fetch"; 

// Sets the base URL to your production Firebase Cloud Functions
setBaseUrl('https://us-central1-bizmtaani-f50d5.cloudfunctions.net');

const queryClient = new QueryClient();

// Show splash once per browser session (not on every SPA navigation)
const splashAlreadyShown = sessionStorage.getItem("bm_splash") === "1";

function NotificationSetup() {
  useAuth();
  useNotifications();
  return null;
}

function ProfileSetupGate() {
  const { user, userProfile, profileLoading } = useAuth();
  if (!user || profileLoading || userProfile !== null) return null;
  return <ProfileSetupModal />;
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
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  const [showSplash, setShowSplash] = useState(!splashAlreadyShown);

  const handleSplashDone = useCallback(() => {
    sessionStorage.setItem("bm_splash", "1");
    setShowSplash(false);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <NotificationSetup />
          <EmailVerificationBanner />
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
          </WouterRouter>
          <BottomNav />
          <ProfileSetupGate />
          <InstallPrompt />
          <RecaptchaDisclosure />
          <Toaster />
          {showSplash && <SplashScreen onDone={handleSplashDone} />}
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
