import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { toast } from "sonner";

const schema = z.object({
  email: z.string().trim().email("Invalid email").max(255),
  password: z.string().min(6, "Min 6 chars").max(128),
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

// ─── Auth page ────────────────────────────────────────────────────────────────
const Auth = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = new URLSearchParams(location.search).get("redirect") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { completedLines, currentLine, currentColor, done } = useTypewriter();

  useEffect(() => { if (session) navigate(redirectTo, { replace: true }); }, [session, navigate, redirectTo]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [completedLines, currentLine]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      toast.error((err as Error).message || "Authentication failed");
    } finally {
      setLoading(false);
    }
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

          <div className="terminal-panel scanlines">
            <div className="terminal-panel-header">
              <span>● AUTHENTICATE</span>
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
              <div>
                <label className="terminal-label block mb-1">▶ EMAIL ID</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  required className={inputCls} placeholder="user@rehbar.com" />
              </div>
              <div>
                <label className="terminal-label block mb-1">▶ PASSPHRASE</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  required className={inputCls} placeholder="••••••••" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-primary text-primary-foreground py-2.5 font-bold tracking-widest hover:brightness-110 disabled:opacity-50 transition">
                {loading ? "▶ PROCESSING..." : "▶ ENTER TERMINAL"}
              </button>
            </form>
          </div>

        <div className="text-center mt-4 text-[10px] text-muted-foreground tracking-widest">
          REHBAR FINANCIAL SERVICES · rehbar.co.in · ENCRYPTED CHANNEL
        </div>
      </div>
    </div>
  );
};

export default Auth;
