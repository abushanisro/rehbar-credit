import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { Panel } from "@/components/terminal/Panel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type AppUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  created_at: string;
};

const ROLES = [
  { value: "admin",               label: "Administrator" },
  { value: "analyst",             label: "Credit Analyst" },
  { value: "business_development",label: "Business Development" },
  { value: "ic_member",           label: "IC Member" },
  { value: "credit_committee",    label: "Credit Committee" },
  { value: "operations",          label: "Operations" },
];

const ROLE_BADGE: Record<string, string> = {
  admin:                "bg-destructive/20 text-destructive border-destructive/40",
  analyst:              "bg-primary/10 text-primary border-primary/30",
  business_development: "bg-accent/10 text-accent border-accent/30",
  ic_member:            "bg-success/10 text-success border-success/30",
  credit_committee:     "bg-warning/10 text-warning border-warning/30",
  operations:           "bg-muted/20 text-muted-foreground border-border",
};

const ROLE_LABEL: Record<string, string> = {
  admin:                "ADMIN",
  analyst:              "ANALYST",
  business_development: "BD",
  ic_member:            "IC MEMBER",
  credit_committee:     "CC",
  operations:           "OPS",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export default function Users() {
  const { user: currentUser, role: currentRole } = useAuth();
  const [users, setUsers]       = useState<AppUser[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState("");
  const [filterRole, setFilterRole] = useState("all");

  // Invite form
  const [inviteName,  setInviteName]  = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole,  setInviteRole]  = useState("analyst");
  const [inviting,    setInviting]    = useState(false);

  // Inline role change / revoke / delete
  const [changingRole,    setChangingRole]    = useState<string | null>(null);
  const [revokingId,      setRevokingId]      = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [deletingId,      setDeletingId]      = useState<string | null>(null);
  // "revoke" | "delete" — which action is being confirmed
  const [confirmAction,   setConfirmAction]   = useState<"revoke" | "delete">("revoke");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Query profiles (email + name) and user_roles separately, join client-side.
      // Both tables now have SELECT open to all authenticated users via migration
      // 20260516010000_team_page_rls.sql
      const [{ data: profiles, error: pe }, { data: roles, error: re }] = await Promise.all([
        supabase.from("profiles").select("id, email, full_name, created_at"),
        supabase.from("user_roles").select("user_id, role"),
      ]);

      if (pe) throw new Error(pe.message);
      if (re) throw new Error(re.message);

      const roleMap = Object.fromEntries(
        (roles ?? []).map(r => [r.user_id, r.role as string])
      );

      const merged: AppUser[] = (profiles ?? []).map(p => ({
        id:         p.id,
        email:      p.email ?? null,
        full_name:  p.full_name ?? null,
        role:       roleMap[p.id] ?? null,
        created_at: p.created_at as string,
      }));

      // Sort: current user first, then by join date desc
      merged.sort((a, b) => {
        if (a.id === currentUser?.id) return -1;
        if (b.id === currentUser?.id) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setUsers(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("invite-user", {
        body: {
          email:            inviteEmail.trim(),
          name:             inviteName.trim() || undefined,
          role:             inviteRole,
          invited_by_email: currentUser?.email ?? "",
        },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.already_exists) {
        toast.warning(`${inviteEmail} already has an account — role updated to ${ROLE_LABEL[inviteRole] ?? inviteRole}`);
      } else {
        toast.success(`Invite sent to ${inviteEmail}`);
      }
      setInviteEmail(""); setInviteName(""); setInviteRole("analyst");
      await fetchUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setInviting(false);
    }
  };

  // Admins can write user_roles directly (user_roles_admin_all RLS policy)
  const changeRole = async (u: AppUser, newRole: string) => {
    if (u.id === currentUser?.id) return;
    setChangingRole(u.id);
    try {
      // Delete existing roles for this user, then insert the new one
      const { error: delErr } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", u.id);
      if (delErr) throw new Error(delErr.message);

      const { error: insErr } = await supabase
        .from("user_roles")
        .insert({ user_id: u.id, role: newRole });
      if (insErr) throw new Error(insErr.message);

      toast.success(`${u.email ?? u.id} → ${ROLE_LABEL[newRole] ?? newRole}`);
      await fetchUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Role change failed");
    } finally {
      setChangingRole(null);
    }
  };

  const removeAccess = async (u: AppUser) => {
    setConfirmRevokeId(null);
    setRevokingId(u.id);
    try {
      const { error: delErr } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", u.id);
      if (delErr) throw new Error(delErr.message);
      toast.success(`Role removed — ${u.email ?? u.id} can no longer access the platform`);
      await fetchUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Remove access failed");
    } finally {
      setRevokingId(null);
    }
  };

  const deleteUser = async (u: AppUser) => {
    setConfirmRevokeId(null);
    setDeletingId(u.id);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("delete-user", {
        body: { user_id: u.id },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      toast.success(`${u.email ?? u.id} permanently deleted`);
      await fetchUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || (u.email ?? "").toLowerCase().includes(q)
      || (u.full_name ?? "").toLowerCase().includes(q);
    const matchRole = filterRole === "all" || u.role === filterRole;
    return matchSearch && matchRole;
  });

  const isAdmin = currentRole === "admin";
  const total   = users.length;
  const byRole  = ROLES.map(r => ({ ...r, count: users.filter(u => u.role === r.value).length }));
  const noRole  = users.filter(u => !u.role).length;

  const inputCls = "bg-input border border-border px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary font-mono";
  const labelCls = "terminal-label block mb-1";

  return (
    <TerminalLayout>
      <div className="space-y-3">

        {/* ── Stats ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <div className="terminal-panel px-3 py-2">
            <div className="terminal-label">TOTAL</div>
            <div className="text-2xl font-bold text-primary mt-0.5 tabular-nums">{total}</div>
          </div>
          {byRole.map(r => (
            <div key={r.value} className="terminal-panel px-3 py-2">
              <div className="terminal-label">{ROLE_LABEL[r.value]}</div>
              <div className="text-2xl font-bold text-primary mt-0.5 tabular-nums">{r.count}</div>
            </div>
          ))}
          {noRole > 0 && (
            <div className="terminal-panel px-3 py-2">
              <div className="terminal-label text-warning">NO ROLE</div>
              <div className="text-2xl font-bold text-warning mt-0.5 tabular-nums">{noRole}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">

          {/* ── LEFT: table ─────────────────────────────────────────────── */}
          <Panel title="TEAM MEMBERS" ticker="REHBAR/TEAM" className="xl:col-span-8">

            {/* Filters */}
            <div className="flex flex-wrap gap-2 mb-3">
              <input
                type="search"
                placeholder="Search by email or name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className={cn(inputCls, "flex-1 min-w-[180px]")}
              />
              <select
                value={filterRole}
                onChange={e => setFilterRole(e.target.value)}
                className={inputCls}
              >
                <option value="all">All Roles</option>
                {ROLES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <button
                onClick={fetchUsers}
                disabled={loading}
                className="border border-border text-muted-foreground px-3 py-1.5 text-xs tracking-widest hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
              >
                {loading ? "SYNCING…" : "↻ REFRESH"}
              </button>
            </div>

            {error && (
              <div className="border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-xs mb-3 tracking-wide">
                ✗ {error}
              </div>
            )}

            {loading && !users.length ? (
              <div className="flex items-center justify-center py-12">
                <span className="text-muted-foreground text-xs tracking-widest animate-pulse">LOADING TEAM DATA…</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-surface/60">
                      {(["EMAIL", "NAME", "ROLE", "JOINED", isAdmin ? "ACTIONS" : ""] as string[])
                        .filter(Boolean)
                        .map(h => (
                          <th key={h} className="text-left py-2 px-3 text-[9px] tracking-widest text-muted-foreground font-normal whitespace-nowrap border-r border-border/30 last:border-r-0">
                            {h}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={isAdmin ? 5 : 4} className="text-center py-10 text-muted-foreground tracking-wider text-xs">
                          {search || filterRole !== "all" ? "No users match filter" : "No users found"}
                        </td>
                      </tr>
                    )}
                    {filtered.map(u => {
                      const isMe       = u.id === currentUser?.id;
                      const roleStyle  = u.role ? (ROLE_BADGE[u.role] ?? "bg-muted/10 text-muted-foreground border-border/30") : "bg-muted/10 text-muted-foreground border-border/30";
                      const isChanging = changingRole === u.id;
                      return (
                        <tr key={u.id} className={cn(
                          "border-b border-border/40 hover:bg-surface-2 transition-colors align-middle",
                          isMe && "bg-primary/5"
                        )}>
                          {/* Email */}
                          <td className="py-2.5 px-3 border-r border-border/20">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-primary truncate">{u.email ?? <span className="text-muted-foreground italic">no email</span>}</span>
                              {isMe && (
                                <span className="shrink-0 text-[8px] font-bold tracking-widest text-primary border border-primary/40 px-1 py-px">YOU</span>
                              )}
                            </div>
                          </td>
                          {/* Name */}
                          <td className="py-2.5 px-3 text-foreground/70 border-r border-border/20 whitespace-nowrap">
                            {u.full_name || <span className="text-muted-foreground/30 italic text-[10px]">—</span>}
                          </td>
                          {/* Role badge */}
                          <td className="py-2.5 px-3 border-r border-border/20 whitespace-nowrap">
                            {u.role ? (
                              <span className={cn("text-[9px] font-bold tracking-widest border px-1.5 py-0.5", roleStyle)}>
                                {ROLE_LABEL[u.role] ?? u.role.toUpperCase()}
                              </span>
                            ) : (
                              <span className="text-[9px] text-warning tracking-widest font-bold">NO ROLE</span>
                            )}
                          </td>
                          {/* Joined */}
                          <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap border-r border-border/20">
                            {fmtDate(u.created_at)}
                          </td>
                          {/* Actions — admin only */}
                          {isAdmin && (
                            <td className="py-2 px-3">
                              {isMe ? (
                                <span className="text-[9px] text-muted-foreground/25 tracking-widest">—</span>

                              ) : isChanging || revokingId === u.id || deletingId === u.id ? (
                                <span className="text-[9px] text-warning animate-pulse tracking-widest">
                                  {deletingId === u.id ? "DELETING…" : revokingId === u.id ? "REVOKING…" : "UPDATING…"}
                                </span>

                              ) : confirmRevokeId === u.id ? (
                                /* ── Confirm step ── */
                                <div className="space-y-1">
                                  <div className={cn(
                                    "text-[9px] font-bold tracking-widest",
                                    confirmAction === "delete" ? "text-destructive" : "text-warning"
                                  )}>
                                    {confirmAction === "delete"
                                      ? "PERMANENTLY DELETE USER?"
                                      : "REMOVE ACCESS?"}
                                  </div>
                                  {confirmAction === "delete" && (
                                    <div className="text-[8px] text-muted-foreground tracking-wide">
                                      This cannot be undone.
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1.5 mt-1">
                                    <button
                                      onClick={() => confirmAction === "delete" ? deleteUser(u) : removeAccess(u)}
                                      className={cn(
                                        "text-[9px] font-bold tracking-widest border px-2 py-0.5 transition-colors",
                                        confirmAction === "delete"
                                          ? "border-destructive text-destructive bg-destructive/10 hover:bg-destructive/20"
                                          : "border-warning/60 text-warning bg-warning/10 hover:bg-warning/20"
                                      )}
                                    >
                                      {confirmAction === "delete" ? "DELETE" : "REVOKE"}
                                    </button>
                                    <button
                                      onClick={() => setConfirmRevokeId(null)}
                                      className="text-[9px] font-bold tracking-widest border border-border text-muted-foreground px-2 py-0.5 hover:border-primary hover:text-primary transition-colors"
                                    >
                                      CANCEL
                                    </button>
                                  </div>
                                </div>

                              ) : (
                                /* ── Normal: role dropdown + revoke + delete ── */
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <select
                                    value={u.role ?? ""}
                                    onChange={e => changeRole(u, e.target.value)}
                                    className="bg-input border border-border text-[9px] text-muted-foreground px-1.5 py-1 focus:outline-none focus:border-primary hover:border-primary/60 transition-colors cursor-pointer font-mono tracking-wider"
                                  >
                                    <option value="" disabled>— ROLE —</option>
                                    {ROLES.map(r => (
                                      <option key={r.value} value={r.value}>
                                        {r.label.toUpperCase()}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => { setConfirmAction("revoke"); setConfirmRevokeId(u.id); }}
                                    className="text-[9px] font-bold tracking-widest border border-warning/40 text-warning/70 px-2 py-1 hover:bg-warning/10 hover:border-warning hover:text-warning transition-colors whitespace-nowrap"
                                    title="Remove role — user keeps their account"
                                  >
                                    REVOKE
                                  </button>
                                  <button
                                    onClick={() => { setConfirmAction("delete"); setConfirmRevokeId(u.id); }}
                                    className="text-[9px] font-bold tracking-widest border border-destructive/40 text-destructive/70 px-2 py-1 hover:bg-destructive/10 hover:border-destructive hover:text-destructive transition-colors whitespace-nowrap"
                                    title="Permanently delete this user"
                                  >
                                    DELETE
                                  </button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && filtered.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/30 text-[9px] text-muted-foreground tracking-wider">
                SHOWING {filtered.length} OF {total} TEAM MEMBERS
              </div>
            )}
          </Panel>

          {/* ── RIGHT ────────────────────────────────────────────────────── */}
          <div className="xl:col-span-4 space-y-3">

            {/* Invite panel — admin only */}
            {isAdmin ? (
              <Panel title="INVITE NEW USER" ticker="REHBAR/INVITE" status="live">
                <form onSubmit={sendInvite} className="space-y-3">
                  <div>
                    <label className={labelCls}>Full Name (optional)</label>
                    <input
                      type="text"
                      className={cn(inputCls, "w-full")}
                      placeholder="Raashid Ahmed"
                      value={inviteName}
                      onChange={e => setInviteName(e.target.value)}
                      disabled={inviting}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Email Address *</label>
                    <input
                      required
                      type="email"
                      className={cn(inputCls, "w-full")}
                      placeholder="analyst@rehbar.co.in"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      disabled={inviting}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Assign Role *</label>
                    <select
                      className={cn(inputCls, "w-full")}
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value)}
                      disabled={inviting}
                    >
                      {ROLES.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Live role description */}
                  <div className="border border-border/50 bg-surface/40 px-3 py-2.5 text-[10px] space-y-1">
                    {{
                      admin:                { color: "text-destructive",    title: "ADMINISTRATOR",        desc: "Full access: create users, manage roles, create / edit / delete cases, approve IC, assign cases." },
                      analyst:              { color: "text-primary",        title: "CREDIT ANALYST",       desc: "Create & edit cases, create master data, recommend cases to IC committee." },
                      business_development: { color: "text-accent",         title: "BUSINESS DEVELOPMENT", desc: "Create cases, create master data, view all cases. Cannot edit or push to IC." },
                      ic_member:            { color: "text-success",        title: "IC MEMBER",            desc: "View-only access to cases that have been recommended to IC." },
                      credit_committee:     { color: "text-warning",        title: "CREDIT COMMITTEE",     desc: "View cases and issue final approval decisions on IC-recommended cases." },
                      operations:           { color: "text-muted-foreground",title: "OPERATIONS",          desc: "View-only access across the platform. No create or edit permissions." },
                    }[inviteRole] && (() => {
                      const r = ({
                        admin:                { color: "text-destructive",    title: "ADMINISTRATOR",        desc: "Full access: create users, manage roles, create / edit / delete cases, approve IC, assign cases." },
                        analyst:              { color: "text-primary",        title: "CREDIT ANALYST",       desc: "Create & edit cases, create master data, recommend cases to IC committee." },
                        business_development: { color: "text-accent",         title: "BUSINESS DEVELOPMENT", desc: "Create cases, create master data, view all cases. Cannot edit or push to IC." },
                        ic_member:            { color: "text-success",        title: "IC MEMBER",            desc: "View-only access to cases that have been recommended to IC." },
                        credit_committee:     { color: "text-warning",        title: "CREDIT COMMITTEE",     desc: "View cases and issue final approval decisions on IC-recommended cases." },
                        operations:           { color: "text-muted-foreground",title: "OPERATIONS",          desc: "View-only access across the platform. No create or edit permissions." },
                      } as Record<string, {color:string;title:string;desc:string}>)[inviteRole];
                      return r ? (
                        <>
                          <div className={cn("font-bold tracking-wider", r.color)}>{r.title}</div>
                          <div className="text-muted-foreground leading-relaxed">{r.desc}</div>
                        </>
                      ) : null;
                    })()}
                  </div>

                  <button
                    type="submit"
                    disabled={inviting || !inviteEmail.trim()}
                    className="w-full bg-primary text-primary-foreground py-2 text-xs tracking-widest font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                  >
                    {inviting ? "SENDING INVITE…" : `[SEND INVITE → ${ROLE_LABEL[inviteRole] ?? inviteRole}]`}
                  </button>

                  <p className="text-[9px] text-muted-foreground/50 leading-relaxed tracking-wide">
                    A branded Rehbar invite email is sent via Resend. If the user already has an account, their role is updated and no email is re-sent.
                  </p>
                </form>
              </Panel>
            ) : (
              <Panel title="ACCESS RESTRICTED" ticker="REHBAR/TEAM" status="warn">
                <div className="py-6 text-center space-y-2">
                  <div className="text-warning text-2xl">⊘</div>
                  <div className="text-xs text-muted-foreground tracking-wider leading-relaxed">
                    Only Administrators can invite users or change roles.<br />
                    Contact your admin to request changes.
                  </div>
                </div>
              </Panel>
            )}

            {/* Permissions matrix */}
            <Panel title="ROLE PERMISSIONS" ticker="RBAC">
              <div className="overflow-x-auto">
                <table className="w-full text-[9px] border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1.5 px-2 text-muted-foreground font-normal tracking-widest whitespace-nowrap">PERMISSION</th>
                      {["ADM","ANL","BD","IC","CC","OPS"].map(r => (
                        <th key={r} className="py-1.5 px-2 text-muted-foreground font-normal tracking-widest text-center">{r}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      ["View Cases",    [1,1,1,1,1,1]],
                      ["Create Case",   [1,1,1,0,0,0]],
                      ["Edit Case",     [1,1,0,0,0,0]],
                      ["Delete Case",   [1,0,0,0,0,0]],
                      ["Create Master", [1,1,1,0,0,0]],
                      ["Assign Case",   [1,0,0,0,0,0]],
                      ["Recommend IC",  [1,1,0,0,0,0]],
                      ["Approve IC",    [1,0,0,0,1,0]],
                      ["Manage Users",  [1,0,0,0,0,0]],
                    ] as [string, number[]][]).map(([label, perms]) => (
                      <tr key={label} className="border-b border-border/30 hover:bg-surface-2">
                        <td className="py-1.5 px-2 text-muted-foreground whitespace-nowrap">{label}</td>
                        {perms.map((p, i) => (
                          <td key={i} className="py-1.5 px-2 text-center">
                            {p
                              ? <span className="text-success font-bold">✓</span>
                              : <span className="text-muted-foreground/25">—</span>
                            }
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

          </div>
        </div>
      </div>
    </TerminalLayout>
  );
}
