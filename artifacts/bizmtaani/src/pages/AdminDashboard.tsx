import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import {
  Users,
  Package,
  Briefcase,
  CreditCard,
  Flag,
  LayoutDashboard,
  LogOut,
} from "lucide-react";

export default function AdminDashboard() {
  const {
    user,
    isAdmin,
    adminLoading,
  } = useAuth();

  const [, navigate] = useLocation();

  // Wait while Firebase checks the admin custom claim
  if (adminLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Checking administrator access...
          </p>
        </div>
      </div>
    );
  }

  // User is not logged in
  if (!user) {
    navigate("/login");
    return null;
  }

  // User is logged in but is not an admin
  if (!isAdmin) {
    navigate("/");
    return null;
  }

  const stats = [
    {
      title: "Total Users",
      value: "—",
      icon: Users,
    },
    {
      title: "Active Adverts",
      value: "—",
      icon: Package,
    },
    {
      title: "Jobs",
      value: "—",
      icon: Briefcase,
    },
    {
      title: "Payments",
      value: "—",
      icon: CreditCard,
    },
  ];

  const menuItems = [
    {
      title: "Overview",
      icon: LayoutDashboard,
    },
    {
      title: "Users",
      icon: Users,
    },
    {
      title: "Adverts",
      icon: Package,
    },
    {
      title: "Jobs",
      icon: Briefcase,
    },
    {
      title: "Payments",
      icon: CreditCard,
    },
    {
      title: "Reports",
      icon: Flag,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background">
        <div className="flex h-16 items-center justify-between px-4 md:px-8">
          <div>
            <h1 className="text-xl font-bold">
              BizMtaani Admin
            </h1>

            <p className="text-sm text-muted-foreground">
              Platform management dashboard
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Admin account */}
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">
                {user.displayName || "Administrator"}
              </p>

              <p className="text-xs text-muted-foreground">
                {user.email || "Admin account"}
              </p>
            </div>

            {/* Exit dashboard */}
            <button
              type="button"
              onClick={() => navigate("/")}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted"
            >
              <LogOut className="h-4 w-4" />
              Exit
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Desktop Sidebar */}
        <aside className="hidden min-h-[calc(100vh-4rem)] w-64 border-r bg-background md:block">
          <nav className="space-y-1 p-4">
            {menuItems.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  key={item.title}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.title}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-8">
          {/* Page heading */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold">
              Dashboard Overview
            </h2>

            <p className="mt-1 text-muted-foreground">
              Monitor and manage the BizMtaani marketplace.
            </p>
          </div>

          {/* Statistics */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => {
              const Icon = stat.icon;

              return (
                <div
                  key={stat.title}
                  className="rounded-xl border bg-card p-6 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {stat.title}
                      </p>

                      <p className="mt-2 text-3xl font-bold">
                        {stat.value}
                      </p>
                    </div>

                    <div className="rounded-lg bg-muted p-3">
                      <Icon className="h-6 w-6" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recent Activity */}
          <div className="mt-8 rounded-xl border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-semibold">
              Recent Activity
            </h3>

            <div className="mt-6 flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
              Recent platform activity will appear here.
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
