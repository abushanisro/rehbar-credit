import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/features/auth/AuthProvider";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AnalystChat } from "@/components/analyst/AnalystChat";
import Auth from "./pages/Auth";
import Pipeline from "./pages/Pipeline";
import NewCase from "./pages/NewCase";
import CaseView from "./pages/CaseView";
import Companies from "./pages/Companies";
import CompanyView from "./pages/CompanyView";
import Users from "./pages/Users";
import ICReview from "./pages/ICReview";
import ICAuth from "./pages/ICAuth";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// Redirects IC-only roles away from staff pages to /ic
// By the time this renders, ProtectedRoute has already waited for both
// session + role to resolve, so role is always definitive here.
function StaffOnly({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  if (["ic_member", "credit_committee"].includes(role ?? "")) return <Navigate to="/ic" replace />;
  return <>{children}</>;
}

// Renders the analyst chat on every protected page, hidden on /auth and /ic
function AnalystChatGuard() {
  const { pathname } = useLocation();
  const { role } = useAuth();
  if (pathname === "/auth" || ["ic_member", "credit_committee"].includes(role ?? "")) return null;
  return <AnalystChat />;
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner theme="dark" />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/ic-login" element={<ICAuth />} />
              <Route path="/" element={<ProtectedRoute><StaffOnly><ErrorBoundary><Pipeline /></ErrorBoundary></StaffOnly></ProtectedRoute>} />
              <Route path="/new" element={<ProtectedRoute><StaffOnly><ErrorBoundary><NewCase /></ErrorBoundary></StaffOnly></ProtectedRoute>} />
              <Route path="/case/:id" element={<ProtectedRoute><StaffOnly><ErrorBoundary><CaseView /></ErrorBoundary></StaffOnly></ProtectedRoute>} />
              <Route path="/companies" element={<ProtectedRoute><StaffOnly><ErrorBoundary><Companies /></ErrorBoundary></StaffOnly></ProtectedRoute>} />
              <Route path="/companies/:id" element={<ProtectedRoute><StaffOnly><ErrorBoundary><CompanyView /></ErrorBoundary></StaffOnly></ProtectedRoute>} />
              <Route path="/users" element={<ProtectedRoute><StaffOnly><ErrorBoundary><Users /></ErrorBoundary></StaffOnly></ProtectedRoute>} />
              <Route path="/ic" element={<ProtectedRoute><ErrorBoundary><ICReview /></ErrorBoundary></ProtectedRoute>} />
              <Route path="/history" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            <AnalystChatGuard />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
