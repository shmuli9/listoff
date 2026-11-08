export interface Item {
  id: string; name: string; qty: string; note: string; category: string; done: boolean;
  addedBy: string; addedAt: number; updatedAt: number; deleted?: boolean; pos?: number;
}
export interface ShelfEntry { name: string; category: string; lastAt: number; count: number; fav?: boolean }
export interface LogEntry { id: string; ts: number; user: string; action: string; itemName: string }
export interface ListData { name?: string; items: Item[]; shelf: Record<string, ShelfEntry>; log: LogEntry[] }
export interface ListMeta { id: string; name: string; members: string[] }
export interface Doc extends ListMeta { version: string | null; data: ListData; dirty: boolean; rev: number }
