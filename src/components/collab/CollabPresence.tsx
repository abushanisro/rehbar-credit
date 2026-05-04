import { useOthers, useSelf } from "@/liveblocks.config";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}

// ── Avatar stack ──────────────────────────────────────────────────────────────
export function CollabAvatarStack() {
  const others = useOthers();
  const self   = useSelf();

  const all = [
    ...(self ? [{ id: "self", name: self.presence?.name ?? "You", color: self.presence?.color ?? "#E8721C", isSelf: true }] : []),
    ...others.map(o => ({ id: o.connectionId, name: o.presence?.name ?? "Analyst", color: o.presence?.color ?? "#F5A428", isSelf: false })),
  ];

  if (all.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-2">
        {all.slice(0, 5).map(u => (
          <div
            key={u.id}
            title={`${u.name}${u.isSelf ? " (you)" : ""}`}
            className="w-6 h-6 flex items-center justify-center text-[9px] font-bold border-2"
            style={{ backgroundColor: u.color, borderColor: "#0B1028", color: "#fff" }}
          >
            {initials(u.name)}
          </div>
        ))}
        {all.length > 5 && (
          <div className="w-6 h-6 flex items-center justify-center text-[9px] font-bold border-2 bg-surface text-muted-foreground" style={{ borderColor: "#0B1028" }}>
            +{all.length - 5}
          </div>
        )}
      </div>
      {others.length > 0 && (
        <span className="text-[9px] text-success tracking-widest ticker-blink">● {others.length} ONLINE</span>
      )}
    </div>
  );
}

// ── Editing indicator next to a field ─────────────────────────────────────────
export function EditingIndicator({ field }: { field: string }) {
  const editors = useOthers().filter(o => o.presence?.editingField === field);
  if (editors.length === 0) return null;
  const name  = editors[0].presence?.name ?? "Someone";
  const color = editors[0].presence?.color ?? "#E8721C";
  return (
    <span className="text-[9px] tracking-widest ml-1 font-bold animate-pulse" style={{ color }}>
      ✎ {name}
    </span>
  );
}

// ── Tab presence dots ─────────────────────────────────────────────────────────
export function TabPresenceDots({ tabKey }: { tabKey: string }) {
  const viewers = useOthers().filter(o => o.presence?.activeTab === tabKey);
  if (viewers.length === 0) return null;
  return (
    <span className="inline-flex gap-0.5 ml-1">
      {viewers.slice(0, 3).map(o => (
        <span
          key={o.connectionId}
          title={o.presence?.name ?? "Analyst"}
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: o.presence?.color ?? "#E8721C" }}
        />
      ))}
    </span>
  );
}

// ── Live cursors overlay ──────────────────────────────────────────────────────
export function LiveCursors() {
  const others = useOthers();

  return (
    <>
      {others.map(o => {
        const cursor = o.presence?.cursor;
        const name   = o.presence?.name ?? "Analyst";
        const color  = o.presence?.color ?? "#E8721C";
        if (!cursor) return null;
        return (
          <div
            key={o.connectionId}
            className="fixed pointer-events-none z-[9999] transition-all duration-75"
            style={{ left: cursor.x, top: cursor.y }}
          >
            {/* Cursor SVG */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill={color} className="drop-shadow-md">
              <path d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z" />
            </svg>
            {/* Name tag */}
            <div
              className="absolute top-4 left-3 text-[9px] font-bold tracking-widest px-1.5 py-0.5 whitespace-nowrap"
              style={{ backgroundColor: color, color: "#fff" }}
            >
              {name}
            </div>
          </div>
        );
      })}
    </>
  );
}

