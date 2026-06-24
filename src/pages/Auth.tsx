import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { toast } from "sonner";

const schema = z.object({
  email:    z.string().trim().email("Please enter a valid email address").max(255),
  password: z.string().min(1, "Password is required").max(128),
});

function sanitizeRedirect(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (/^\/[a-z][a-z\d+\-.]*:/i.test(raw)) return "/";
  return raw;
}

const MAX_ATTEMPTS = 5;
const BASE_LOCKOUT = 30_000;

// ── Portal selection card ──────────────────────────────────────────────────────
function PortalCard({ variant, onClick }: { variant: "staff" | "ic"; onClick: () => void }) {
  const isIC = variant === "ic";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 min-w-0 flex flex-col text-left rounded-xl border-2 bg-card transition-all duration-200 hover:shadow-lg group ${
        isIC
          ? "border-amber-200 hover:border-amber-400 hover:shadow-amber-100"
          : "border-orange-200 hover:border-primary hover:shadow-orange-100"
      }`}
      style={{ boxShadow: "var(--shadow-panel)" }}
    >
      {/* Card top accent */}
      <div className={`h-1.5 rounded-t-xl w-full ${isIC ? "bg-amber-500" : "bg-primary"}`} />

      <div className="px-6 py-6 flex flex-col gap-5 flex-1">
        {/* Icon */}
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
          isIC ? "bg-amber-50 text-amber-600" : "bg-orange-50 text-primary"
        }`}>
          {isIC ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          )}
        </div>

        {/* Title */}
        <div>
          <div className="text-lg font-bold text-foreground leading-tight">
            {isIC ? "IC Review Portal" : "Staff Portal"}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {isIC ? "For investment committee members" : "For analysts and operations staff"}
          </div>
        </div>

        {/* Who it's for */}
        <ul className="space-y-1.5">
          {(isIC
            ? ["IC Members", "Credit Committee", "Administrators"]
            : ["Credit Analysts", "Business Development", "Operations"]
          ).map(role => (
            <li key={role} className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isIC ? "bg-amber-400" : "bg-primary/60"}`} />
              {role}
            </li>
          ))}
        </ul>
      </div>

      {/* CTA */}
      <div className="px-6 pb-6">
        <div className={`w-full py-3 rounded-lg text-center text-sm font-semibold transition-colors ${
          isIC
            ? "bg-amber-50 text-amber-700 group-hover:bg-amber-100 border border-amber-200"
            : "bg-orange-50 text-primary group-hover:bg-orange-100 border border-orange-200"
        }`}>
          {isIC ? "Sign in to IC Portal" : "Sign in to Staff Portal"}
          <span className="ml-1.5">→</span>
        </div>
      </div>
    </button>
  );
}

// ── Login panel ────────────────────────────────────────────────────────────────
interface LoginPanelProps {
  variant:    "staff" | "ic";
  redirectTo: string;
  onBack:     () => void;
}

function LoginPanel({ variant, redirectTo, onBack }: LoginPanelProps) {
  const navigate    = useNavigate();
  const { session } = useAuth();

  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [attempts, setAttempts]       = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  const isIC = variant === "ic";

  useEffect(() => {
    if (session) navigate(isIC ? "/ic" : redirectTo, { replace: true });
  }, [session, navigate, isIC, redirectTo]);

  const remainingSecs = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Date.now() < lockedUntil) {
      toast.error(`Too many attempts. Try again in ${remainingSecs} seconds`);
      return;
    }
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const next = attempts + 1;
        setAttempts(next);
        if (next >= MAX_ATTEMPTS) {
          const delay = BASE_LOCKOUT * Math.pow(2, next - MAX_ATTEMPTS);
          setLockedUntil(Date.now() + Math.min(delay, 10 * 60_000));
          toast.error(`Too many failed attempts. Please wait ${Math.ceil(delay / 1000)} seconds.`);
        } else {
          toast.error("Incorrect email or password. Please try again.");
        }
      } else {
        setAttempts(0);
        setLockedUntil(0);
      }
    } catch {
      toast.error("Sign-in error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
      {/* Top accent */}
      <div className={`h-1 w-full ${isIC ? "bg-amber-500" : "bg-primary"}`} />

      {/* Back + Header */}
      <div className="px-8 pt-6 pb-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
          </svg>
          Back to portal selection
        </button>

        {/* Portal badge */}
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-4 ${
          isIC ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-orange-50 text-primary border border-orange-200"
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${isIC ? "bg-amber-500" : "bg-primary"}`} />
          {isIC ? "IC Review Portal" : "Staff Portal"}
        </div>

        <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
        <p className="text-sm text-muted-foreground mt-1 mb-8">
          {isIC
            ? "Sign in with your IC member credentials to access the review portal."
            : "Sign in with your staff credentials to access the platform."}
        </p>
      </div>

      {/* Form */}
      <form onSubmit={submit} className="px-8 pb-8 space-y-5">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
            placeholder={isIC ? "icmember@rehbar.co.in" : "analyst@rehbar.co.in"}
            className={`w-full bg-background border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 transition-colors ${
              isIC
                ? "border-border focus:border-amber-400 focus:ring-amber-100"
                : "border-border focus:border-primary focus:ring-primary/10"
            }`}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Password
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="Enter your password"
              className={`w-full bg-background border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 transition-colors pr-12 ${
                isIC
                  ? "border-border focus:border-amber-400 focus:ring-amber-100"
                  : "border-border focus:border-primary focus:ring-primary/10"
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(s => !s)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              {showPassword ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {remainingSecs > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Account temporarily locked. Try again in {remainingSecs} seconds.
          </div>
        )}

        <button
          type="submit"
          disabled={loading || Date.now() < lockedUntil}
          className={`w-full py-3.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            isIC
              ? "bg-amber-500 text-white hover:bg-amber-600"
              : "bg-primary text-white hover:bg-primary/90"
          }`}
        >
          {loading ? "Signing in…" : remainingSecs > 0 ? `Locked (${remainingSecs}s)` : "Sign In"}
        </button>

        <p className="text-xs text-center text-muted-foreground">
          Having trouble signing in? Contact your administrator.
        </p>
      </form>
    </div>
  );
}

// ── Auth page ──────────────────────────────────────────────────────────────────
const Auth = () => {
  const location    = useLocation();
  const navigate    = useNavigate();
  const { session } = useAuth();
  const redirectTo  = sanitizeRedirect(new URLSearchParams(location.search).get("redirect"));

  const [view, setView]     = useState<"select" | "login">("select");
  const [portal, setPortal] = useState<"staff" | "ic" | null>(null);

  useEffect(() => {
    if (session) navigate(redirectTo, { replace: true });
  }, [session, navigate, redirectTo]);

  const selectPortal = (v: "staff" | "ic") => { setPortal(v); setView("login"); };
  const goBack       = () => { setView("select"); setPortal(null); };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 gap-8">

      {/* Logo + Brand */}
      <div className="text-center">
        <img
          src="/Rehbar_logo.png"
          alt="Rehbar Financial Services"
          className="h-14 w-auto object-contain mx-auto mb-4"
        />
        <h1 className="text-xl font-bold text-foreground">Rehbar Financial Services</h1>
        <p className="text-sm text-muted-foreground mt-1">Credit Analysis Platform</p>
      </div>

      {view === "select" ? (
        <div className="w-full max-w-2xl">
          <p className="text-center text-sm font-medium text-muted-foreground mb-6">
            Select your portal to continue
          </p>
          <div className="flex flex-col md:flex-row gap-4">
            <PortalCard variant="staff" onClick={() => selectPortal("staff")} />
            <PortalCard variant="ic"    onClick={() => selectPortal("ic")}    />
          </div>
        </div>
      ) : (
        <div className="w-full max-w-md">
          <LoginPanel variant={portal!} redirectTo={redirectTo} onBack={goBack} />
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center">
        © Rehbar Financial Services · All sessions are encrypted and audited
      </p>
    </div>
  );
};

export default Auth;
