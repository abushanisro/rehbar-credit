import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// ── Types ──────────────────────────────────────────────────────────────────────

interface DbError {
  id: string;
  case_id: string;
  section_id: string;
  error_type: string;
  severity: "hard" | "warn";
  title: string;
  detail: string;
  suggested_fix: string | null;
  analyst_verdict: "confirmed" | "dismissed" | null;
  analyst_note: string | null;
  supermemory_id: string | null;
  created_at: string;
}

interface SmMemory {
  id?: string;
  content: string;
  metadata?: Record<string, string>;
  containerTags?: string[];
}

interface ListResult {
  db_errors:   DbError[];
  sm_memories: SmMemory[];
  stats: { confirmed_errors: number; sm_count: number };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const ERROR_TYPE_LABEL: Record<string, string> = {
  hallucination:          "Hallucination",
  unit_error:             "Unit Error",
  cross_section_mismatch: "Cross-Section Mismatch",
  missing_data:           "Missing Data",
  illogical_narrative:    "Illogical Narrative",
  template_gap:           "Template Gap",
};

const SECTION_LABEL: Record<string, string> = {
  executive_summary:      "I — Exec Summary",
  client_promoter:        "II — Client Profile",
  investment_structure:   "III — Investment",
  rehbar_funding_history: "IV — Rehbar History",
  historical_financial:   "V — Financials",
  projections:            "VI — Projections",
  key_ratios:             "VII — Key Ratios",
  cash_flow:              "VIII — Cash Flow",
  due_diligence:          "IX — Due Diligence",
  risk_assessment:        "X — Risk",
  visit_reference:        "XI — Visit",
  exec_recommendation:    "XII — Recommendation",
  product_specifics:      "XIII — Product",
  triangulation_analysis: "XIV — Triangulation",
  conditions_precedent:   "XV — CPs",
  swot_analysis:          "XVI — SWOT",
};

function pageTag(pathname: string): string {
  if (pathname.startsWith("/case/"))    return "Case Detail";
  if (pathname.startsWith("/companies/")) return "Company";
  if (pathname === "/companies")        return "Companies";
  if (pathname === "/users")            return "Team";
  if (pathname === "/observability")    return "System";
  if (pathname === "/new")              return "New Case";
  if (pathname === "/ic")               return "IC Portal";
  return "Pipeline";
}

async function callRag<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rag-search`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session?.access_token ?? ""}`,
        "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ action, ...extra }),
    },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "RAG error");
  return json as T;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center px-3 py-1.5 rounded border" style={{ borderColor: color + "33", background: color + "0d" }}>
      <span className="text-base font-bold tabular-nums" style={{ color }}>{value}</span>
      <span className="text-[9px] text-muted-foreground tracking-wider uppercase mt-0.5">{label}</span>
    </div>
  );
}

