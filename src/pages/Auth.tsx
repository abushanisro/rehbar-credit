import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { toast } from "sonner";

const schema = z.object({
  email:    z.string().trim().email("Invalid email").max(255),
  password: z.string().min(1, "Password required").max(128),
});

/** Allow only same-origin relative paths — blocks open-redirect attacks. */
function sanitizeRedirect(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (/^\/[a-z][a-z\d+\-.]*:/i.test(raw)) return "/";
  return raw;
}

// ─── Boot sequences ───────────────────────────────────────────────────────────

const STAFF_LINES = [
  { text: "CREDIT TERMINAL v1.0.0",                       color: "text-primary",          delay: 0   },
  { text: "REHBAR FINANCIAL SERVICES",                    color: "text-muted-foreground", delay: 0   },
  { text: "",                                              color: "",                      delay: 150 },
  { text: "LOADING FINANCIAL RATIO MATRIX............[OK]",    color: "text-success", delay: 60 },
  { text: "DSCR COMPUTATION MODULE...................[ONLINE]", color: "text-success", delay: 60 },
  { text: "CLAUDE SONNET 4.6 API....................[READY]",   color: "text-success", delay: 60 },
  { text: "SHARIA COMPLIANCE ENGINE..................[ACTIVE]",  color: "text-success", delay: 60 },
  { text: "",                                              color: "",                      delay: 200 },
  { text: "> AWAITING OPERATOR AUTHENTICATION_",           color: "text-primary",          delay: 0   },
];

const IC_LINES = [
  { text: "IC REVIEW PORTAL v1.0.0",                      color: "text-warning",          delay: 0   },
  { text: "INVESTMENT COMMITTEE · RESTRICTED ACCESS",     color: "text-muted-foreground", delay: 0   },
  { text: "",                                              color: "",                      delay: 150 },
  { text: "ENCRYPTED IC CHANNEL..................[ESTABLISHED]", color: "text-success", delay: 60 },
  { text: "CASE QUEUE SYNC.......................[READY]",       color: "text-success", delay: 60 },
  { text: "IC NOTE READER........................[ONLINE]",      color: "text-success", delay: 60 },
  { text: "DECISION ENGINE.......................[ARMED]",       color: "text-success", delay: 60 },
  { text: "",                                              color: "",                      delay: 200 },
  { text: "> AWAITING IC MEMBER AUTHENTICATION_",          color: "text-warning",          delay: 0   },
];

// ─── Typewriter hook ──────────────────────────────────────────────────────────
function useTypewriter(lines: typeof STAFF_LINES) {
  const [completedLines, setCompletedLines] = useState<{ text: string; color: string }[]>([]);
  const [currentLine, setCurrentLine]       = useState("");
  const [lineIdx, setLineIdx]               = useState(0);
  const [charIdx, setCharIdx]               = useState(0);
  const [done, setDone]                     = useState(false);
  const timeoutRef                          = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (lineIdx >= lines.length) { setDone(true); return; }
    const line = lines[lineIdx];

    if (line.text === "") {
      timeoutRef.current = setTimeout(() => {
        setCompletedLines(prev => [...prev, { text: "", color: "" }]);
        setLineIdx(i => i + 1);
        setCharIdx(0);
        setCurrentLine("");
      }, line.delay || 120);
      return;
    }

    if (charIdx < line.text.length) {
      const charDelay = line.delay > 0 ? line.delay : 24 + Math.random() * 28;
      timeoutRef.current = setTimeout(() => {
        setCurrentLine(line.text.slice(0, charIdx + 1));
        setCharIdx(c => c + 1);
      }, charDelay);
    } else {
      timeoutRef.current = setTimeout(() => {
        setCompletedLines(prev => [...prev, { text: line.text, color: line.color }]);
        setLineIdx(i => i + 1);
        setCharIdx(0);
        setCurrentLine("");
      }, 100);
    }

    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [lineIdx, charIdx, lines]);

  const currentColor = lineIdx < lines.length ? lines[lineIdx].color : "text-primary";
  return { completedLines, currentLine, currentColor, done };
}

