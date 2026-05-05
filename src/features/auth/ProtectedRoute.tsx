import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { TerminalLoader } from "@/components/terminal/TerminalLoader";

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <TerminalLoader label="AUTHENTICATING SESSION" />;
  if (!session) return <Navigate to={`/auth?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
};
