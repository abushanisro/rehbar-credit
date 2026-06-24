import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
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
  { value: "admin",                label: "Administrator" },
  { value: "analyst",              label: "Credit Analyst" },
  { value: "business_development", label: "Business Development" },
  { value: "ic_member",            label: "IC Member" },
  { value: "credit_committee",     label: "Credit Committee" },
  { value: "operations",           label: "Operations" },
];

const ROLE_BADGE: Record<string, string> = {
  admin:                "bg-red-50 text-red-700 border-red-200",
  analyst:              "bg-orange-50 text-primary border-orange-200",
  business_development: "bg-amber-50 text-amber-700 border-amber-200",
  ic_member:            "bg-green-50 text-green-700 border-green-200",
  credit_committee:     "bg-blue-50 text-blue-700 border-blue-200",
  operations:           "bg-slate-50 text-slate-600 border-slate-200",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin:                "Full access: create users, manage roles, create/edit/delete cases, approve IC, assign cases.",
  analyst:              "Create & edit cases, create master data, recommend cases to IC committee.",
  business_development: "Create cases, create master data, view all cases. Cannot edit or push to IC.",
  ic_member:            "View-only access to cases that have been recommended to IC.",
  credit_committee:     "View cases and issue final approval decisions on IC-recommended cases.",
  operations:           "View-only access across the platform. No create or edit permissions.",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export default function Users() {
  const { user: currentUser, role: currentRole } = useAuth();
  const [users, setUsers]     = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState("");
  const [filterRole, setFilterRole] = useState("all");

  const [inviteName,  setInviteName]  = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole,  setInviteRole]  = useState("analyst");
  const [inviting,    setInviting]    = useState(false);

  const [changingRole,    setChangingRole]    = useState<string | null>(null);
  const [revokingId,      setRevokingId]      = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [deletingId,      setDeletingId]      = useState<string | null>(null);
  const [confirmAction,   setConfirmAction]   = useState<"revoke" | "delete">("revoke");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: profiles, error: pe }, { data: roles, error: re }] = await Promise.all([
        supabase.from("profiles").select("id, email, full_name, created_at"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (pe) throw new Error(pe.message);
      if (re) throw new Error(re.message);

      const roleMap    = Object.fromEntries((roles ?? []).map(r => [r.user_id, r.role as string]));
      const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]));
      const allIds     = [...new Set([...(profiles ?? []).map(p => p.id), ...(roles ?? []).map(r => r.user_id)])];

      const merged: AppUser[] = allIds.map(uid => {
        const p = profileMap[uid];
        return { id: uid, email: p?.email ?? null, full_name: p?.full_name ?? null, role: roleMap[uid] ?? null, created_at: (p?.created_at as string) ?? new Date().toISOString() };
      });
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
        body: { email: inviteEmail.trim(), name: inviteName.trim() || undefined, role: inviteRole, invited_by_email: currentUser?.email ?? "" },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.already_exists) {
        toast.warning(`${inviteEmail} already has an account — role updated`);
      } else {
        toast.success(`Invitation sent to ${inviteEmail}`);
      }
      setInviteEmail(""); setInviteName(""); setInviteRole("analyst");
      await fetchUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (u: AppUser, newRole: string) => {
    if (u.id === currentUser?.id) return;
    setChangingRole(u.id);
    try {
      const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", u.id);
      if (delErr) throw new Error(delErr.message);
      const { error: insErr } = await supabase.from("user_roles").insert({ user_id: u.id, role: newRole });
      if (insErr) throw new Error(insErr.message);
      toast.success(`Role updated for ${u.email ?? u.id}`);
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
      const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", u.id);
      if (delErr) throw new Error(delErr.message);
      toast.success(`Access removed for ${u.email ?? u.id}`);
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
      const { data, error: fnErr } = await supabase.functions.invoke("delete-user", { body: { user_id: u.id } });
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
    const matchSearch = !q || (u.email ?? "").toLowerCase().includes(q) || (u.full_name ?? "").toLowerCase().includes(q);
    const matchRole   = filterRole === "all" || u.role === filterRole;
    return matchSearch && matchRole;
  });

  const isAdmin  = currentRole === "admin";
  const total    = users.length;
  const byRole   = ROLES.map(r => ({ ...r, count: users.filter(u => u.role === r.value).length }));
  const noRole   = users.filter(u => !u.role).length;

  return (
    <TerminalLayout>
      <div className="space-y-6">

        {/* ── Page header ──────────────────────────────────────────────── */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Team Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage team members, roles, and access permissions</p>
        </div>

        {/* ── Stats ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <div className="bg-card rounded-lg border border-border px-4 py-3" style={{ boxShadow: "var(--shadow-panel)" }}>
            <p className="text-xs font-medium text-muted-foreground">Total Users</p>
            <p className="text-2xl font-bold text-foreground mt-0.5">{total}</p>
          </div>
          {byRole.map(r => (
            <div key={r.value} className="bg-card rounded-lg border border-border px-4 py-3" style={{ boxShadow: "var(--shadow-panel)" }}>
              <p className="text-xs font-medium text-muted-foreground truncate">{r.label}</p>
              <p className="text-2xl font-bold text-foreground mt-0.5">{r.count}</p>
            </div>
          ))}
          {noRole > 0 && (
            <div className="bg-card rounded-lg border border-amber-200 px-4 py-3 bg-amber-50" style={{ boxShadow: "var(--shadow-panel)" }}>
              <p className="text-xs font-medium text-amber-700">No Role</p>
              <p className="text-2xl font-bold text-amber-700 mt-0.5">{noRole}</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

          {/* ── LEFT: Team table ─────────────────────────────────────────── */}
          <div className="xl:col-span-8 bg-card rounded-lg border border-border overflow-hidden" style={{ boxShadow: "var(--shadow-panel)" }}>
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Team Members</h2>
              <button
                onClick={fetchUsers}
                disabled={loading}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:border-primary/40 transition-colors disabled:opacity-50"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? "animate-spin" : ""}>
                  <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                {loading ? "Syncing…" : "Refresh"}
              </button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 px-5 py-3 border-b border-border bg-surface-2/40">
              <div className="relative flex-1 min-w-[200px]">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="search"
                  placeholder="Search by name or email…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              <select
                value={filterRole}
                onChange={e => setFilterRole(e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="all">All Roles</option>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>

            {error && (
              <div className="mx-5 my-3 flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </div>
            )}

            {loading && !users.length ? (
              <div className="flex items-center justify-center py-16">
                <span className="text-sm text-muted-foreground animate-pulse">Loading team members…</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/30">
                      <th className="text-left py-3 px-5 text-xs font-medium text-muted-foreground">Name / Email</th>
                      <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Role</th>
                      <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Joined</th>
                      {isAdmin && <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={isAdmin ? 4 : 3} className="text-center py-12 text-sm text-muted-foreground">
                          {search || filterRole !== "all" ? "No users match your search" : "No users found"}
                        </td>
                      </tr>
                    )}
                    {filtered.map(u => {
                      const isMe       = u.id === currentUser?.id;
                      const roleStyle  = u.role ? (ROLE_BADGE[u.role] ?? "bg-slate-50 text-slate-600 border-slate-200") : "bg-amber-50 text-amber-600 border-amber-200";
                      const isChanging = changingRole === u.id;
                      return (
                        <tr key={u.id} className={cn("border-b border-border/50 hover:bg-surface-2/50 transition-colors", isMe && "bg-primary/3")}>
                          {/* Name + Email */}
                          <td className="py-3.5 px-5">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                <span className="text-xs font-semibold text-primary">
                                  {(u.full_name ?? u.email ?? "?")[0].toUpperCase()}
                                </span>
                              </div>
                              <div className="min-w-0">
                                {u.full_name && <p className="text-sm font-medium text-foreground truncate">{u.full_name}</p>}
                                <p className={cn("text-xs truncate", u.full_name ? "text-muted-foreground" : "text-sm font-medium text-foreground")}>
                                  {u.email ?? <span className="italic text-muted-foreground/50">No email</span>}
                                </p>
                              </div>
                              {isMe && (
                                <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">You</span>
                              )}
                            </div>
                          </td>
                          {/* Role */}
                          <td className="py-3.5 px-4">
                            {u.role ? (
                              <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border", roleStyle)}>
                                {ROLES.find(r => r.value === u.role)?.label ?? u.role}
                              </span>
                            ) : (
                              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                                No role assigned
                              </span>
                            )}
                          </td>
                          {/* Joined */}
                          <td className="py-3.5 px-4 text-sm text-muted-foreground whitespace-nowrap">
                            {fmtDate(u.created_at)}
                          </td>
                          {/* Actions */}
                          {isAdmin && (
                            <td className="py-3 px-4">
                              {isMe ? (
                                <span className="text-sm text-muted-foreground/30">—</span>
                              ) : isChanging || revokingId === u.id || deletingId === u.id ? (
                                <span className="text-sm text-amber-600 animate-pulse">
                                  {deletingId === u.id ? "Deleting…" : revokingId === u.id ? "Removing access…" : "Updating…"}
                                </span>
                              ) : confirmRevokeId === u.id ? (
                                <div className="space-y-2">
                                  <p className={cn("text-sm font-medium", confirmAction === "delete" ? "text-red-700" : "text-amber-700")}>
                                    {confirmAction === "delete" ? "Permanently delete this user?" : "Remove their access?"}
                                  </p>
                                  {confirmAction === "delete" && (
                                    <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
                                  )}
                                  <div className="flex items-center gap-2 mt-1">
                                    <button
                                      onClick={() => confirmAction === "delete" ? deleteUser(u) : removeAccess(u)}
                                      className={cn(
                                        "text-sm font-medium px-3 py-1.5 rounded-lg border transition-colors",
                                        confirmAction === "delete"
                                          ? "border-red-300 text-red-700 bg-red-50 hover:bg-red-100"
                                          : "border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100"
                                      )}
                                    >
                                      {confirmAction === "delete" ? "Delete" : "Remove Access"}
                                    </button>
                                    <button
                                      onClick={() => setConfirmRevokeId(null)}
                                      className="text-sm font-medium px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <select
                                    value={u.role ?? ""}
                                    onChange={e => changeRole(u, e.target.value)}
                                    className="bg-background border border-border rounded-md text-xs px-2 py-1.5 focus:outline-none focus:border-primary hover:border-primary/40 cursor-pointer"
                                  >
                                    <option value="" disabled>Change role…</option>
                                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                  </select>
                                  <button
                                    onClick={() => { setConfirmAction("revoke"); setConfirmRevokeId(u.id); }}
                                    className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-amber-200 text-amber-700 hover:bg-amber-50 transition-colors"
                                    title="Remove role — user keeps their account"
                                  >
                                    Remove Access
                                  </button>
                                  <button
                                    onClick={() => { setConfirmAction("delete"); setConfirmRevokeId(u.id); }}
                                    className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
                                    title="Permanently delete this user"
                                  >
                                    Delete
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
              <div className="px-5 py-3 border-t border-border bg-surface-2/30">
                <p className="text-xs text-muted-foreground">Showing {filtered.length} of {total} team members</p>
              </div>
            )}
          </div>

          {/* ── RIGHT: Invite + Permissions ──────────────────────────────── */}
          <div className="xl:col-span-4 space-y-5">

            {/* Invite panel */}
            {isAdmin ? (
              <div className="bg-card rounded-lg border border-border overflow-hidden" style={{ boxShadow: "var(--shadow-panel)" }}>
                <div className="px-5 py-4 border-b border-border">
                  <h2 className="text-sm font-semibold text-foreground">Invite New Team Member</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Send a branded invitation email</p>
                </div>
                <form onSubmit={sendInvite} className="px-5 py-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Full Name <span className="text-muted-foreground font-normal">(optional)</span></label>
                    <input
                      type="text"
                      className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      placeholder="e.g. Raashid Ahmed"
                      value={inviteName}
                      onChange={e => setInviteName(e.target.value)}
                      disabled={inviting}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Email Address <span className="text-red-500">*</span></label>
                    <input
                      required
                      type="email"
                      className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      placeholder="analyst@rehbar.co.in"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      disabled={inviting}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Assign Role <span className="text-red-500">*</span></label>
                    <select
                      className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value)}
                      disabled={inviting}
                    >
                      {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>

                  {/* Role description */}
                  {ROLE_DESCRIPTIONS[inviteRole] && (
                    <div className="rounded-lg bg-surface-2 border border-border px-3 py-2.5">
                      <p className="text-xs font-medium text-foreground mb-0.5">
                        {ROLES.find(r => r.value === inviteRole)?.label}
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {ROLE_DESCRIPTIONS[inviteRole]}
                      </p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={inviting || !inviteEmail.trim()}
                    className="w-full bg-primary text-white rounded-lg py-3 text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {inviting ? "Sending invitation…" : "Send Invitation"}
                  </button>

                  <p className="text-xs text-muted-foreground leading-relaxed">
                    A Rehbar-branded invite email will be sent. If the user already has an account, their role will be updated.
                  </p>
                </form>
              </div>
            ) : (
              <div className="bg-card rounded-lg border border-border p-6 text-center" style={{ boxShadow: "var(--shadow-panel)" }}>
                <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-3">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-foreground mb-1">Admin access required</p>
                <p className="text-xs text-muted-foreground">Only administrators can invite users or change roles. Contact your administrator to request changes.</p>
              </div>
            )}

            {/* Permissions matrix */}
            <div className="bg-card rounded-lg border border-border overflow-hidden" style={{ boxShadow: "var(--shadow-panel)" }}>
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">Role Permissions</h2>
                <p className="text-xs text-muted-foreground mt-0.5">What each role can do</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/30">
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Permission</th>
                      {["Admin","Analyst","BD","IC","CC","Ops"].map(r => (
                        <th key={r} className="py-2.5 px-2 text-xs font-medium text-muted-foreground text-center">{r}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      ["View Cases",     [1,1,1,1,1,1]],
                      ["Create Case",    [1,1,1,0,0,0]],
                      ["Edit Case",      [1,1,0,0,0,0]],
                      ["Delete Case",    [1,0,0,0,0,0]],
                      ["Master Data",    [1,1,1,0,0,0]],
                      ["Assign Case",    [1,0,0,0,0,0]],
                      ["Recommend IC",   [1,1,0,0,0,0]],
                      ["Approve IC",     [1,0,0,0,1,0]],
                      ["Manage Users",   [1,0,0,0,0,0]],
                    ] as [string, number[]][]).map(([label, perms]) => (
                      <tr key={label} className="border-b border-border/40 hover:bg-surface-2/40">
                        <td className="py-2.5 px-4 text-sm text-foreground/80 whitespace-nowrap">{label}</td>
                        {perms.map((p, i) => (
                          <td key={i} className="py-2.5 px-2 text-center">
                            {p
                              ? <span className="inline-block w-4 h-4 rounded-full bg-green-100 text-green-600 text-[10px] leading-4 font-bold text-center">✓</span>
                              : <span className="inline-block w-1 h-1 rounded-full bg-border mx-auto" />}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TerminalLayout>
  );
}
