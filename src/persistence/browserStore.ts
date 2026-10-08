import type { Store } from "../safety";
/** Lazy access lets read/write failures be reported, rather than crash construction. */
export const browserStore: Store = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};
