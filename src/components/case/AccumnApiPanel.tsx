import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Panel } from "@/components/terminal/Panel";
import type { Tables } from "@/integrations/supabase/types";

type AccumnOrder = Tables<"accumn_api_orders">;

const LANGUAGES = ["English", "Hindi", "Gujarati", "Marathi", "Tamil", "Telugu", "Punjabi", "Malayalam", "Kannada", "Bengali"];

interface Props {
  caseId: string;
  casePan?: string;
  caseGstin?: string;
  orders: AccumnOrder[];
  onReload: () => Promise<void>;
}

const STATUS_DOT: Record<string, string> = {
  pending: "bg-muted", submitting: "bg-warning", in_progress: "bg-warning",
  completed: "bg-success", cancelled: "bg-muted", failed: "bg-destructive",
};
const STATUS_BADGE: Record<string, string> = {
  pending: "text-muted-foreground", submitting: "text-warning animate-pulse",
  in_progress: "text-warning animate-pulse", completed: "text-success",
  cancelled: "text-muted-foreground", failed: "text-destructive",
};

async function callEdgeFn(name: string, body: unknown): Promise<unknown> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session?.access_token ?? ""}`,
        "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(body),
    },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

// ── ITR+GST sub-panel ──────────────────────────────────────────────────────────

function ItrGstForm({ caseId, casePan, caseGstin, orders, onReload }: Props) {
  const [pan, setPan]             = useState(casePan ?? "");
  const [gstin, setGstin]         = useState(caseGstin ?? "");
  const [entityType, setEntity]   = useState<"individual" | "corporate">("individual");
  const [language, setLanguage]   = useState("English");
  const [doib, setDoib]           = useState("");
  const [email, setEmail]         = useState("");
  const [phone, setPhone]         = useState("");
  const [submitting, setSubmit] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const activeOrders = orders.filter(o => o.product_type === "ITR_GST");

  const handleCreate = async () => {
    if (!pan && !gstin) { toast.error("Enter PAN (for ITR) or GSTIN (for GST)"); return; }
    if (!doib.trim())  { toast.error("Date of birth / incorporation is required"); return; }
    if (!email.trim()) { toast.error("Borrower email is required"); return; }
    if (!phone.trim()) { toast.error("Borrower phone is required"); return; }
    setSubmit(true);
    try {
      const res = await callEdgeFn("accumn-create-order", {
        case_id:           caseId,
        product_type:      "ITR_GST",
        entity_type:       entityType,
        pan:               pan.trim().toUpperCase()   || undefined,
        gstin:             gstin.trim().toUpperCase() || undefined,
        borrower_doib:     doib.trim(),
        borrower_email:    email.trim(),
        borrower_phone:    phone.trim(),
        borrower_language: language,
      }) as { duplicate?: boolean };
      if (res.duplicate) toast.warning("Duplicate order — existing order ID reused");
      else toast.success("Consent order created — share the link with the borrower");
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmit(false);
    }
  };

  const handleRefresh = async (orderId: string) => {
    setRefreshing(orderId);
    try {
      await callEdgeFn("accumn-poll-order", { case_id: caseId, order_id: orderId });
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(null);
    }
  };

  const copyLink = async (link: string) => {
    try { await navigator.clipboard.writeText(link); toast.success("Consent link copied"); }
    catch { toast.error("Copy failed — please copy manually"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-0 border border-border w-fit">
        {(["individual", "corporate"] as const).map(t => (
          <button
            key={t}
            onClick={() => setEntity(t)}
            className={`text-[9px] tracking-widest px-3 py-1 transition-colors ${
              entityType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "individual" ? "INDIVIDUAL / SELF-EMPLOYED" : "CORPORATE ENTITY"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[9px] tracking-widest text-muted-foreground">PAN (for ITR)</label>
          <input
            value={pan}
            onChange={e => setPan(e.target.value.toUpperCase())}
            maxLength={10}
            placeholder="AAAPB1234C"
            className="w-full bg-transparent border-b border-border text-xs font-mono outline-none mt-1 pb-0.5 tracking-widest"
          />
        </div>
        <div>
          <label className="text-[9px] tracking-widest text-muted-foreground">GSTIN (for GST)</label>
          <input
            value={gstin}
            onChange={e => setGstin(e.target.value.toUpperCase())}
            maxLength={15}
            placeholder="27AAAPB1234C1ZV"
            className="w-full bg-transparent border-b border-border text-xs font-mono outline-none mt-1 pb-0.5 tracking-widest"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[9px] tracking-widest text-muted-foreground">CONSENT LANGUAGE</label>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            className="w-full bg-transparent border-b border-border text-xs outline-none mt-1 pb-0.5"
          >
            {LANGUAGES.map(l => <option key={l} value={l} className="bg-background">{l}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[9px] tracking-widest text-muted-foreground">DATE OF BIRTH / INCORP (DD/MM/YYYY)</label>
          <input
            value={doib}
            onChange={e => setDoib(e.target.value)}
            placeholder="22/02/1990"
            maxLength={10}
            className="w-full bg-transparent border-b border-border text-xs font-mono outline-none mt-1 pb-0.5 tracking-widest"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[9px] tracking-widest text-muted-foreground">BORROWER EMAIL</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="borrower@example.com"
            className="w-full bg-transparent border-b border-border text-xs outline-none mt-1 pb-0.5"
          />
        </div>
        <div>
          <label className="text-[9px] tracking-widest text-muted-foreground">BORROWER PHONE (10 DIGITS)</label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="9876543210"
            className="w-full bg-transparent border-b border-border text-xs font-mono outline-none mt-1 pb-0.5 tracking-widest"
          />
        </div>
      </div>

      <button
        onClick={handleCreate}
        disabled={submitting}
        className="flex items-center gap-2 text-[10px] tracking-widest px-3 py-1.5 border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? "CREATING ORDER…" : "↗ CREATE CONSENT ORDER"}
      </button>

      {activeOrders.length > 0 && (
        <div>
          <p className="text-[9px] tracking-widest text-muted-foreground mb-2">ORDERS</p>
          <div className="space-y-2">
            {activeOrders.map(o => (
              <div key={o.id} className="border border-border/50 p-2 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_DOT[o.order_status] ?? "bg-muted"}`} />
                    <span className="text-[9px] font-mono text-muted-foreground">{o.ff_order_id ?? o.id.slice(0, 8)}</span>
                    <span className={`text-[9px] tracking-widest font-bold uppercase ${STATUS_BADGE[o.order_status] ?? ""}`}>
                      {o.order_status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-muted-foreground">
                      {new Date(o.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                    </span>
                    {(o.order_status === "in_progress" || o.order_status === "submitting") && (
                      <button
                        onClick={() => handleRefresh(o.id)}
                        disabled={refreshing === o.id}
                        className="text-[9px] tracking-widest text-primary hover:underline disabled:opacity-40"
                      >
                        {refreshing === o.id ? "…" : "⟳ REFRESH"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Consent link */}
                {o.consent_link && (
                  <div className="pl-4">
                    <p className="text-[9px] tracking-widest text-warning mb-1">SHARE WITH BORROWER</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] font-mono text-foreground/70 break-all">{o.consent_link}</span>
                      <button
                        onClick={() => copyLink(o.consent_link!)}
                        className="text-[9px] tracking-widest text-primary hover:underline shrink-0"
                      >📋 COPY</button>
                      <a
                        href={o.consent_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] tracking-widest text-primary hover:underline shrink-0"
                      >↗ OPEN</a>
                    </div>
                  </div>
                )}

                {o.order_status === "completed" && (
                  <p className="text-[9px] text-success pl-4">✓ ITR & GST data written to Review and GST tabs.</p>
                )}
                {o.order_status === "failed" && o.error_message && (
                  <p className="text-[9px] text-destructive pl-4">{o.error_message}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Insights sub-panel ────────────────────────────────────────────────────────

function InsightsForm({ caseId, orders, onReload }: { caseId: string; orders: AccumnOrder[]; onReload: () => Promise<void> }) {
  const [idType, setIdType]     = useState<"PAN" | "CIN">("PAN");
  const [idValue, setIdValue]   = useState("");
  const [submitting, setSubmit] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const insightsOrders = orders.filter(o => o.product_type === "INSIGHTS");

  const handleFetch = async () => {
    if (!idValue.trim()) { toast.error(`Enter a ${idType}`); return; }
    setSubmit(true);
    try {
      const res = await callEdgeFn("accumn-create-order", {
        case_id:          caseId,
        product_type:     "INSIGHTS",
        identifier_type:  idType,
        identifier_value: idValue.trim().toUpperCase(),
      }) as { duplicate?: boolean };
      if (res.duplicate) toast.warning("Duplicate order — existing order ID reused");
      else toast.success("Insights order submitted");
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmit(false);
    }
  };

  const handleRefresh = async (orderId: string) => {
    setRefreshing(orderId);
    try {
      await callEdgeFn("accumn-poll-order", { case_id: caseId, order_id: orderId });
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[9px] tracking-widest text-muted-foreground">IDENTIFIER TYPE</label>
          <select
            value={idType}
            onChange={e => setIdType(e.target.value as "PAN" | "CIN")}
            className="w-full bg-transparent border-b border-border text-xs outline-none mt-1 pb-0.5"
          >
            <option value="PAN" className="bg-background">PAN</option>
            <option value="CIN" className="bg-background">CIN</option>
          </select>
        </div>
        <div>
          <label className="text-[9px] tracking-widest text-muted-foreground">{idType} VALUE</label>
          <input
            value={idValue}
            onChange={e => setIdValue(e.target.value.toUpperCase())}
            placeholder={idType === "PAN" ? "AAAPB1234C" : "U12345MH2020PTC123456"}
            className="w-full bg-transparent border-b border-border text-xs font-mono outline-none mt-1 pb-0.5 tracking-widest"
          />
        </div>
      </div>

      <button
        onClick={handleFetch}
        disabled={submitting}
        className="flex items-center gap-2 text-[10px] tracking-widest px-3 py-1.5 border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? "FETCHING…" : "↗ FETCH COMPANY INSIGHTS"}
      </button>

      {insightsOrders.length > 0 && (
        <div>
          <p className="text-[9px] tracking-widest text-muted-foreground mb-2">ORDERS</p>
          <div className="space-y-2">
            {insightsOrders.map(o => (
              <div key={o.id} className="border border-border/50 p-2 space-y-1">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_DOT[o.order_status] ?? "bg-muted"}`} />
                    <span className="text-[9px] font-mono text-muted-foreground">{o.ff_order_id ?? o.id.slice(0, 8)}</span>
                    <span className="text-[9px] text-muted-foreground">{o.identifier}</span>
                    <span className={`text-[9px] tracking-widest font-bold uppercase ${STATUS_BADGE[o.order_status] ?? ""}`}>
                      {o.order_status.replace("_", " ")}
                    </span>
                  </div>
                  {(o.order_status === "in_progress" || o.order_status === "submitting") && (
                    <button
                      onClick={() => handleRefresh(o.id)}
                      disabled={refreshing === o.id}
                      className="text-[9px] tracking-widest text-primary hover:underline disabled:opacity-40"
                    >
                      {refreshing === o.id ? "…" : "⟳ REFRESH"}
                    </button>
                  )}
                </div>
                {o.order_status === "completed" && (
                  <p className="text-[9px] text-success pl-4">✓ Financial data written to Review tab.</p>
                )}
                {o.order_status === "failed" && o.error_message && (
                  <p className="text-[9px] text-destructive pl-4">{o.error_message}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function AccumnApiPanel({ caseId, casePan, caseGstin, orders, onReload }: Props) {
  const [subTab, setSubTab] = useState<"itr_gst" | "insights">("itr_gst");

  const hasActive = orders.some(o =>
    o.order_status === "in_progress" || o.order_status === "submitting"
  );

  return (
    <Panel
      title="ACCUMN API — ITR / GST / INSIGHTS"
      ticker="CONSENT-BASED · DIRECT DATA"
      status={hasActive ? "live" : "idle"}
      className="mb-4"
    >
      <div className="p-4 space-y-4">
        {/* Sub-tab switcher */}
        <div className="flex gap-0 border border-border">
          {(["itr_gst", "insights"] as const).map(t => (
            <button
              key={t}
              onClick={() => setSubTab(t)}
              className={`flex-1 text-[9px] tracking-widest py-1.5 transition-colors ${
                subTab === t
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "itr_gst" ? "ITR + GST" : "INSIGHTS"}
            </button>
          ))}
        </div>

        {subTab === "itr_gst" ? (
          <ItrGstForm
            caseId={caseId}
            casePan={casePan}
            caseGstin={caseGstin}
            orders={orders}
            onReload={onReload}
          />
        ) : (
          <InsightsForm
            caseId={caseId}
            orders={orders}
            onReload={onReload}
          />
        )}
      </div>
    </Panel>
  );
}
