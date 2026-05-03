import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { TerminalLoader } from "@/components/terminal/TerminalLoader";

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, loading } = useAuth();
  if (loading) return <TerminalLoader label="AUTHENTICATING SESSION" />;
  if (!session) return <Navigate to="/auth" replace />;
  return <>{children}</>;
};
