import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const fmtClock = (d: Date) =>
  d.toLocaleTimeString("en-US", { hour12: false }) + " IST";

// ── helpers ───────────────────────────────────────────────────────────────────
function calcCountdown(dueDateStr: string): { text: string; urgent: boolean } {
  const due = new Date(dueDateStr + "T00:00:00");
  const now  = new Date();
  const diffMs = due.getTime() - now.getTime();
  if (diffMs <= 0) return { text: "OVERDUE", urgent: true };
  const days  = Math.floor(diffMs / 86_400_000);
  const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
  const mins  = Math.floor((diffMs % 3_600_000) / 60_000);
  const secs  = Math.floor((diffMs % 60_000) / 1_000);
  if (days > 1)  return { text: `${days}d ${hours}h`, urgent: false };
  if (days === 1) return { text: `1d ${hours}h ${mins}m`, urgent: true };
  if (hours > 0)  return { text: `${hours}h ${mins}m ${secs}s`, urgent: true };
  return { text: `${mins}m ${secs}s`, urgent: true };
}

// ── types ─────────────────────────────────────────────────────────────────────
type Notif = {
  id: string; case_id: string; case_code: string; client_name: string;
  emi_number: number; due_date: string; emi_amount: number;
  kind: "overdue" | "due_today" | "due_soon";
};

