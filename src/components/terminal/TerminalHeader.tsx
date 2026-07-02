import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const fmtClock = (d: Date) =>
  d.toLocaleTimeString("en-IN", { hour12: true, hour: "2-digit", minute: "2-digit" });

// ── helpers ────────────────────────────────────────────────────────────────────
function calcCountdown(dueDateStr: string): { text: string; urgent: boolean } {
  const due    = new Date(dueDateStr + "T00:00:00");
  const now    = new Date();
  const diffMs = due.getTime() - now.getTime();
  if (diffMs <= 0) return { text: "Overdue", urgent: true };
  const days  = Math.floor(diffMs / 86_400_000);
  const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
  const mins  = Math.floor((diffMs % 3_600_000) / 60_000);
  const secs  = Math.floor((diffMs % 60_000) / 1_000);
  if (days > 1)   return { text: `${days}d ${hours}h`,       urgent: false };
  if (days === 1) return { text: `1d ${hours}h ${mins}m`,    urgent: true  };
  if (hours > 0)  return { text: `${hours}h ${mins}m`,       urgent: true  };
  return             { text: `${mins}m ${secs}s`,            urgent: true  };
}

// ── types ──────────────────────────────────────────────────────────────────────
type Notif = {
  id: string; case_id: string; case_code: string; client_name: string;
  emi_number: number; due_date: string; emi_amount: number;
  kind: "overdue" | "due_today" | "due_soon";
};

