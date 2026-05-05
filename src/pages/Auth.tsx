import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { toast } from "sonner";

const schema = z.object({
  email: z.string().trim().email("Invalid email").max(255),
  password: z.string().min(6, "Min 6 chars").max(128),
  fullName: z.string().trim().max(100).optional(),
});

// ─── Terminal typing lines ────────────────────────────────────────────────────
const BOOT_LINES = [
  { text: "CREDIT TERMINAL v1.0.0", color: "text-primary", delay: 0 },
  { text: "COPYRIGHT © REHBAR FINANCIAL SERVICES", color: "text-muted-foreground", delay: 0 },
  { text: "rehbar.co.in", color: "text-accent", delay: 0 },
  { text: "", color: "", delay: 200 },
  { text: "INITIALIZING CREDIT ANALYSIS ENGINE......", color: "text-foreground/70", delay: 0 },
  { text: "LOADING FINANCIAL RATIO MATRIX............[OK]", color: "text-success", delay: 80 },
  { text: "DSCR COMPUTATION MODULE...................[ONLINE]", color: "text-success", delay: 60 },
  { text: "CLAUDE SONNET 4.6 API....................[READY]", color: "text-success", delay: 60 },
  { text: "SUPABASE VAULT............................[SECURE]", color: "text-success", delay: 60 },
  { text: "SHARIA COMPLIANCE ENGINE..................[ACTIVE]", color: "text-success", delay: 60 },
  { text: "", color: "", delay: 200 },
  { text: "── BENCHMARK THRESHOLDS ──────────────────────", color: "text-muted-foreground", delay: 0 },
  { text: "  CURRENT RATIO..........BENCHMARK: 1.60x", color: "text-foreground/80", delay: 30 },
  { text: "  QUICK RATIO............BENCHMARK: 1.10x", color: "text-foreground/80", delay: 30 },
  { text: "  DEBT / EQUITY..........BENCHMARK: 1.20x", color: "text-foreground/80", delay: 30 },
  { text: "  INTEREST COVERAGE......BENCHMARK: 4.00x", color: "text-foreground/80", delay: 30 },
  { text: "  DSCR...................BENCHMARK: 1.60x", color: "text-foreground/80", delay: 30 },
  { text: "  EBITDA MARGIN..........BENCHMARK: 18.0%", color: "text-foreground/80", delay: 30 },
  { text: "  GROSS MARGIN...........BENCHMARK: 28.0%", color: "text-foreground/80", delay: 30 },
  { text: "  ROE....................BENCHMARK: 18.0%", color: "text-foreground/80", delay: 30 },
  { text: "", color: "", delay: 200 },
  { text: "── PRODUCT MODULES ───────────────────────────", color: "text-muted-foreground", delay: 0 },
  { text: "  ★ OPERATING LEASE...............[LOADED]", color: "text-accent", delay: 40 },
  { text: "  ★ FINANCE LEASE.................[LOADED]", color: "text-accent", delay: 40 },
  { text: "  ★ PROFIT & LOSS SHARING (PLS)...[LOADED]", color: "text-accent", delay: 40 },
  { text: "  ★ PROJECT FINANCE...............[LOADED]", color: "text-accent", delay: 40 },
  { text: "  ★ TRADE FINANCE.................[LOADED]", color: "text-accent", delay: 40 },
  { text: "  ★ HOME LOAN.....................[LOADED]", color: "text-accent", delay: 40 },
  { text: "", color: "", delay: 200 },
  { text: "── EXTRACTION ENGINE ─────────────────────────", color: "text-muted-foreground", delay: 0 },
  { text: "  BALANCE SHEET PARSER............[READY]", color: "text-foreground/80", delay: 30 },
  { text: "  P&L STATEMENT MODULE............[READY]", color: "text-foreground/80", delay: 30 },
  { text: "  CASH FLOW ANALYSER..............[READY]", color: "text-foreground/80", delay: 30 },
  { text: "  PROJECTION MODELLER.............[READY]", color: "text-foreground/80", delay: 30 },
  { text: "  IC NOTE GENERATOR...............[STANDBY]", color: "text-warning", delay: 30 },
  { text: "", color: "", delay: 200 },
  { text: "ENCRYPTED CHANNEL.................[ESTABLISHED]", color: "text-success", delay: 60 },
  { text: "ALL SYSTEMS NOMINAL", color: "text-success", delay: 0 },
  { text: "", color: "", delay: 300 },
  { text: "> AWAITING OPERATOR AUTHENTICATION_", color: "text-primary", delay: 0 },
];

