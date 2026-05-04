import { useEffect, useRef, useState } from "react";
import { useOthers, useSelf } from "@/liveblocks.config";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Props {
  caseCode: string;
  clientName: string;
}

function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}

type InviteStatus = "idle" | "sending" | "sent" | "error";

export function ShareDialog({ caseCode, clientName }: Props) {
  const [open, setOpen]           = useState(false);
  const [copied, setCopied]       = useState(false);
  const [email, setEmail]         = useState("");
  const [inviteStatus, setStatus] = useState<InviteStatus>("idle");
  const [inviteError, setError]   = useState("");
  const dialogRef                 = useRef<HTMLDivElement>(null);
  const inputRef                  = useRef<HTMLInputElement>(null);
  const others                    = useOthers();
  const self                      = useSelf();

  const caseUrl = window.location.href;

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(caseUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sendInvite = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setStatus("sending");
    setError("");
    try {
      const { data, error } = await supabase.functions.invoke("invite-user", {
        body: { email: trimmed, case_code: caseCode, client_name: clientName, redirect_url: caseUrl },
      });
      if (error) throw new Error(error.message ?? "Invite failed");
      if (data?.already_exists) throw new Error(data.error);
      if (!data?.ok) throw new Error(data?.error ?? "Invite failed");
      setStatus("sent");
      setEmail("");
      setTimeout(() => setStatus("idle"), 4000);
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 5000);
    }
  };

  // Deduplicate by email — same user with multiple tabs shows only once
  const selfEntry = self ? {
    id: "self",
    name: self.presence?.name ?? "You",
    email: self.presence?.email ?? "",
    color: self.presence?.color ?? "#E8721C",
    tab: self.presence?.activeTab ?? "",
    isSelf: true,
  } : null;

  const seenEmails = new Set(selfEntry?.email ? [selfEntry.email] : []);
  const otherUsers = others
    .map(o => ({
      id: String(o.connectionId),
      name: o.presence?.name ?? "Analyst",
      email: o.presence?.email ?? "",
      color: o.presence?.color ?? "#F5A428",
      tab: o.presence?.activeTab ?? "",
      isSelf: false,
    }))
    .filter(u => {
      if (!u.email || seenEmails.has(u.email)) return false;
      seenEmails.add(u.email);
      return true;
    });

  const allUsers = [...(selfEntry ? [selfEntry] : []), ...otherUsers];

  return (
    <div ref={dialogRef} className="relative">

      {/* ── Share button ─────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold tracking-widest border transition-colors",
          open
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-primary/10 border-primary/50 text-primary hover:bg-primary hover:text-primary-foreground"
        )}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        SHARE
        {others.length > 0 && (
          <span className="bg-success text-success-foreground text-[8px] font-bold px-1 leading-tight">
            {others.length}
          </span>
        )}
      </button>

      {/* ── Panel ────────────────────────────────────────────────────────── */}
      {open && (
        <div
          className="absolute right-0 top-10 z-50 bg-surface border border-border shadow-2xl flex flex-col"
          style={{ width: "min(380px, calc(100vw - 1.5rem))", maxHeight: "85vh" }}
        >
          {/* Header */}
          <div className="border-b border-border bg-card px-4 py-2.5 flex items-center justify-between shrink-0">
            <div>
              <div className="text-[11px] font-bold tracking-widest text-primary">SHARE &amp; INVITE</div>
              <div className="text-[9px] text-muted-foreground tracking-wider mt-0.5">
                {caseCode} · {clientName}
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground text-xs w-6 h-6 flex items-center justify-center">✕</button>
          </div>

          <div className="overflow-y-auto flex-1 p-4 space-y-5">

            {/* ── Invite by email ─────────────────────────────────────── */}
            <div>
              <div className="text-[9px] text-muted-foreground tracking-widest mb-2 flex items-center gap-1">
                <span>INVITE ANALYST</span>
                <span className="text-muted-foreground/40">— sends a Supabase account invite email</span>
              </div>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") sendInvite(); }}
                  placeholder="analyst@rehbar.com"
                  disabled={inviteStatus === "sending"}
                  className="flex-1 bg-input border border-border px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary placeholder:text-muted-foreground/40 disabled:opacity-50"
                />
                <button
                  onClick={sendInvite}
                  disabled={!email.trim() || inviteStatus === "sending"}
                  className={cn(
                    "shrink-0 px-3 py-1.5 text-[10px] font-bold tracking-widest border transition-colors min-w-[64px]",
                    inviteStatus === "sent"
                      ? "bg-success text-success-foreground border-success"
                      : inviteStatus === "error"
                      ? "bg-destructive/20 text-destructive border-destructive/50"
                      : "bg-primary text-primary-foreground border-primary hover:opacity-90 disabled:opacity-40"
                  )}
                >
                  {inviteStatus === "sending" ? "…" : inviteStatus === "sent" ? "✓ SENT" : inviteStatus === "error" ? "FAILED" : "INVITE"}
                </button>
              </div>
              {inviteStatus === "sent" && (
                <div className="mt-1.5 text-[9px] text-success tracking-wider">
                  ✓ Invite email sent — they'll receive a link to set up their account and will land directly on this case
                </div>
              )}
              {inviteStatus === "error" && (
                <div className="mt-1.5 text-[9px] text-destructive tracking-wider">✕ {inviteError}</div>
              )}
            </div>

            {/* ── Copy case link ──────────────────────────────────────── */}
            <div>
              <div className="text-[9px] text-muted-foreground tracking-widest mb-2">CASE LINK</div>
              <div className="flex gap-2">
                <div className="flex-1 bg-background border border-border/60 px-2 py-1.5 text-[10px] text-muted-foreground truncate font-mono">
                  {caseUrl}
                </div>
                <button
                  onClick={copyLink}
                  className={cn(
                    "shrink-0 px-3 py-1.5 text-[10px] font-bold tracking-widest border transition-colors min-w-[64px]",
                    copied
                      ? "bg-success text-success-foreground border-success"
                      : "border-border text-primary/80 hover:border-primary hover:text-primary"
                  )}
                >
                  {copied ? "✓ COPIED" : "COPY"}
                </button>
              </div>
              <div className="text-[9px] text-muted-foreground/50 mt-1 tracking-wider">
                Share with anyone who already has a Rehbar account
              </div>
            </div>

            {/* ── Who's online ───────────────────────────────────────── */}
            <div>
              <div className="text-[9px] text-muted-foreground tracking-widest mb-2">
                CURRENTLY IN THIS CASE
                <span className={cn("ml-1.5 font-bold", others.length > 0 ? "text-success" : "text-muted-foreground")}>
                  ● {allUsers.length} {allUsers.length === 1 ? "PERSON" : "PEOPLE"}
                </span>
              </div>
              {allUsers.length === 0 ? (
                <div className="text-[10px] text-muted-foreground/50 py-2 text-center tracking-wider">No one else is online</div>
              ) : (
                <div className="space-y-1.5">
                  {allUsers.map(u => (
                    <div key={u.id} className={cn(
                      "flex items-center gap-2.5 px-2.5 py-2 border",
                      u.isSelf ? "border-primary/20 bg-primary/5" : "border-border/40 bg-background/40"
                    )}>
                      <div
                        className="w-8 h-8 flex items-center justify-center text-[11px] font-bold shrink-0"
                        style={{ backgroundColor: u.color, color: "#fff" }}
                      >
                        {initials(u.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-primary font-bold truncate">
                          {u.name}
                          {u.isSelf && <span className="text-muted-foreground font-normal text-[9px] ml-1">(you)</span>}
                        </div>
                        {u.email && <div className="text-[9px] text-muted-foreground truncate">{u.email}</div>}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-success ticker-blink inline-block" />
                          <span className="text-[8px] text-success tracking-widest">LIVE</span>
                        </div>
                        {u.tab && (
                          <div className="text-[8px] text-muted-foreground tracking-wider mt-0.5 uppercase">{u.tab}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-border px-4 py-2 shrink-0 text-[9px] text-muted-foreground/60 tracking-wider">
            ▸ Invited users receive a Supabase email to set their password · All analysts can view all cases
          </div>
        </div>
      )}
    </div>
  );
}
