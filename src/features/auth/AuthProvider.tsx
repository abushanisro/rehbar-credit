import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  role: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  role: null,
  loading: true,
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession]       = useState<Session | null>(null);
  const [role, setRole]             = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [roleReady, setRoleReady]   = useState(false);

  // loading stays true until BOTH session and role are resolved
  const loading = !sessionReady || (!!session?.user?.id && !roleReady);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s?.user?.id) { setRole(null); setRoleReady(true); }
      setSessionReady(true);
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (!s?.user?.id) { setRole(null); setRoleReady(true); }
      setSessionReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) { setRole(null); setRoleReady(true); return; }
    setRoleReady(false);
    supabase.from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .limit(1)
      .single()
      .then(({ data, error }) => {
        const VALID_ROLES = ["admin", "analyst", "business_development", "ic_member", "credit_committee", "operations"];
        if (error || !data || !VALID_ROLES.includes(data.role)) {
          // Fail-safe to null — never default to a privileged role on error
          setRole(null);
        } else {
          setRole(data.role);
        }
        setRoleReady(true);
      });
  }, [session?.user?.id]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, role, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
