import { useState, useRef, useEffect } from "react";
import { useLocation, useMatch } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Message { role: "user" | "assistant"; content: string }

// Starters vary based on where the user is
const STARTERS_CASE = [
  "What are the key risks in this deal?",
  "Summarise the DSCR trend across years",
  "Are there any bounce concerns in bank data?",
  "How does GST turnover compare to P&L revenue?",
  "What conditions precedent would you suggest?",
];

const STARTERS_PIPELINE = [
  "How many deals are in each pipeline stage?",
  "What is the total deal value across the pipeline?",
  "Which deals have been in review the longest?",
  "Summarise the portfolio by product type",
  "Are there any overdue or stalled cases?",
];

const STARTERS_COMPANIES = [
  "How many companies are tracked?",
  "Which companies have the most active cases?",
  "Summarise the company portfolio",
];

function usePageContext() {
  const location = useLocation();
  const caseMatch  = useMatch("/case/:id");
  const compMatch  = useMatch("/companies/:id");
  const path = location.pathname;

  if (caseMatch?.params.id) return { caseId: caseMatch.params.id, pageName: "Case Detail", starters: STARTERS_CASE };
  if (compMatch?.params.id) return { caseId: undefined, pageName: "Company Detail", starters: STARTERS_COMPANIES };
  if (path === "/companies")  return { caseId: undefined, pageName: "Companies",       starters: STARTERS_COMPANIES };
  if (path === "/new")        return { caseId: undefined, pageName: "New Case",         starters: STARTERS_PIPELINE };
  return { caseId: undefined, pageName: "Pipeline", starters: STARTERS_PIPELINE };
}

export function AnalystChat() {
  const { caseId, pageName, starters } = usePageContext();
  const location = useLocation();

  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const bottomRef               = useRef<HTMLDivElement>(null);

  // Reset conversation when page changes so stale case data isn't carried forward
  useEffect(() => {
    setMessages([]);
  }, [location.pathname]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const handleToggle = () => setOpen(o => !o);
    window.addEventListener("toggle-analyst-chat", handleToggle);
    return () => window.removeEventListener("toggle-analyst-chat", handleToggle);
  }, []);


  const send = async (text: string) => {
    const userMsg = text.trim();
    if (!userMsg || loading) return;
    setInput("");

    const next: Message[] = [...messages, { role: "user", content: userMsg }];
    setMessages(next);
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyst-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token ?? ""}`,
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            case_id: caseId ?? null,
            page_name: pageName,
            current_path: location.pathname,
            messages: next,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Unknown error");
      setMessages(prev => [...prev, { role: "assistant", content: json.reply }]);
    } catch (e) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `Error: ${e instanceof Error ? e.message : "Failed to reach analyst"}`,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  return (
    <>
      {/* Toggle button — fixed bottom-right on every page */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-[#E8721C] px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-[#d0631a] transition-all hover:scale-105 active:scale-95"
      >
        {open ? (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
            <span>Close</span>
          </>
        ) : (
          <>
            <span className="text-base">◈</span>
            <span>Ask Analyst (F4)</span>
          </>
        )}
      </button>

      {/* Panel */}
      <div className={`fixed bottom-20 right-6 z-50 flex flex-col w-[420px] max-h-[75vh] rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] shadow-2xl overflow-hidden transition-all duration-300 ease-in-out ${open ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10 pointer-events-none"}`}>
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[#2a2a2a] px-4 py-3">

            <span className="text-[#E8721C] text-lg">◈</span>
            <div>
              <p className="text-sm font-semibold text-white">Rehbar Analyst</p>
              <p className="text-[10px] text-[#666]">
                AI · Senior Credit Analyst
                <span className="ml-2 text-[#444]">— {pageName}</span>
              </p>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-[10px] text-[#444] font-mono">claude-sonnet-4-6</span>
              <button 
                onClick={() => setOpen(false)}
                className="text-[#666] hover:text-white transition-colors p-1"
                title="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-[#555] mb-3">
                  {caseId
                    ? "Ask me anything about this case."
                    : `Ask me anything about your ${pageName.toLowerCase()}.`}
                </p>
                {starters.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="block w-full text-left text-xs text-[#888] border border-[#222] rounded px-3 py-1.5 hover:border-[#E8721C] hover:text-[#E8721C] transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                    m.role === "user"
                      ? "bg-[#E8721C] text-white"
                      : "bg-[#1a1a1a] text-[#d0d0d0] border border-[#2a2a2a]"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-[#555]">
                  <span className="animate-pulse">Analysing...</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-[#2a2a2a] p-3 flex gap-2">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask a question… (Enter to send)"
              rows={2}
              className="resize-none text-sm bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-[#444] focus-visible:ring-[#E8721C]"
              disabled={loading}
            />
            <Button
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              size="sm"
              className="self-end bg-[#E8721C] hover:bg-[#d0631a] text-white"
            >
              Send
            </Button>
          </div>
        </div>

    </>
  );
}
