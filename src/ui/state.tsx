import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { load, preserveUnreadable, save, STORAGE_KEY, UNREADABLE_KEY, type AppState } from "../core/store";
import type { Ms } from "../core/model";

/* ---------- store ---------- */

interface Store {
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
  /** False when the last save to localStorage failed. */
  saved: boolean;
  /** Set when stored data could not be read and was copied aside under this key. */
  preservedAs: string | null;
}

const StoreContext = createContext<Store | null>(null);

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const memory = { getItem: () => null, setItem: () => {} };

export function StoreProvider({ children }: { children: ReactNode }) {
  // Copy unreadable data aside before the first save replaces it.
  const [preservedAs] = useState(() => {
    const s = storage();
    return s && preserveUnreadable(s) ? UNREADABLE_KEY : null;
  });
  const [state, setState] = useState<AppState>(() => load(storage() ?? memory, browserTimeZone()));
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    const s = storage();
    setSaved(s ? save(state, s) : false);
  }, [state]);

  // Keep several open tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setState(load(storage() ?? memory, browserTimeZone()));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((fn: (s: AppState) => AppState) => setState(fn), []);
  const value = useMemo(() => ({ state, update, saved, preservedAs }), [state, update, saved, preservedAs]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore outside StoreProvider");
  return store;
}

/** `useState` that survives navigation and reloads within the tab (sessionStorage). */
export function useSessionState<T>(key: string, init: () => T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.sessionStorage.getItem(`slotmatch:${key}`);
      if (raw) return { ...init(), ...(JSON.parse(raw) as T) };
    } catch {
      // Unreadable or blocked storage: start from the defaults.
    }
    return init();
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(`slotmatch:${key}`, JSON.stringify(value));
    } catch {
      // Not persisted across reloads; the in-memory value still works.
    }
  }, [key, value]);
  return [value, setValue];
}

/* ---------- time zones & formatting ---------- */

export const TIME_ZONES: string[] = (() => {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
})();

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(opts);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts });
    formatters.set(key, f);
  }
  return f;
}

/** "14:30" */
export const fmtTime = (ms: Ms, tz: string) => formatter(tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
/** "Mon 19 Oct" */
export const fmtDay = (ms: Ms, tz: string) => formatter(tz, { weekday: "short", day: "numeric", month: "short" }).format(ms);
/** "Mon 19 Oct, 14:30–15:15" */
export const fmtSlot = (start: Ms, end: Ms, tz: string) => `${fmtDay(start, tz)}, ${fmtTime(start, tz)}–${fmtTime(end, tz)}`;
/** "09:30" from minutes since midnight. */
export const fmtMinutes = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** "09:30" → 570 */
export const parseMinutes = (hhmm: string) => {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
/** Short zone name, e.g. "GMT+2" or "CEST". */
export const tzAbbr = (ms: Ms, tz: string) =>
  formatter(tz, { timeZoneName: "short" }).formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? tz;
/** "2026-10-19" in a zone, for <input type=date>. */
export const isoDate = (ms: Ms, tz: string) => formatter(tz, { year: "numeric", month: "2-digit", day: "2-digit" }).format(ms).split("/").reverse().join("-");

export const fmtDuration = (min: number) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60}` : `${min / 60} h`);

/* ---------- browser helpers ---------- */

export function download(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Unique, sorted tags across people. */
export function allTags(people: readonly { tags: string[] }[]): string[] {
  return [...new Set(people.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b));
}

export function TimeZoneSelect({ value, onChange, id }: { value: string; onChange: (tz: string) => void; id?: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {!TIME_ZONES.includes(value) && <option value={value}>{value}</option>}
      {TIME_ZONES.map((tz) => (
        <option key={tz} value={tz}>
          {tz.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}