// ─── Typewriter hook ──────────────────────────────────────────────────────────
function useTypewriter() {
  const [completedLines, setCompletedLines] = useState<{ text: string; color: string }[]>([]);
  const [currentLine, setCurrentLine] = useState("");
  const [lineIdx, setLineIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [done, setDone] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (lineIdx >= BOOT_LINES.length) { setDone(true); return; }
    const line = BOOT_LINES[lineIdx];

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
      const charDelay = line.delay > 0 ? line.delay : 28 + Math.random() * 30;
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
      }, 120);
    }

    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [lineIdx, charIdx]);

  const currentColor = lineIdx < BOOT_LINES.length ? BOOT_LINES[lineIdx].color : "text-primary";

  return { completedLines, currentLine, currentColor, done };
}

// ─── Verification sent screen ─────────────────────────────────────────────────
function VerificationSent({ email, onResend, onBack }: { email: string; onResend: () => Promise<void>; onBack: () => void }) {
  const [resending, setResending]   = useState(false);
  const [cooldown, setCooldown]     = useState(60);    // seconds before resend allowed
  const [resendCount, setResendCount] = useState(0);

  // countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    try {
      await onResend();
      setResendCount(n => n + 1);
      setCooldown(60);
      toast.success("Verification email resent");
    } catch (err) {
      const msg = (err as Error).message ?? "";
      toast.error(msg || "Failed to resend — try again shortly");
    } finally { setResending(false); }
  };

  return (
    <div className="terminal-panel scanlines">
      <div className="terminal-panel-header">
        <span>● VERIFY EMAIL ADDRESS</span>
        <span className="text-success ticker-blink">● LINK DISPATCHED</span>
      </div>

      <div className="p-6 space-y-5 text-center">
        {/* Animated mail icon */}
        <div className="relative mx-auto w-16 h-16 flex items-center justify-center">
          <div className="absolute inset-0 border-2 border-primary/30 animate-ping rounded-sm opacity-40" />
          <div className="relative border-2 border-primary bg-primary/10 w-14 h-14 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </div>
        </div>

        {/* Status */}
        <div>
          <div className="text-success font-bold tracking-widest text-sm">VERIFICATION LINK DISPATCHED</div>
          <div className="text-muted-foreground text-[10px] tracking-wider mt-1">ENCRYPTED EMAIL TRANSMISSION COMPLETE</div>
        </div>

        {/* Terminal output block */}
        <div className="text-left bg-background/60 border border-border/60 p-3 font-mono text-[10px] space-y-1">
          <div className="text-muted-foreground"># TRANSMISSION LOG</div>
          <div className="text-foreground/70">TO &nbsp;&nbsp;&nbsp;: <span className="text-primary font-bold">{email}</span></div>
          <div className="text-foreground/70">FROM &nbsp;: noreply@rehbar.co.in</div>
          <div className="text-foreground/70">SUBJ &nbsp;: Confirm your Rehbar Credit Terminal access</div>
          <div className="text-foreground/70">STATUS: <span className="text-success">DELIVERED ✓</span></div>
          {resendCount > 0 && <div className="text-accent">RESENT: {resendCount}x</div>}
        </div>

        {/* Instructions */}
        <div className="text-left space-y-2">
          <div className="text-[10px] tracking-widest text-muted-foreground mb-2">▶ NEXT STEPS</div>
          {[
            "Open your inbox — check Spam / Promotions if not in Primary",
            "Click the verification link in the email from Rehbar",
            "You will be automatically signed in and redirected",
          ].map((step, i) => (
            <div key={i} className="flex gap-2 text-xs text-foreground/80">
              <span className="text-primary font-bold shrink-0">{i + 1}.</span>
              <span>{step}</span>
            </div>
          ))}
        </div>

        {/* Resend */}
        <div className="space-y-2 border-t border-border/40 pt-4">
          <button
            onClick={handleResend}
            disabled={cooldown > 0 || resending}
            className="w-full border border-primary/50 text-primary py-2 text-xs tracking-widest hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {resending ? "▶ RESENDING…" : cooldown > 0
              ? `[RESEND AVAILABLE IN ${cooldown}s]`
              : "[RESEND VERIFICATION EMAIL]"
            }
          </button>
          <button
            onClick={onBack}
            className="w-full text-xs text-muted-foreground hover:text-primary tracking-widest"
          >[← BACK TO SIGN IN]</button>
        </div>
      </div>
    </div>
  );
}

