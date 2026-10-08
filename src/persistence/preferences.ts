import { browserStore } from "./browserStore";
import type { Store } from "../safety";
import { EXPORT_KEY } from "../safety";
import {
  EXPORT_STATUS_KEY,
  REMINDER_KEY,
  parseExportStatus,
  type ExportStatus,
} from "../daily";
export class LocalPreferences {
  constructor(private store: Store = browserStore) {}
  theme() {
    return this.store.getItem("dylan-theme") ?? "light";
  }
  saveTheme(value: string) {
    this.store.setItem("dylan-theme", value);
  }
  reminder() {
    const value = Number(this.store.getItem(REMINDER_KEY) ?? 0);
    return Number.isFinite(value) ? value : 0;
  }
  dismiss(until: number) {
    this.store.setItem(REMINDER_KEY, String(until));
  }
  exportInfo() {
    return {
      lastExport: this.store.getItem(EXPORT_KEY),
      status: parseExportStatus(this.store.getItem(EXPORT_STATUS_KEY)),
    };
  }
  recordExport(status: ExportStatus) {
    this.store.setItem(EXPORT_KEY, status.requestedAt);
    this.store.setItem(EXPORT_STATUS_KEY, JSON.stringify(status));
  }
  confirmExport(status: ExportStatus) {
    this.store.setItem(EXPORT_STATUS_KEY, JSON.stringify(status));
  }
  subscribeExports(listener: (status: ExportStatus | null) => void) {
    if (typeof window === "undefined") return () => {};
    const changed = (e: StorageEvent) => {
      if (e.key === EXPORT_STATUS_KEY || e.key === null)
        listener(e.key === null ? null : parseExportStatus(e.newValue));
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }
}
export const preferences = new LocalPreferences();