// ── NotificationBell ───────────────────────────────────────────────────────────
function NotificationBell({ userId }: { userId: string }) {
  const [notifs, setNotifs]   = useState<Notif[]>([]);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [tick, setTick]       = useState(0);
  const panelRef              = useRef<HTMLDivElement>(null);
  const navigate              = useNavigate();

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
        case_code:   r.credit_cases?.case_code   ?? r.case_id.slice(0, 8),
        client_name: r.credit_cases?.client_name ?? "Unknown",
        emi_number:  r.emi_number,
        due_date:    r.due_date,
        emi_amount:  r.emi_amount,
        kind: r.due_date < today ? "overdue" : r.due_date === today ? "due_today" : "due_soon",
      })));
    }
    setLoading(false);
  }, [userId, today, in7Days]);

  useEffect(() => { fetchNotifs(); }, [fetchNotifs]);
  useEffect(() => {
    const t = setInterval(fetchNotifs, 5 * 60_000);
    return () => clearInterval(t);
  }, [fetchNotifs]);

  useEffect(() => {
    const channel = supabase
      .channel(`emi-bell-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "emi_payments", filter: `user_id=eq.${userId}` },
        () => { fetchNotifs(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, fetchNotifs]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const overdueCount = notifs.filter(n => n.kind === "overdue").length;
  const todayCount   = notifs.filter(n => n.kind === "due_today").length;
  const soonCount    = notifs.filter(n => n.kind === "due_soon").length;
  const urgentCount  = overdueCount + todayCount;
  const total        = notifs.length;

  const nextPending = notifs.find(n => n.kind !== "overdue");
  const countdown   = nextPending ? calcCountdown(nextPending.due_date) : null;
  void tick;

  const fmtAmt = (v: number) =>
    "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + " Cr";

  const kindLabel = { overdue: "Overdue", due_today: "Due Today", due_soon: "Due Soon" };
  const kindStyles = {
    overdue:   { badge: "bg-red-100 text-red-700",   row: "bg-red-50/50 border-l-2 border-red-400",   chip: "bg-red-100 text-red-700"   },
    due_today: { badge: "bg-amber-100 text-amber-700", row: "bg-amber-50/50 border-l-2 border-amber-400", chip: "bg-amber-100 text-amber-700" },
    due_soon:  { badge: "bg-blue-100 text-blue-700",  row: "",                                          chip: "bg-blue-100 text-blue-700"  },
  };

  return (
    <div ref={panelRef} className="relative">
      <button
        onClick={() => { setOpen(o => !o); if (!open) fetchNotifs(); }}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg hover:bg-surface-2 transition-colors"
        title={total > 0 ? `${total} payment reminder${total !== 1 ? "s" : ""}` : "No reminders"}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke={urgentCount > 0 ? "#dc2626" : total > 0 ? "#d97706" : "currentColor"}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {total > 0 && (
          <span className={cn(
            "absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] text-[10px] font-bold flex items-center justify-center px-1 rounded-full leading-none",
            urgentCount > 0 ? "bg-red-600 text-white" : "bg-amber-500 text-white"
          )}>
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 bg-card border border-border rounded-xl shadow-xl z-50 flex flex-col overflow-hidden"
          style={{ width: "min(360px, calc(100vw - 1.5rem))", maxHeight: "80vh" }}>

          {/* Header */}
          <div className="px-4 py-3 border-b border-border bg-surface-2/60">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-foreground">Payment Reminders</h3>
              <div className="flex gap-1.5">
                {overdueCount > 0 && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                    {overdueCount} overdue
                  </span>
                )}
                {todayCount > 0 && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    {todayCount} today
                  </span>
                )}
                {soonCount > 0 && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    {soonCount} upcoming
                  </span>
                )}
              </div>
            </div>

            {nextPending && (() => {
              const cd = calcCountdown(nextPending.due_date);
              return (
                <div className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2.5",
                  cd.urgent ? "bg-red-50 border border-red-200" : "bg-blue-50 border border-blue-200"
                )}>
                  <div>
                    <p className="text-xs text-muted-foreground">Next due · {nextPending.client_name}</p>
                    <p className="text-sm font-semibold text-foreground mt-0.5">
                      EMI #{nextPending.emi_number} · {fmtAmt(nextPending.emi_amount)}
                    </p>
                    <p className="text-xs text-muted-foreground">{nextPending.due_date}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground mb-0.5">Countdown</p>
                    <p className={cn("text-lg font-bold font-mono tabular-nums", cd.urgent ? "text-red-600" : "text-blue-600")}>
                      {cd.text}
                    </p>
                  </div>
                </div>
              );
            })()}

            {total > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="rounded-lg bg-red-50 border border-red-100 py-2 text-center">
                  <p className="text-lg font-bold text-red-600">{overdueCount}</p>
                  <p className="text-xs text-red-500">Overdue</p>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 py-2 text-center">
                  <p className="text-lg font-bold text-amber-600">{todayCount}</p>
                  <p className="text-xs text-amber-500">Due Today</p>
                </div>
                <div className="rounded-lg bg-blue-50 border border-blue-100 py-2 text-center">
                  <p className="text-lg font-bold text-blue-600">{soonCount}</p>
                  <p className="text-xs text-blue-500">Upcoming</p>
                </div>
              </div>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {loading && (
              <div className="px-4 py-8 text-sm text-muted-foreground text-center animate-pulse">
                Loading reminders…
              </div>
            )}
            {!loading && total === 0 && (
              <div className="px-4 py-10 text-center">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-foreground">All payments on track</p>
                <p className="text-xs text-muted-foreground mt-1">No overdue or upcoming EMIs in the next 7 days</p>
              </div>
            )}
            {!loading && notifs.map(n => {
              const s  = kindStyles[n.kind];
              const cd = calcCountdown(n.due_date);
              return (
                <button
                  key={n.id}
                  onClick={() => { navigate(`/case/${n.case_id}`); setOpen(false); }}
                  className={cn(
                    "w-full text-left px-4 py-3 hover:bg-surface-2 transition-colors border-b border-border/50",
                    s.row
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{n.client_name}</p>
                      <p className="text-xs text-muted-foreground">{n.case_code} · EMI #{n.emi_number}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", s.chip)}>
                        {kindLabel[n.kind]}
                      </span>
                      <span className={cn("text-xs font-mono font-bold", cd.urgent ? "text-red-600" : "text-blue-600")}>
                        {cd.text}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Due: {n.due_date}</span>
                    <span className="text-sm font-semibold text-foreground">{fmtAmt(n.emi_amount)}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-4 py-2.5 flex items-center justify-between bg-surface-2/40">
            <span className="text-xs text-muted-foreground">Updates in real-time</span>
            <button onClick={fetchNotifs} className="text-xs text-primary hover:underline font-medium">
              Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI token tracking — runs silently in background ────────────────────────────
type TokenPayload =
  | { status: "loading"; label: string; max_tokens: number }
  | { status: "complete"; label: string; input_tokens: number; output_tokens: number; max_tokens: number; model: string };

function useAiTokenUsage() {
  useEffect(() => {
    const handler = (e: Event) => { void (e as CustomEvent<TokenPayload>).detail; };
    window.addEventListener("ai-token-usage", handler);
    return () => window.removeEventListener("ai-token-usage", handler);
  }, []);
}

// ── AppHeader ──────────────────────────────────────────────────────────────────
export const TerminalHeader = () => {
  const [now, setNow] = useState(new Date());
  const { user, role, signOut } = useAuth();
  const loc      = useLocation();
  const navigate = useNavigate();
  useAiTokenUsage();

  useEffect(() => {
    // Ensure any previously saved dark mode is cleared
    document.documentElement.classList.remove("dark");
    localStorage.removeItem("rehbar-theme");
  }, []);

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
      if (e.key === "F6") { e.preventDefault(); navigate("/observability"); }
      if (e.key === "F7") { e.preventDefault(); window.dispatchEvent(new CustomEvent("toggle-rag-panel")); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  const isActive = (to: string) =>
    to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(to);

  const navLink = (to: string, label: string) => (
    <Link
      to={to}
      className={cn(
        "px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap",
        isActive(to)
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-surface-2"
      )}
    >
      {label}
    </Link>
  );

  const roleLabel: Record<string, string> = {
    admin: "Admin", analyst: "Analyst", business_development: "BD",
    ic_member: "IC Member", credit_committee: "Credit Committee", operations: "Operations",
  };

  const isICOnly = ["ic_member", "credit_committee"].includes(role ?? "");

  return (
    <>
      {/* ── Main header ───────────────────────────────────────────────────── */}
      <header className="h-14 border-b border-border bg-card flex items-center gap-4 px-4 lg:px-6">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 shrink-0 mr-2">
          <img src="/Rehbar_logo.png" alt="Rehbar" className="h-8 w-auto object-contain" />
          <span className="font-semibold text-foreground hidden sm:block text-sm">Rehbar CAS</span>
        </Link>

        {/* Navigation */}
        <nav className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto">
          {isICOnly ? (
            navLink("/ic", "IC Review")
          ) : (
            <>
              {navLink("/", "Pipeline")}
              {navLink("/new", "New Case")}
              {navLink("/companies", "Companies")}
              {navLink("/users", "Team")}
              {navLink("/observability", "System")}
              {role === "admin" && navLink("/ic", "IC Portal")}
            </>
          )}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Clock */}
          <span className="hidden lg:block text-sm text-muted-foreground mr-2 tabular-nums">
            {fmtClock(now)}
          </span>

          {/* RAG Knowledge Base toggle */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("toggle-rag-panel"))}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
            title="Knowledge Base (F7)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
            </svg>
            <span className="hidden lg:block">RAG</span>
          </button>

          {/* Notification bell */}
          {user && <NotificationBell userId={user.id} />}

          {/* User info + logout */}
          <div className="flex items-center gap-2 ml-1 pl-2 border-l border-border">
            {role && (
              <span className="hidden md:block text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {roleLabel[role] ?? role}
              </span>
            )}
            <span className="hidden lg:block text-sm text-muted-foreground truncate max-w-[180px]">
              {user?.email}
            </span>
            <button
              onClick={async () => { await signOut(); navigate("/auth"); }}
              className="h-9 px-3 text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-red-50 rounded-lg transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* ── Compliance notice ─────────────────────────────────────────────── */}
      <div className="border-b border-amber-200 bg-amber-50 px-4 lg:px-6 py-1.5 flex items-center gap-2">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span className="text-xs text-amber-800">
          AI-generated analysis must be reviewed by a qualified analyst before any credit decision is made.
        </span>
      </div>
    </>
  );
};