function ErrorCard({ error, onDelete }: { error: DbError; onDelete?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isHard = error.severity === "hard";

  return (
    <div
      className="border rounded-md mb-2 overflow-hidden"
      style={{ borderColor: isHard ? "#EF444433" : "#F59E0B33", background: isHard ? "#FFF5F5" : "#FFFBEB" }}
    >
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left px-3 py-2.5 flex items-start gap-2"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span
              className="text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
              style={{ background: isHard ? "#FEE2E2" : "#FEF3C7", color: isHard ? "#991B1B" : "#78350F" }}
            >
              {isHard ? "CRITICAL" : "FLAG"}
            </span>
            <span className="text-[8px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">
              {SECTION_LABEL[error.section_id] ?? error.section_id}
            </span>
            <span className="text-[8px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
              {ERROR_TYPE_LABEL[error.error_type] ?? error.error_type}
            </span>
          </div>
          <p className="text-xs font-semibold text-gray-900 leading-tight">{error.title}</p>
        </div>
        <span className="text-gray-400 text-xs shrink-0 mt-0.5">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-100">
          <p className="text-[11px] text-gray-700 mt-2 leading-relaxed">{error.detail}</p>
          {error.suggested_fix && (
            <div className="mt-2 bg-emerald-50 text-emerald-800 text-[10px] rounded px-2 py-1.5">
              Fix: {error.suggested_fix}
            </div>
          )}
          {error.analyst_note && (
            <div className="mt-1.5 text-[10px] text-gray-500 italic">Note: {error.analyst_note}</div>
          )}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[9px] text-gray-400">{error.created_at.slice(0, 10)}</span>
            {onDelete && error.supermemory_id && (
              <button
                onClick={() => onDelete(error.supermemory_id!)}
                className="text-[9px] text-red-500 hover:text-red-700 hover:underline"
              >
                Remove from memory
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MemoryCard({ memory, onDelete }: { memory: SmMemory; onDelete?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const lines = memory.content.split("\n").filter(Boolean);
  const headline = lines[0] ?? "";
  const body = lines.slice(1).join("\n");

  return (
    <div className="border border-gray-200 rounded-md mb-2 bg-white overflow-hidden">
      <button onClick={() => setExpanded(e => !e)} className="w-full text-left px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-[#E8721C] uppercase tracking-wider truncate">{headline}</p>
            {!expanded && body && (
              <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{body.slice(0, 80)}</p>
            )}
          </div>
          <span className="text-gray-400 text-xs shrink-0">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-100">
          <pre className="text-[10px] text-gray-700 mt-2 whitespace-pre-wrap font-sans leading-relaxed">{body}</pre>
          <div className="mt-2 flex items-center justify-between">
            {memory.metadata?.created_at && (
              <span className="text-[9px] text-gray-400">{memory.metadata.created_at.slice(0, 10)}</span>
            )}
            {onDelete && memory.id && (
              <button
                onClick={() => onDelete(memory.id!)}
                className="text-[9px] text-red-500 hover:text-red-700 hover:underline"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

interface RAGPanelProps {
  open: boolean;
  onClose: () => void;
}

export function RAGPanel({ open, onClose }: RAGPanelProps) {
  const location = useLocation();
  const [tab, setTab]           = useState<"browse" | "search" | "add">("browse");
  const [listData, setListData] = useState<ListResult | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SmMemory[]>([]);
  const [searching, setSearching] = useState(false);
  const [addContent, setAddContent] = useState("");
  const [addTags, setAddTags]       = useState<string[]>(["rehbar-ic-errors"]);
  const [adding, setAdding]         = useState(false);
  const [addSuccess, setAddSuccess] = useState(false);
  const searchRef = useRef<NodeJS.Timeout | null>(null);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const data = await callRag<ListResult>("list");
      setListData(data);
    } catch { /* silent */ }
    finally { setListLoading(false); }
  }, []);

  useEffect(() => {
    if (open) loadList();
  }, [open, loadList]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await callRag<{ results: SmMemory[] }>("search", { query: q, limit: 10 });
      setSearchResults(res.results ?? []);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }, []);

  const handleSearchChange = (v: string) => {
    setSearchQuery(v);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => doSearch(v), 500);
  };

  const handleAdd = async () => {
    if (!addContent.trim()) return;
    setAdding(true);
    try {
      await callRag("add", { content: addContent.trim(), tags: addTags, metadata: { page: pageTag(location.pathname) } });
      setAddContent("");
      setAddSuccess(true);
      setTimeout(() => setAddSuccess(false), 3000);
      loadList();
    } catch { /* silent */ }
    finally { setAdding(false); }
  };

  const handleDeleteMemory = async (memId: string) => {
    await callRag("delete", { memory_id: memId }).catch(() => {});
    loadList();
  };

  if (!open) return null;

  const page = pageTag(location.pathname);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col bg-white border-l border-border shadow-2xl"
        style={{ width: 420 }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-[#E8721C] text-lg leading-none">◈</span>
            <div>
              <p className="text-sm font-semibold text-foreground leading-none">Knowledge Base</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                RAG Memory · Supermemory
                <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-[#E8721C]/10 text-[#E8721C] font-medium">
                  {page}
                </span>
              </p>
            </div>
          </div>

          {/* Stats */}
          {listData && (
            <div className="flex items-center gap-1.5">
              <StatBadge label="Confirmed" value={listData.stats.confirmed_errors} color="#E8721C" />
              <StatBadge label="Memories"  value={listData.stats.sm_count}         color="#6366F1" />
            </div>
          )}

          <button
            onClick={onClose}
            className="ml-1 text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded hover:bg-surface-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border bg-card shrink-0">
          {(["browse", "search", "add"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-medium capitalize tracking-wide transition-colors ${
                tab === t
                  ? "border-b-2 border-[#E8721C] text-[#E8721C]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "browse" ? "Browse Errors" : t === "search" ? "Search" : "+ Add Memory"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* ── BROWSE TAB ─────────────────────────────────────────────────── */}
          {tab === "browse" && (
            <>
              {listLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-[#E8721C] border-t-transparent" />
                </div>
              )}
              {!listLoading && listData && (
                <>
                  {listData.db_errors.length === 0 && listData.sm_memories.length === 0 && (
                    <div className="text-center py-12">
                      <div className="text-3xl mb-3">◈</div>
                      <p className="text-sm font-medium text-foreground">No confirmed errors yet</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Generate an IC note, then confirm detected errors — they'll appear here and be used to improve future generations.
                      </p>
                    </div>
                  )}

                  {listData.db_errors.length > 0 && (
                    <>
                      <p className="text-[9px] font-bold tracking-widest text-muted-foreground uppercase mb-2">
                        Confirmed IC Errors ({listData.db_errors.length})
                      </p>
                      {listData.db_errors.map(e => (
                        <ErrorCard
                          key={e.id}
                          error={e}
                          onDelete={e.supermemory_id ? handleDeleteMemory : undefined}
                        />
                      ))}
                    </>
                  )}

                  {listData.sm_memories.length > 0 && (
                    <>
                      <p className="text-[9px] font-bold tracking-widest text-muted-foreground uppercase mb-2 mt-4">
                        All Memories ({listData.sm_memories.length})
                      </p>
                      {listData.sm_memories.map((m, i) => (
                        <MemoryCard
                          key={m.id ?? i}
                          memory={m}
                          onDelete={m.id ? handleDeleteMemory : undefined}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* ── SEARCH TAB ─────────────────────────────────────────────────── */}
          {tab === "search" && (
            <>
              <div className="relative mb-4">
                <input
                  type="text"
                  placeholder="Search knowledge base… e.g. 'unit error textile'"
                  value={searchQuery}
                  onChange={e => handleSearchChange(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-[#E8721C] bg-white"
                  autoFocus
                />
                <span className="absolute left-2.5 top-2.5 text-muted-foreground text-sm">
                  {searching
                    ? <span className="animate-spin inline-block">◌</span>
                    : "⌕"}
                </span>
              </div>

              {searchQuery && !searching && searchResults.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No memories found for "{searchQuery}"
                </div>
              )}

              {searchResults.map((m, i) => (
                <MemoryCard
                  key={m.id ?? i}
                  memory={m}
                  onDelete={m.id ? handleDeleteMemory : undefined}
                />
              ))}

              {!searchQuery && (
                <div className="text-center py-8">
                  <p className="text-xs text-muted-foreground">
                    Type to search across all stored error patterns and analyst notes
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
                    {["unit error", "hallucination", "executive summary", "key ratios", "DSCR"].map(hint => (
                      <button
                        key={hint}
                        onClick={() => handleSearchChange(hint)}
                        className="text-[10px] px-2 py-1 bg-surface-2 hover:bg-primary/10 rounded-full text-muted-foreground hover:text-primary transition-colors"
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── ADD MEMORY TAB ──────────────────────────────────────────────── */}
          {tab === "add" && (
            <>
              <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-md">
                <p className="text-[10px] text-amber-800">
                  Add a manual analyst note or rule to the knowledge base. This will be retrieved automatically during future IC note generation.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                    Memory Content
                  </label>
                  <textarea
                    value={addContent}
                    onChange={e => setAddContent(e.target.value)}
                    placeholder={`Example:\nRULE: For MSME textile clients, always verify that GST turnover and P&L revenue are within 30% of each other before generating executive summary. Discrepancies above 50% indicate likely misstatement or routing risk.`}
                    rows={7}
                    className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#E8721C] resize-none font-sans text-foreground"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                    Tags
                  </label>
                  {/* Predefined tag pills */}
                  {[
                    { group: "Required",    tags: ["rehbar-ic-errors"] },
                    { group: "Section",     tags: ["executive_summary", "key_ratios", "historical_financial", "projections", "risk_assessment"] },
                    { group: "Error type",  tags: ["hallucination", "unit_error", "cross_section_mismatch", "missing_data", "illogical_narrative", "template_gap"] },
                  ].map(({ group, tags }) => (
                    <div key={group} className="mb-2">
                      <p className="text-[8px] text-muted-foreground uppercase tracking-widest mb-1">{group}</p>
                      <div className="flex flex-wrap gap-1">
                        {tags.map(tag => {
                          const selected = addTags.includes(tag);
                          const locked   = tag === "rehbar-ic-errors";
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => {
                                if (locked) return;
                                setAddTags(prev =>
                                  prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                                );
                              }}
                              className="text-[9px] px-2 py-0.5 rounded-full border font-medium transition-colors"
                              style={
                                selected
                                  ? { background: "#E8721C", color: "#fff", borderColor: "#E8721C", cursor: locked ? "default" : "pointer" }
                                  : { background: "transparent", color: "#6B7280", borderColor: "#E5E7EB", cursor: "pointer" }
                              }
                              title={locked ? "Required" : selected ? "Click to remove" : "Click to add"}
                            >
                              {tag}
                              {locked && <span className="ml-1 opacity-60">●</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {/* Selected tags summary */}
                  <p className="text-[9px] text-muted-foreground mt-1">
                    Selected: <span className="font-mono">{addTags.join(", ") || "—"}</span>
                  </p>
                </div>

                {addSuccess && (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-3 py-2 rounded-md">
                    Memory added successfully — it will be retrieved in future IC note generations.
                  </div>
                )}

                <button
                  onClick={handleAdd}
                  disabled={!addContent.trim() || adding}
                  className="w-full py-2.5 text-sm font-semibold rounded-md transition-colors disabled:opacity-40"
                  style={{ background: "#E8721C", color: "#fff" }}
                >
                  {adding ? "Adding…" : "Add to Knowledge Base"}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2.5 bg-card flex items-center justify-between shrink-0">
          <span className="text-[9px] text-muted-foreground">Powered by Supermemory · RAG ◈</span>
          <button
            onClick={loadList}
            className="text-[9px] text-primary hover:underline font-medium"
          >
            Refresh
          </button>
        </div>
      </div>
    </>
  );
}
