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
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import PostProduct from "@/pages/PostProduct";
import ProductDetail from "@/pages/ProductDetail";
import MyListings from "@/pages/MyListings";
import ChatList from "@/pages/ChatList";
import ChatThread from "@/pages/ChatThread";
import Profile from "@/pages/Profile";
import Business from "@/pages/Business";
import Jobs from "@/pages/Jobs";
import PostJob from "@/pages/PostJob";
import JobDetail from "@/pages/JobDetail";
import ShopCatalogue from "@/pages/ShopCatalogue";
import ResetPassword from "@/pages/ResetPassword";

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
      <Route path="/profile" component={Profile} />
      <Route path="/business" component={Business} />
      <Route path="/jobs" component={Jobs} />
      <Route path="/jobs/post" component={PostJob} />
      <Route path="/jobs/:id" component={JobDetail} />
      <Route path="/shop/:userId" component={ShopCatalogue} />
      <Route component={NotFound} />
    </Switch>
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
          <ProfileSetupGate />
          <InstallPrompt />
          <Toaster />
          {showSplash && <SplashScreen onDone={handleSplashDone} />}
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
