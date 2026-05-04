import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AnalystChat } from "@/components/analyst/AnalystChat";
import Auth from "./pages/Auth";
import Pipeline from "./pages/Pipeline";
import NewCase from "./pages/NewCase";
import CaseView from "./pages/CaseView";
import Companies from "./pages/Companies";
import CompanyView from "./pages/CompanyView";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// Renders the analyst chat on every protected page, hidden on /auth
function AnalystChatGuard() {
  const { pathname } = useLocation();
  if (pathname === "/auth") return null;
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
              <Route path="/" element={<ProtectedRoute><ErrorBoundary><Pipeline /></ErrorBoundary></ProtectedRoute>} />
              <Route path="/new" element={<ProtectedRoute><ErrorBoundary><NewCase /></ErrorBoundary></ProtectedRoute>} />
              <Route path="/case/:id" element={<ProtectedRoute><ErrorBoundary><CaseView /></ErrorBoundary></ProtectedRoute>} />
              <Route path="/companies" element={<ProtectedRoute><ErrorBoundary><Companies /></ErrorBoundary></ProtectedRoute>} />
              <Route path="/companies/:id" element={<ProtectedRoute><ErrorBoundary><CompanyView /></ErrorBoundary></ProtectedRoute>} />
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
