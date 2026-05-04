import { useEffect, useRef } from "react";
import { useUpdateMyPresence } from "@/liveblocks.config";

const USER_COLORS = [
  "#E8721C", "#F5A428", "#22c55e", "#60a5fa",
  "#a78bfa", "#f472b6", "#34d399", "#fb923c",
];

function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}

export function useMyPresence(name: string, email: string, activeTab: string) {
  const update = useUpdateMyPresence();
  const color  = hashColor(email || name);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    update({ name, email, color, activeTab, editingField: null, cursor: null });
  }, [name, email, color, activeTab]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        update({ cursor: { x: e.clientX, y: e.clientY } });
        rafRef.current = null;
      });
    };
    const onLeave = () => update({ cursor: null });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [update]);

  return {
    setEditing: (field: string | null) => update({ editingField: field }),
    color,
  };
}
