import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { TerminalLoader } from "@/components/terminal/TerminalLoader";

// Paths where preserving a redirect param is meaningful.
// Root and index-equivalent paths don't need it — the app always lands there post-login.
const TRIVIAL_PATHS = new Set(["/", "/auth", "/ic-login"]);

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <TerminalLoader label="AUTHENTICATING SESSION" />;

  if (!session) {
    const dest = location.pathname + location.search;
    const to = TRIVIAL_PATHS.has(location.pathname)
      ? "/auth"
      : `/auth?redirect=${encodeURIComponent(dest)}`;
    return <Navigate to={to} replace />;
  }

  return <>{children}</>;
};
