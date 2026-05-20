import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Panel } from "@/components/terminal/Panel";
import type { Tables } from "@/integrations/supabase/types";
import type { DocRow } from "@/features/case/types";

type AccumnOrder = Tables<"accumn_api_orders">;

interface Props {
  caseId: string;
  docs: DocRow[];
  orders: AccumnOrder[];
  user: { id: string };
  onReload: () => Promise<void>;
}

const STATUS_BADGE: Record<string, string> = {
  pending:     "text-muted-foreground",
  submitting:  "text-warning animate-pulse",
  in_progress: "text-warning animate-pulse",
  completed:   "text-success",
  cancelled:   "text-muted-foreground",
  failed:      "text-destructive",
};
const STATUS_DOT: Record<string, string> = {
  pending: "bg-muted", submitting: "bg-warning", in_progress: "bg-warning",
  completed: "bg-success", cancelled: "bg-muted", failed: "bg-destructive",
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

export function AccumnBsaPanel({ caseId, docs, orders, user, onReload }: Props) {
  const bankDocs = docs.filter(d => d.doc_class === "bank_statement");

  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [poaFrom, setPoaFrom]           = useState("");
  const [poaTo, setPoaTo]               = useState("");
  const [sanctionLimit, setSanction]    = useState("");
  const [submitting, setSubmitting]     = useState(false);
  const [refreshing, setRefreshing]     = useState<string | null>(null);
  const [expandedOrder, setExpanded]    = useState<string | null>(null);

  const toggleDoc = (id: string) => {
    setSelectedDocs(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedDocs.size === 0) { toast.error("Select at least one bank statement"); return; }
    setSubmitting(true);
    try {
      const res = await callEdgeFn("accumn-create-order", {
        case_id:           caseId,
        product_type:      "BSA",
        bank_document_ids: [...selectedDocs],
        poa_from_date:     poaFrom || undefined,
        poa_to_date:       poaTo   || undefined,
        sanction_limit:    sanctionLimit ? parseFloat(sanctionLimit) : undefined,
      }) as { duplicate?: boolean };
      if (res.duplicate) toast.warning("Duplicate order — existing order ID reused");
      else toast.success("BSA order submitted to Accumn");
      setSelectedDocs(new Set());
      await onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
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

  const hasActive = orders.some(o => o.order_status === "in_progress" || o.order_status === "submitting");

  return (
    <Panel
      title="ACCUMN BANK STATEMENT ANALYSIS"
      ticker="BSA · DIRECT API"
      status={hasActive ? "live" : "idle"}
      className="mb-4"
    >
      <div className="p-4 space-y-4">
        {/* Document selector */}
        {bankDocs.length > 0 ? (
          <div>
            <p className="text-[9px] tracking-widest text-muted-foreground mb-2">SELECT DOCUMENTS</p>
            <div className="grid grid-cols-1 gap-1">
              {bankDocs.map(d => (
                <label key={d.id} className="flex items-center gap-2 text-xs cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selectedDocs.has(d.id)}
                    onChange={() => toggleDoc(d.id)}
                    className="accent-primary"
                  />
                  <span className="group-hover:text-primary transition-colors truncate max-w-xs">{d.file_name}</span>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No bank statement documents uploaded yet.</p>
        )}

        {/* Parameters */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[9px] tracking-widest text-muted-foreground">POA FROM</label>
            <input
              type="month"
              value={poaFrom}
              onChange={e => setPoaFrom(e.target.value)}
              className="w-full bg-transparent border-b border-border text-xs tabular-nums outline-none mt-1 pb-0.5"
              placeholder="YYYY-MM"
            />
          </div>
          <div>
            <label className="text-[9px] tracking-widest text-muted-foreground">POA TO</label>
            <input
              type="month"
              value={poaTo}
              onChange={e => setPoaTo(e.target.value)}
              className="w-full bg-transparent border-b border-border text-xs tabular-nums outline-none mt-1 pb-0.5"
              placeholder="YYYY-MM"
            />
          </div>
          <div>
            <label className="text-[9px] tracking-widest text-muted-foreground">SANCTION LIMIT (₹ Lakh)</label>
            <input
              type="number"
              value={sanctionLimit}
              onChange={e => setSanction(e.target.value)}
              className="w-full bg-transparent border-b border-border text-xs tabular-nums outline-none mt-1 pb-0.5"
              placeholder="0"
            />
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting || selectedDocs.size === 0}
          className="flex items-center gap-2 text-[10px] tracking-widest px-3 py-1.5 border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? "SUBMITTING…" : "↑ REQUEST ACCUMN BSA"}
        </button>

        {/* Order list */}
        {orders.length > 0 && (
          <div>
            <p className="text-[9px] tracking-widest text-muted-foreground mb-2">ORDERS</p>
            <div className="space-y-2">
              {orders.map(o => (
                <div key={o.id} className="border border-border/50 p-2 space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_DOT[o.order_status] ?? "bg-muted"}`} />
                      <span className="text-[9px] font-mono text-muted-foreground">{o.ff_order_id ?? o.id.slice(0, 8)}</span>
                      <span className={`text-[9px] tracking-widest font-bold uppercase ${STATUS_BADGE[o.order_status] ?? ""}`}>
                        {o.order_status.replace("_", " ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-muted-foreground">
                        {new Date(o.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
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
                      {o.order_status === "completed" && (
                        <button
                          onClick={() => setExpanded(expandedOrder === o.id ? null : o.id)}
                          className="text-[9px] tracking-widest text-success hover:underline"
                        >
                          {expandedOrder === o.id ? "▲ HIDE" : "▾ VIEW DATA"}
                        </button>
                      )}
                    </div>
                  </div>

                  {o.order_status === "failed" && o.error_message && (
                    <p className="text-[9px] text-destructive pl-4">{o.error_message}</p>
                  )}

                  {expandedOrder === o.id && o.order_status === "completed" && (
                    <div className="mt-2 pl-4 text-[9px] text-muted-foreground space-y-0.5">
                      <p className="text-success">✓ Bank data written to Bank Statement tab.</p>
                      {Array.isArray(o.files_metadata) && (o.files_metadata as { file_name?: string }[]).map((f, i) => (
                        <p key={i}>{f.file_name}</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
