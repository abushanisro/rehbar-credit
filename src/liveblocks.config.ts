import { createClient } from "@liveblocks/client";
import { createRoomContext } from "@liveblocks/react";

const client = createClient({
  publicApiKey: import.meta.env.VITE_LIVEBLOCKS_PUBLIC_KEY,
});

type Presence = {
  name: string;
  email: string;
  color: string;
  activeTab: string;
  editingField: string | null;
  cursor: { x: number; y: number } | null;
};

type Storage = Record<string, never>;
type UserMeta = Record<string, never>;
type RoomEvent = Record<string, never>;

export const {
  RoomProvider,
  useOthers,
  useUpdateMyPresence,
  useSelf,
  useOthersMapped,
} = createRoomContext<Presence, Storage, UserMeta, RoomEvent>(client);