// ── NotificationBell ──────────────────────────────────────────────────────────
function NotificationBell({ userId }: { userId: string }) {
  const [notifs, setNotifs]     = useState<Notif[]>([]);
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [tick, setTick]         = useState(0);          // drives countdown re-render
  const panelRef                = useRef<HTMLDivElement>(null);
  const navigate                = useNavigate();

  // countdown ticker — every second
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const today   = new Date().toISOString().split("T")[0];
  const in7Days = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];

  const fetchNotifs = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase
      .from("emi_payments")
      .select("id, case_id, emi_number, due_date, emi_amount, status, credit_cases(case_code, client_name)")
      .eq("user_id", userId)
      .neq("status", "paid")
      .lte("due_date", in7Days)
      .order("due_date") as ReturnType<typeof supabase.from>);

    if (data) {
      setNotifs((data as never[]).map((r: {
        id: string; case_id: string; emi_number: number; due_date: string; emi_amount: number;
        credit_cases: { case_code: string; client_name: string } | null;
      }) => ({
        id: r.id, case_id: r.case_id,
        case_code: r.credit_cases?.case_code ?? r.case_id.slice(0, 8),
        client_name: r.credit_cases?.client_name ?? "Unknown",
        emi_number: r.emi_number, due_date: r.due_date, emi_amount: r.emi_amount,
        kind: r.due_date < today ? "overdue" : r.due_date === today ? "due_today" : "due_soon",
      })));
    }
    setLoading(false);
  }, [userId, today, in7Days]);

  // initial fetch
  useEffect(() => { fetchNotifs(); }, [fetchNotifs]);

  // polling fallback every 5 min
  useEffect(() => {
    const t = setInterval(fetchNotifs, 5 * 60_000);
    return () => clearInterval(t);
  }, [fetchNotifs]);

  // ── REAL-TIME subscription ──────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`emi-bell-${userId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "emi_payments",
        filter: `user_id=eq.${userId}`,
      }, () => { fetchNotifs(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, fetchNotifs]);

  // close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const overdueCount  = notifs.filter(n => n.kind === "overdue").length;
  const todayCount    = notifs.filter(n => n.kind === "due_today").length;
  const soonCount     = notifs.filter(n => n.kind === "due_soon").length;
  const urgentCount   = overdueCount + todayCount;
  const total         = notifs.length;

  // nearest upcoming (not overdue) for countdown
  const nextPending = notifs.find(n => n.kind !== "overdue");
  const countdown   = nextPending ? calcCountdown(nextPending.due_date) : null;
  // force re-compute every tick
  void tick;

  const fmtAmt = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  const kindStyle = {
    overdue:   { label: "OVERDUE",   badge: "bg-destructive text-white",       row: "border-destructive/20 bg-destructive/5",   tag: "border-destructive/40 text-destructive bg-destructive/10" },
    due_today: { label: "DUE TODAY", badge: "bg-warning text-black",           row: "border-warning/20 bg-warning/5",           tag: "border-warning/40 text-warning bg-warning/10" },
    due_soon:  { label: "DUE SOON",  badge: "bg-accent/80 text-accent-foreground", row: "border-border/30",                     tag: "border-accent/40 text-accent bg-accent/10" },
  };

  return (
    <div ref={panelRef} className="relative flex items-center gap-2">

      {/* ── countdown chip next to bell ─────────────────────────────────── */}
      {countdown && (
        <div className={cn(
          "hidden sm:flex items-center gap-1 text-[9px] font-bold tracking-widest px-1.5 py-0.5 border",
          countdown.urgent
            ? "border-destructive/50 text-destructive bg-destructive/10 animate-pulse"
            : "border-accent/40 text-accent bg-accent/10"
        )}>
          <span>⏱</span>
          <span>{countdown.text}</span>
        </div>
      )}

      {/* ── bell button ─────────────────────────────────────────────────── */}
      <button
        onClick={() => { setOpen(o => !o); if (!open) fetchNotifs(); }}
        className="relative flex items-center justify-center w-7 h-7 hover:bg-surface-2 border border-transparent hover:border-border transition-colors"
        title={total > 0 ? `${total} EMI notification${total !== 1 ? "s" : ""}` : "No notifications"}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
          stroke={urgentCount > 0 ? "#ef4444" : total > 0 ? "#f59e0b" : "currentColor"}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={urgentCount > 0 ? "animate-[wiggle_1s_ease-in-out_infinite]" : ""}
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* badge */}
        {total > 0 && (
          <span className={cn(
            "absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] text-[8px] font-bold flex items-center justify-center px-0.5 rounded-sm leading-none",
            urgentCount > 0 ? "bg-destructive text-white" : "bg-warning text-black"
          )}>
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {/* ── dropdown ────────────────────────────────────────────────────── */}
      {open && (
        <div className="absolute right-0 top-10 bg-surface border border-border shadow-2xl z-50 flex flex-col"
          style={{ width: "min(340px, calc(100vw - 1rem))", maxHeight: "80vh" }}>

          {/* header */}
          <div className="border-b border-border bg-card px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-widest text-primary">NOTIFICATIONS</span>
              <div className="flex gap-1.5">
                {overdueCount > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 bg-destructive text-white">{overdueCount} OVERDUE</span>}
                {todayCount > 0   && <span className="text-[9px] font-bold px-1.5 py-0.5 bg-warning text-black">{todayCount} TODAY</span>}
                {soonCount > 0    && <span className="text-[9px] font-bold px-1.5 py-0.5 border border-accent/40 text-accent">{soonCount} SOON</span>}
              </div>
            </div>

            {/* next-due countdown bar */}
            {nextPending && (() => {
              const cd = calcCountdown(nextPending.due_date);
              return (
                <div className={cn(
                  "flex items-center justify-between border px-2 py-1.5",
                  cd.urgent ? "border-destructive/40 bg-destructive/5" : "border-accent/30 bg-accent/5"
                )}>
                  <div>
                    <div className="text-[8px] tracking-widest text-muted-foreground">NEXT DUE · {nextPending.client_name}</div>
                    <div className="text-[10px] font-bold text-primary mt-0.5">EMI #{nextPending.emi_number} · ₹{fmtAmt(nextPending.emi_amount)} Cr</div>
                    <div className="text-[9px] text-muted-foreground">{nextPending.due_date}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[8px] tracking-widest text-muted-foreground mb-0.5">COUNTDOWN</div>
                    <div className={cn(
                      "text-[18px] font-bold tabular-nums leading-none font-mono",
                      cd.urgent ? "text-destructive" : "text-accent"
                    )}>{cd.text}</div>
                  </div>
                </div>
              );
            })()}

            {/* stats row */}
            {total > 0 && (
              <div className="grid grid-cols-3 gap-1 text-center">
                <div className="border border-destructive/20 bg-destructive/5 py-1">
                  <div className="text-[14px] font-bold text-destructive">{overdueCount}</div>
                  <div className="text-[8px] text-destructive/70 tracking-wider">OVERDUE</div>
                </div>
                <div className="border border-warning/20 bg-warning/5 py-1">
                  <div className="text-[14px] font-bold text-warning">{todayCount}</div>
                  <div className="text-[8px] text-warning/70 tracking-wider">DUE TODAY</div>
                </div>
                <div className="border border-accent/20 bg-accent/5 py-1">
                  <div className="text-[14px] font-bold text-accent">{soonCount}</div>
                  <div className="text-[8px] text-accent/70 tracking-wider">DUE SOON</div>
                </div>
              </div>
            )}
          </div>

          {/* list */}
          <div className="overflow-y-auto flex-1">
            {loading && (
              <div className="px-3 py-6 text-[10px] text-muted-foreground text-center tracking-widest animate-pulse">SYNCING…</div>
            )}
            {!loading && total === 0 && (
              <div className="px-3 py-8 text-center space-y-2">
                <div className="text-success text-2xl">✓</div>
                <div className="text-[10px] text-muted-foreground tracking-wider">All EMIs on track — no overdue or upcoming payments</div>
              </div>
            )}
            {!loading && notifs.map(n => {
              const s = kindStyle[n.kind];
              const cd = calcCountdown(n.due_date);
              return (
                <button
                  key={n.id}
                  onClick={() => { navigate(`/case/${n.case_id}`); setOpen(false); }}
                  className={cn("w-full text-left border-b border-border/30 px-3 py-2 hover:bg-surface-2 transition-colors", s.row)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold text-primary truncate">{n.client_name}</div>
                      <div className="text-[9px] text-muted-foreground">{n.case_code} · EMI #{n.emi_number}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={cn("text-[8px] font-bold tracking-widest border px-1.5 py-0.5", s.tag)}>{s.label}</span>
                      <span className={cn("text-[9px] font-bold font-mono tabular-nums", cd.urgent ? "text-destructive" : "text-accent")}>{cd.text}</span>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[9px] text-muted-foreground">Due: {n.due_date}</span>
                    <span className="text-[10px] font-bold text-primary tabular-nums">₹{fmtAmt(n.emi_amount)} Cr</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* footer */}
          <div className="border-t border-border px-3 py-1.5 flex items-center justify-between">
            <span className="text-[9px] text-muted-foreground tracking-wider">REAL-TIME · UPDATES LIVE</span>
            <button onClick={fetchNotifs} className="text-[9px] text-accent hover:underline tracking-wider">REFRESH</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI Token Usage meter (fed by CustomEvent from anywhere in the app) ────────
type TokenPayload =
  | { status: "loading"; label: string; max_tokens: number }
  | { status: "complete"; label: string; input_tokens: number; output_tokens: number; max_tokens: number; model: string };

interface TokenState {
  status: "idle" | "loading" | "complete";
  label: string;
  input_tokens: number;
  output_tokens: number;   // live-estimated during loading, actual on complete
  max_tokens: number;
  model: string;
  sessionTotal: number;
}

function useAiTokenUsage() {
  const [state, setState] = useState<TokenState>({
    status: "idle", label: "", input_tokens: 0, output_tokens: 0, max_tokens: 2500, model: "claude-sonnet-4-6", sessionTotal: 0,
  });
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<TokenPayload>).detail;

      if (d.status === "loading") {
        // Start animated estimate: Claude Sonnet ~35 output tokens/sec
        if (tickRef.current) clearInterval(tickRef.current);
        setState(prev => ({ ...prev, status: "loading", label: d.label, max_tokens: d.max_tokens, output_tokens: 0, input_tokens: 0 }));
        tickRef.current = setInterval(() => {
          setState(prev => ({
            ...prev,
            output_tokens: Math.min(prev.output_tokens + 35, prev.max_tokens - 10),
          }));
        }, 1000);
      } else {
        // Complete — snap to real values
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
        setState(prev => ({
          status: "complete",
          label: d.label,
          input_tokens: d.input_tokens,
          output_tokens: d.output_tokens,
          max_tokens: d.max_tokens,
          model: d.model,
          sessionTotal: prev.sessionTotal + d.input_tokens + d.output_tokens,
        }));
      }
    };
    window.addEventListener("ai-token-usage", handler);
    return () => { window.removeEventListener("ai-token-usage", handler); if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  return state;
}

// ── TerminalHeader ────────────────────────────────────────────────────────────
export const TerminalHeader = () => {
  const [now, setNow]   = useState(new Date());
  const { user, role, signOut } = useAuth();
  const loc             = useLocation();
  const navigate        = useNavigate();
  const tokenState      = useAiTokenUsage();

  const [isLight, setIsLight] = useState(() => localStorage.getItem("rehbar-theme") === "light");

  useEffect(() => {
    // Briefly add a class so all panels/cards also transition on switch,
    // then remove it so hover effects stay instant.
    document.documentElement.classList.add("theme-switching");
    if (isLight) {
      document.documentElement.classList.add("light");
      localStorage.setItem("rehbar-theme", "light");
    } else {
      document.documentElement.classList.remove("light");
      localStorage.setItem("rehbar-theme", "dark");
    }
    const t = setTimeout(() => document.documentElement.classList.remove("theme-switching"), 250);
    return () => clearTimeout(t);
  }, [isLight]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F1") { e.preventDefault(); navigate("/"); }
      if (e.key === "F2") { e.preventDefault(); navigate("/new"); }
      if (e.key === "F3") { e.preventDefault(); navigate("/companies"); }
      if (e.key === "F4") { e.preventDefault(); window.dispatchEvent(new CustomEvent("toggle-analyst-chat")); }
      if (e.key === "F5") { e.preventDefault(); navigate("/users"); }

    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  const navItem = (to: string, label: string, code: string) => {
    const active = loc.pathname === to || (to.length > 1 && loc.pathname.startsWith(to));
    return (
      <Link to={to} className={cn(
        "px-3 py-1 text-xs tracking-widest border-r border-border transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-primary/80 hover:bg-surface-2"
      )}>
        <span className={cn("mr-2 text-[9px] font-bold border px-0.5", active ? "border-primary-foreground/40 text-primary-foreground/70" : "border-border text-muted-foreground")}>{code}</span>{label}
      </Link>
    );
  };

  return (
    <>
      <div className="border-b border-border bg-surface text-[11px] flex items-center justify-between px-3 h-9">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <img src="/Rehbar_logo.png" alt="Rehbar" className="h-6 w-auto object-contain shrink-0" />
          <span className="text-primary font-bold tracking-widest glow hidden xs:block truncate">REHBAR//CAS</span>
          <span className="text-primary font-bold tracking-widest glow hidden lg:block">· CREDIT TERMINAL</span>
          <span className="text-muted-foreground hidden sm:block">v1.0.0</span>
          <span className="text-success ticker-blink hidden sm:block">● LIVE</span>
          <span className="text-muted-foreground hidden md:block">AI ENGINE</span>

          {/* ── AI Token Meter — always visible ─────────────────────── */}
          {(() => {
            const { status, label, input_tokens, output_tokens, max_tokens, model, sessionTotal } = tokenState;
            const outPct    = Math.min(100, Math.round((output_tokens / max_tokens) * 100));
            const pctColor  = outPct >= 85 ? "text-destructive" : outPct >= 60 ? "text-warning" : "text-success";
            const barFill   = outPct >= 85 ? "bg-destructive" : outPct >= 60 ? "bg-warning" : "bg-success";
            const isLoading = status === "loading";
            return (
              <div className="hidden sm:flex items-center gap-3 border-l border-border/50 pl-3">
                <div className="flex flex-col gap-1 min-w-[160px]">
                  {/* top: counts */}
                  {status !== "idle" && (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-muted-foreground/60 tracking-widest font-medium">{label.toUpperCase()}</span>
                        {isLoading && <span className="text-warning text-[9px] animate-pulse font-bold">▸</span>}
                      </div>
                      <div className="flex items-center gap-1.5 text-[9px] tabular-nums">
                        <span className="text-muted-foreground/50">IN</span>
                        <span className="text-foreground/70 font-medium">{input_tokens > 0 ? input_tokens.toLocaleString("en-IN") : "—"}</span>
                        <span className="text-border">·</span>
                        <span className="text-muted-foreground/50">OUT</span>
                        <span className={`font-bold ${isLoading ? "text-warning animate-pulse" : "text-foreground/90"}`}>
                          {output_tokens.toLocaleString("en-IN")}
                        </span>
                        <span className="text-muted-foreground/40">/ {max_tokens.toLocaleString("en-IN")}</span>
                      </div>
                    </div>
                  )}
                  {/* bar */}
                  <div className="relative w-full h-[6px] bg-border/40 rounded-sm overflow-hidden">
                    {status !== "idle" && (
                      <div
                        className={`h-full rounded-sm transition-all duration-700 ${isLoading ? "bg-warning" : barFill}`}
                        style={{
                          width: `${outPct}%`,
                          boxShadow: isLoading ? "0 0 6px hsl(var(--warning))" : undefined,
                        }}
                      />
                    )}
                  </div>
                  {/* bottom: pct + session + model */}
                  <div className="flex items-center justify-between text-[8px]">
                    <span className={`font-bold tabular-nums ${status === "idle" ? "text-muted-foreground/30" : isLoading ? "text-warning/80" : pctColor}`}>
                      {status === "idle" ? "0%" : `${outPct}%`}
                    </span>
                    <div className="flex items-center gap-2 text-muted-foreground/35">
                      {sessionTotal > 0 && (
                        <span className="tabular-nums hidden md:inline">{(sessionTotal / 1000).toFixed(1)}k session</span>
                      )}
                      {model && status === "complete" && (
                        <span className="hidden lg:inline truncate max-w-[90px]">{model}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-2 sm:gap-3 text-muted-foreground shrink-0">
          <span className="hidden md:block">{user?.email}</span>
          {role && (
            <span className="hidden md:block text-[9px] font-bold tracking-widest border border-primary/40 text-primary bg-primary/10 px-1.5 py-0.5">
              {role === "admin" ? "ADMIN" : role === "analyst" ? "ANALYST" : role === "business_development" ? "BD" : role === "ic_member" ? "IC" : role === "credit_committee" ? "CC" : role.toUpperCase()}
            </span>
          )}
          <span className="text-primary hidden sm:block">{fmtClock(now)}</span>
          <button
            onClick={() => setIsLight(l => !l)}
            className="flex items-center justify-center w-7 h-7 hover:bg-surface-2 border border-transparent hover:border-border transition-colors"
            title={isLight ? "Switch to dark mode" : "Switch to light mode"}
          >
            {isLight ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </button>
          {user && <NotificationBell userId={user.id} />}
          <button
            onClick={async () => { await signOut(); navigate("/auth"); }}
            className="text-destructive hover:underline"
          >[LOGOUT]</button>
        </div>
      </div>
      <nav className="border-b border-border bg-card flex items-center h-9">
        {["ic_member", "credit_committee"].includes(role ?? "") ? (
          // IC-only nav — no access to the rest of the app
          navItem("/ic", "IC REVIEW PORTAL", "IC")
        ) : (
          <>
            {navItem("/", "PIPELINE", "F1")}
            {navItem("/new", "NEW CASE", "F2")}
            {navItem("/companies", "MASTER DATA", "F3")}
            {navItem("/users", "TEAM", "F5")}
            {role === "admin" && navItem("/ic", "IC PORTAL", "IC")}
          </>
        )}
        <div className="flex-1" />
        <div className="px-3 text-[11px] text-muted-foreground tracking-widest hidden md:block">
          REHBAR FINANCIAL SERVICES · IC APPRAISAL <span className="text-primary">_</span>
          <span className="ticker-blink text-primary">█</span>
        </div>
      </nav>
      <div className="border-b border-border bg-surface-2 h-6 overflow-hidden flex items-center px-3 text-[10px] tracking-widest">
        <span className="text-warning truncate">⚠ AI-GENERATED DRAFTS REQUIRE ANALYST REVIEW · NO AUTO CREDIT VERDICTS · DSCR FORMULA IS FINANCE-LOCKED</span>
      </div>
    </>
  );
};
