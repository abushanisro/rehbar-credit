import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { toast } from "sonner";

const schema = z.object({
  email: z.string().trim().email("Invalid email").max(255),
  password: z.string().min(6, "Min 6 chars").max(128),
});

const BOOT_LINES = [
  { text: "IC REVIEW PORTAL v1.0.0", color: "text-primary", delay: 0 },
  { text: "INVESTMENT COMMITTEE · REHBAR FINANCIAL SERVICES", color: "text-muted-foreground", delay: 0 },
  { text: "", color: "", delay: 150 },
  { text: "INITIALISING SECURE IC CHANNEL..................", color: "text-foreground/70", delay: 0 },
  { text: "ENCRYPTED LINK............................[ESTABLISHED]", color: "text-success", delay: 60 },
  { text: "IC NOTE READER...........................[ONLINE]", color: "text-success", delay: 60 },
  { text: "DECISION ENGINE..........................[ARMED]", color: "text-success", delay: 60 },
  { text: "CASE QUEUE SYNC..........................[READY]", color: "text-success", delay: 60 },
  { text: "", color: "", delay: 150 },
  { text: "── ACCESS CONTROL ────────────────────────────────", color: "text-muted-foreground", delay: 0 },
  { text: "  AUTHORISED ROLES: IC MEMBER, CREDIT COMMITTEE", color: "text-foreground/80", delay: 20 },
  { text: "  SESSION: ENCRYPTED · AUDITED · TIME-LIMITED", color: "text-foreground/80", delay: 20 },
  { text: "", color: "", delay: 200 },
  { text: "> AWAITING IC MEMBER AUTHENTICATION_", color: "text-primary", delay: 0 },
];

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

export default function ICAuth() {
  const { session } = useAuth();
  const navigate    = useNavigate();

  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [loading, setLoading]         = useState(false);
  const [attempts, setAttempts]       = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const scrollRef                     = useRef<HTMLDivElement>(null);

  const { completedLines, currentLine, currentColor, done } = useTypewriter();

  useEffect(() => { if (session) navigate("/ic", { replace: true }); }, [session, navigate]);

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
        if (next >= 5) {
          const delay = 30_000 * Math.pow(2, next - 5);
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

  const inputCls = "w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo + title */}
        <div className="text-center mb-6">
          <img src="/Rehbar_logo.png" alt="Rehbar Financial Services" className="h-14 w-auto object-contain mx-auto mb-3" />
          <div className="text-primary text-xl font-bold tracking-[0.2em] glow">IC REVIEW PORTAL</div>
          <div className="text-muted-foreground text-xs tracking-[0.3em] mt-1">INVESTMENT COMMITTEE · REHBAR FINANCIAL SERVICES</div>
        </div>

        <div className="terminal-panel scanlines">
          <div className="terminal-panel-header">
            <span>◉ IC SECURE ACCESS</span>
            <span className="text-muted-foreground">ENCRYPTED CHANNEL</span>
          </div>

          {/* Typewriter boot sequence */}
          <div
            ref={scrollRef}
            className="px-4 pt-3 pb-2 h-32 overflow-hidden font-mono text-[10px] leading-relaxed border-b border-border/50 bg-background/40"
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
                {">"} AWAITING IC MEMBER AUTHENTICATION<span className="ticker-blink ml-0.5">█</span>
              </div>
            )}
          </div>

          {/* Login form */}
          <form onSubmit={submit} className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Email Address</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                required autoFocus className={inputCls} placeholder="icmember@rehbar.co.in"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Passphrase</label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                required className={inputCls} placeholder="••••••••"
              />
            </div>
            <button
              type="submit" disabled={loading || Date.now() < lockedUntil}
              className="w-full bg-primary text-primary-foreground py-2.5 text-sm font-semibold rounded-md hover:bg-primary/90 disabled:opacity-50 transition"
            >
              {loading ? "Signing in…" : remainingSecs > 0 ? `Locked (${remainingSecs}s)` : "Sign In"}
            </button>
          </form>
        </div>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          Restricted access · Investment Committee only
        </div>
        <div className="mt-2 text-center">
          <Link to="/auth" className="text-xs text-muted-foreground/50 hover:text-primary transition-colors">
            ← Back to main login
          </Link>
        </div>
      </div>
    </div>
  );
}
