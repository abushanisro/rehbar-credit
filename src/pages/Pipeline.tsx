import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { TerminalLayout } from "@/components/terminal/TerminalLayout";
import { Panel } from "@/components/terminal/Panel";
import { CASE_STATUS_META, PRODUCTS, type CaseStatus, type ProductType } from "@/features/credit/domain";

interface CaseRow {
  id: string;
  case_code: string;
  client_name: string;
  product_type: ProductType;
  status: CaseStatus;
  deal_amount: number | null;
  created_at: string;
}

const COLUMNS: CaseStatus[] = ["draft", "extracting", "extracted", "analysis", "narrative", "ic_review", "approved"];

export default function Pipeline() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("credit_cases")
        .select("id,case_code,client_name,product_type,status,deal_amount,created_at")
        .order("created_at", { ascending: false });
      setCases((data ?? []) as CaseRow[]);
      setLoading(false);
    })();

    const channel = supabase
      .channel("credit_cases_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_cases" }, () => {
        supabase
          .from("credit_cases")
          .select("id,case_code,client_name,product_type,status,deal_amount,created_at")
          .order("created_at", { ascending: false })
          .then(({ data }) => setCases((data ?? []) as CaseRow[]));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return (
    <TerminalLayout>
      <div className="grid grid-cols-12 gap-3 mb-3">
        <Panel title="ACTIVE CASES" className="col-span-3">
          <div className="text-3xl text-primary glow font-bold">{cases.length}</div>
          <div className="terminal-label mt-1">Total in pipeline</div>
        </Panel>
        <Panel title="IN IC REVIEW" className="col-span-3" status="warn">
          <div className="text-3xl text-warning glow font-bold">
            {cases.filter((c) => c.status === "ic_review").length}
          </div>
          <div className="terminal-label mt-1">Awaiting committee decision</div>
        </Panel>
        <Panel title="APPROVED" className="col-span-3">
          <div className="text-3xl text-success glow font-bold">
            {cases.filter((c) => c.status === "approved").length}
          </div>
          <div className="terminal-label mt-1">Closed deals</div>
        </Panel>
        <Panel title="QUICK ACTION" className="col-span-3">
          <Link
            to="/new"
            className="block w-full text-center bg-primary text-primary-foreground px-3 py-2 text-xs tracking-widest font-bold hover:opacity-90"
          >
            [F2] NEW CREDIT CASE
          </Link>
          <div className="terminal-label mt-2">Initiate appraisal workflow</div>
        </Panel>
      </div>

      <Panel title="PIPELINE BOARD" ticker="REHBAR/CAS" scan>
        {loading ? (
          <div className="text-muted-foreground text-xs">LOADING...</div>
        ) : cases.length === 0 ? (
          <div className="text-muted-foreground text-xs py-8 text-center">
            NO CASES YET — PRESS [F2] TO CREATE YOUR FIRST APPRAISAL
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {COLUMNS.map((col) => {
              const meta = CASE_STATUS_META[col];
              const colCases = cases.filter((c) => c.status === col || (col === "approved" && c.status === "declined"));
              return (
                <div key={col} className="border border-border bg-surface min-h-[300px]">
                  <div className={`px-2 py-1 text-[10px] tracking-widest border-b border-border bg-surface-2 text-${meta.color}`}>
                    {meta.label} ({colCases.length})
                  </div>
                  <div className="p-1 space-y-1">
                    {colCases.map((c) => (
                      <Link
                        key={c.id}
                        to={`/case/${c.id}`}
                        className="block p-2 bg-card border border-border hover:border-primary text-[11px] transition-colors"
                      >
                        <div className="text-primary font-bold truncate">{c.client_name}</div>
                        <div className="text-muted-foreground truncate">{c.case_code}</div>
                        <div className="text-accent text-[10px] mt-1">{PRODUCTS[c.product_type].short}</div>
                        {c.deal_amount && (
                          <div className="text-success text-[10px]">
                            ₹{Number(c.deal_amount).toLocaleString("en-IN")}
                          </div>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </TerminalLayout>
  );
}