// ─── Portal selection card ────────────────────────────────────────────────────
function PortalCard({ variant, onClick }: { variant: "staff" | "ic"; onClick: () => void }) {
  const isIC = variant === "ic";

  const borderCls  = isIC
    ? "border-warning/30 hover:border-warning/70"
    : "border-primary/30 hover:border-primary/70";
  const headerBg   = isIC ? "bg-warning/5 border-warning/20" : "bg-primary/5 border-primary/20";
  const accentText = isIC ? "text-warning" : "text-primary";
  const badgeCls   = isIC
    ? "border-warning/40 text-warning"
    : "border-primary/40 text-primary";
  const dotCls     = isIC ? "bg-warning" : "bg-primary";
  const btnCls     = isIC
    ? "bg-warning/10 border border-warning/40 text-warning hover:bg-warning/20"
    : "bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20";
  const glowCls    = isIC
    ? "hover:shadow-[0_0_24px_rgba(234,179,8,0.12)]"
    : "hover:shadow-[0_0_24px_rgba(232,114,28,0.12)]";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 min-w-0 flex flex-col border bg-surface-1 transition-all duration-200 text-left group cursor-pointer ${borderCls} ${glowCls}`}
    >
      {/* Card header bar */}
      <div className={`px-5 py-3 border-b ${headerBg} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${dotCls} opacity-80`} />
          <span className={`text-[8px] font-bold tracking-[0.3em] ${accentText} opacity-70`}>
            {isIC ? "INVESTMENT COMMITTEE" : "CREDIT OPERATIONS"}
          </span>
        </div>
        <div className={`text-[8px] font-bold tracking-widest border px-2 py-0.5 ${badgeCls}`}>
          {isIC ? "IC / CC" : "STAFF"}
        </div>
      </div>

      {/* Card body */}
      <div className="px-6 py-7 flex flex-col gap-4 flex-1">
        {/* Icon */}
        <div className={`text-3xl font-bold ${accentText} opacity-60 select-none`}>
          {isIC ? "◉" : "▶"}
        </div>

        {/* Name */}
        <div>
          <div className={`text-xl font-bold tracking-wider ${accentText} glow leading-tight`}>
            {isIC ? "IC REVIEW PORTAL" : "CREDIT TERMINAL"}
          </div>
          <div className="text-[10px] text-muted-foreground/60 tracking-widest mt-1">
            {isIC ? "RESTRICTED · COMMITTEE ACCESS" : "STAFF WORKSPACE"}
          </div>
        </div>

        {/* Role list */}
        <div className="space-y-1">
          {(isIC
            ? ["IC MEMBERS", "CREDIT COMMITTEE", "ADMINISTRATORS"]
            : ["ANALYSTS", "BUSINESS DEVELOPMENT", "OPERATIONS"]
          ).map(role => (
            <div key={role} className="flex items-center gap-2">
              <div className={`w-1 h-1 rounded-full ${dotCls} opacity-40`} />
              <span className="text-[9px] tracking-widest text-muted-foreground/50">{role}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="px-5 pb-5">
        <div className={`w-full py-2.5 text-center text-[10px] font-bold tracking-widest transition-colors ${btnCls}`}>
          {isIC ? "ENTER IC PORTAL →" : "ENTER CREDIT TERMINAL →"}
        </div>
      </div>
    </button>
  );
}

// ─── Login panel ──────────────────────────────────────────────────────────────
const MAX_ATTEMPTS = 5;
const BASE_LOCKOUT = 30_000;

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
  const [loading, setLoading]         = useState(false);
  const [attempts, setAttempts]       = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const scrollRef                     = useRef<HTMLDivElement>(null);

  const lines = variant === "staff" ? STAFF_LINES : IC_LINES;
  const { completedLines, currentLine, currentColor, done } = useTypewriter(lines);

  const isIC         = variant === "ic";
  const accentCls    = isIC ? "border-warning/50 bg-warning/5" : "border-primary/50 bg-primary/5";
  const headerAccent = isIC ? "text-warning" : "text-primary";
  const headerBdr    = isIC ? "border-warning/25 bg-warning/5" : "border-primary/25 bg-primary/5";
  const footerBdr    = isIC ? "border-warning/15" : "border-primary/15";
  const btnCls       = isIC
    ? "bg-warning text-black hover:brightness-105"
    : "bg-primary text-primary-foreground hover:brightness-110";

  useEffect(() => {
    if (session) navigate(isIC ? "/ic" : redirectTo, { replace: true });
  }, [session, navigate, isIC, redirectTo]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [completedLines, currentLine]);

  const remainingSecs = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Date.now() < lockedUntil) {
      toast.error(`Too many attempts. Try again in ${remainingSecs}s`);
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
          toast.error(`Too many failed attempts. Locked for ${Math.ceil(delay / 1000)}s`);
        } else {
          toast.error("Invalid email or password");
        }
      } else {
        setAttempts(0);
        setLockedUntil(0);
      }
    } catch {
      toast.error("Authentication error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`flex flex-col border ${accentCls}`}>
      {/* Back link */}
      <button
        type="button"
        onClick={onBack}
        className="px-5 py-2.5 border-b border-border/30 bg-surface-2 text-[9px] tracking-widest text-muted-foreground/50 hover:text-muted-foreground transition-colors text-left"
      >
        ← SELECT PORTAL
      </button>

      {/* Panel header */}
      <div className={`px-5 py-3 border-b ${headerBdr} flex items-center justify-between`}>
        <div>
          <div className={`text-[9px] tracking-widest font-bold ${headerAccent}`}>
            {isIC ? "◉ INVESTMENT COMMITTEE" : "▶ CREDIT OPERATIONS"}
          </div>
          <div className={`text-base font-bold tracking-wider mt-0.5 ${headerAccent} glow`}>
            {isIC ? "IC REVIEW PORTAL" : "CREDIT TERMINAL"}
          </div>
        </div>
        <div className={`text-[8px] font-bold tracking-widest border px-2 py-1 ${isIC ? "border-warning/40 text-warning" : "border-primary/40 text-primary"}`}>
          {isIC ? "IC / CC" : "STAFF"}
        </div>
      </div>

      {/* Typewriter boot log */}
      <div
        ref={scrollRef}
        className="px-4 pt-3 pb-2 h-28 overflow-hidden font-mono text-[9px] leading-relaxed border-b border-border/30 bg-background/60"
        style={{ scrollbarWidth: "none" }}
      >
        {completedLines.map((line, i) =>
          line.text === ""
            ? <div key={i} className="h-1" />
            : <div key={i} className={`${line.color} whitespace-pre`}>{line.text}</div>
        )}
        {!done && (
          <div className={`${currentColor} whitespace-pre`}>
            {currentLine}<span className="ticker-blink text-primary">█</span>
          </div>
        )}
        {done && (
          <div className={`${headerAccent} whitespace-pre`}>
            {">"} AWAITING {isIC ? "IC MEMBER" : "OPERATOR"} AUTHENTICATION
            <span className="ticker-blink ml-0.5">█</span>
          </div>
        )}
      </div>

      {/* Form */}
      <form onSubmit={submit} className="p-5 space-y-4 flex-1">
        <div>
          <label className={`block mb-1 text-[9px] font-bold tracking-widest ${headerAccent}`}>
            ▶ EMAIL
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
            placeholder={isIC ? "icmember@rehbarfin.com" : "analyst@rehbarfin.com"}
            className={`w-full bg-input border px-3 py-2 text-sm font-mono focus:outline-none transition-colors ${
              isIC
                ? "border-border focus:border-warning text-foreground placeholder:text-muted-foreground/30"
                : "border-border focus:border-primary text-foreground placeholder:text-muted-foreground/30"
            }`}
          />
        </div>
        <div>
          <label className={`block mb-1 text-[9px] font-bold tracking-widest ${headerAccent}`}>
            ▶ PASSPHRASE
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            className={`w-full bg-input border px-3 py-2 text-sm font-mono focus:outline-none transition-colors ${
              isIC
                ? "border-border focus:border-warning text-foreground"
                : "border-border focus:border-primary text-foreground"
            }`}
          />
        </div>
        <button
          type="submit"
          disabled={loading || Date.now() < lockedUntil}
          className={`w-full py-2.5 text-[11px] font-bold tracking-widest disabled:opacity-50 transition ${btnCls}`}
        >
          {loading
            ? "▶ AUTHENTICATING…"
            : remainingSecs > 0
            ? `⊘ LOCKED ${remainingSecs}s`
            : isIC
            ? "▶ ENTER IC PORTAL"
            : "▶ ENTER CREDIT TERMINAL"}
        </button>
      </form>

      {/* Panel footer */}
      <div className={`px-5 py-2 border-t ${footerBdr} bg-surface-2`}>
        <div className="text-[8px] tracking-widest text-muted-foreground/40 text-center">
          {isIC ? "RESTRICTED · INVESTMENT COMMITTEE ONLY" : "ENCRYPTED CHANNEL · REHBAR CREDIT TERMINAL"}
        </div>
      </div>
    </div>
  );
}

// ─── Auth page ────────────────────────────────────────────────────────────────
const Auth = () => {
  const location   = useLocation();
  const navigate   = useNavigate();
  const { session } = useAuth();
  const redirectTo = sanitizeRedirect(new URLSearchParams(location.search).get("redirect"));

  const [view, setView]     = useState<"select" | "login">("select");
  const [portal, setPortal] = useState<"staff" | "ic" | null>(null);

  useEffect(() => {
    if (session) navigate(redirectTo, { replace: true });
  }, [session, navigate, redirectTo]);

  const selectPortal = (v: "staff" | "ic") => { setPortal(v); setView("login"); };
  const goBack       = () => { setView("select"); setPortal(null); };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 gap-6">

      {/* Logo */}
      <div className="text-center">
        <img
          src="/Rehbar_logo.png"
          alt="Rehbar Financial Services"
          className="h-12 w-auto object-contain mx-auto mb-3"
        />
        <div className="text-primary text-lg font-bold tracking-[0.25em] glow">
          REHBAR FINANCIAL SERVICES
        </div>
        <div className="text-muted-foreground text-[10px] tracking-[0.4em] mt-1">
          SECURE TERMINAL ACCESS
        </div>
      </div>

      {view === "select" ? (
        <>
          {/* Divider */}
          <div className="w-full max-w-2xl flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[9px] tracking-widest text-muted-foreground/40">SELECT PORTAL</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Portal cards */}
          <div className="w-full max-w-2xl flex flex-col md:flex-row gap-4">
            <PortalCard variant="staff" onClick={() => selectPortal("staff")} />
            <PortalCard variant="ic"    onClick={() => selectPortal("ic")}    />
          </div>
        </>
      ) : (
        /* Login form — single centered panel */
        <div className="w-full max-w-md">
          <LoginPanel variant={portal!} redirectTo={redirectTo} onBack={goBack} />
        </div>
      )}

      <div className="text-[9px] text-muted-foreground/30 tracking-widest text-center">
        REHBAR FINANCIAL SERVICES · rehbarfin.com · ALL SESSIONS ENCRYPTED & AUDITED
      </div>
    </div>
  );
};

export default Auth;