// ─── Auth page ────────────────────────────────────────────────────────────────
const Auth = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = new URLSearchParams(location.search).get("redirect") ?? "/";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { completedLines, currentLine, currentColor, done } = useTypewriter();

  useEffect(() => { if (session) navigate(redirectTo, { replace: true }); }, [session, navigate, redirectTo]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [completedLines, currentLine]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password, fullName });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.functions.invoke("send-auth-email", {
          body: {
            type: "signup",
            email,
            password,
            full_name: fullName,
            redirect_url: `${window.location.origin}/auth?redirect=${encodeURIComponent(redirectTo)}`,
          },
        });
        if (error) throw new Error(error.message ?? "Sign up failed");
        if (data?.already_exists) throw new Error("An account with this email already exists — please sign in.");
        if (!data?.ok) throw new Error(data?.error ?? "Sign up failed");
        setVerificationSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast.error((err as Error).message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const resendVerification = async () => {
    const { data, error } = await supabase.functions.invoke("send-auth-email", {
      body: { type: "resend", email },
    });
    if (error) throw new Error(error.message ?? "Resend failed");
    if (!data?.ok) throw new Error(data?.error ?? "Resend failed");
  };

  const inputCls = "w-full bg-input border border-border px-3 py-2 text-primary font-mono focus:outline-none focus:border-primary";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-6">
          <img src="/Rehbar_logo.png" alt="Rehbar Financial Services" className="h-14 w-auto object-contain mx-auto mb-3" />
          <div className="text-primary text-xl font-bold tracking-[0.2em] glow">REHBAR CREDIT TERMINAL</div>
          <div className="text-muted-foreground text-xs tracking-[0.4em] mt-1">// TERMINAL ACCESS · rehbar.co.in</div>
        </div>

        {/* Verification sent state */}
        {verificationSent ? (
          <VerificationSent
            email={email}
            onResend={resendVerification}
            onBack={() => { setVerificationSent(false); setMode("signin"); setPassword(""); }}
          />
        ) : (
          <div className="terminal-panel scanlines">
            <div className="terminal-panel-header">
              <span>● {mode === "signin" ? "AUTHENTICATE" : "REGISTER OPERATOR"}</span>
              <span className="text-muted-foreground">SECURE LINK</span>
            </div>

            {/* Typewriter */}
            <div ref={scrollRef}
              className="px-4 pt-3 pb-2 h-36 overflow-hidden font-mono text-[10px] leading-relaxed border-b border-border/50 bg-background/40"
              style={{ scrollbarWidth: "none" }}
            >
              {completedLines.map((line, i) =>
                line.text === "" ? <div key={i} className="h-1.5" /> :
                <div key={i} className={`${line.color} whitespace-pre`}>{line.text}</div>
              )}
              {!done && (
                <div className={`${currentColor} whitespace-pre`}>
                  {currentLine}<span className="ticker-blink text-primary">█</span>
                </div>
              )}
              {done && (
                <div className="text-primary whitespace-pre">
                  {">"} AWAITING OPERATOR AUTHENTICATION<span className="ticker-blink ml-0.5">█</span>
                </div>
              )}
            </div>

            {/* Form */}
            <form onSubmit={submit} className="p-5 space-y-4">
              {mode === "signup" && (
                <div>
                  <label className="terminal-label block mb-1">▶ OPERATOR NAME</label>
                  <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                    className={inputCls} placeholder="Abu Shan" />
                </div>
              )}
              <div>
                <label className="terminal-label block mb-1">▶ EMAIL ID</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  required className={inputCls} placeholder="user@rehbar.com" />
              </div>
              <div>
                <label className="terminal-label block mb-1">▶ PASSPHRASE</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  required className={inputCls} placeholder="••••••••" />
                {mode === "signup" && password.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {[
                      { label: "Min 6 characters", ok: password.length >= 6 },
                      { label: "Contains a number", ok: /\d/.test(password) },
                      { label: "Contains uppercase", ok: /[A-Z]/.test(password) },
                    ].map(r => (
                      <div key={r.label} className={`flex gap-1.5 text-[9px] tracking-wider ${r.ok ? "text-success" : "text-muted-foreground"}`}>
                        <span>{r.ok ? "✓" : "○"}</span><span>{r.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-primary text-primary-foreground py-2.5 font-bold tracking-widest hover:brightness-110 disabled:opacity-50 transition">
                {loading ? "▶ PROCESSING..." : mode === "signin" ? "▶ ENTER TERMINAL" : "▶ CREATE ACCESS"}
              </button>
              {mode === "signup" && !loading && (
                <div className="text-[9px] text-muted-foreground/70 text-center tracking-wider">
                  A verification link will be sent to your email after registration
                </div>
              )}
              <button type="button"
                onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setPassword(""); }}
                className="w-full text-xs text-muted-foreground hover:text-primary tracking-widest">
                {mode === "signin" ? "[NO ACCESS? REGISTER]" : "[HAVE ACCESS? SIGN IN]"}
              </button>
            </form>
          </div>
        )}

        <div className="text-center mt-4 text-[10px] text-muted-foreground tracking-widest">
          REHBAR FINANCIAL SERVICES · rehbar.co.in · ENCRYPTED CHANNEL
        </div>
      </div>
    </div>
  );
};

export default Auth;
