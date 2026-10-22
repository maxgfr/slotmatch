import { useEffect, useSyncExternalStore } from "react";
import { compareBuilds, parseBuildInfo, type BuildInfo, type UpdateStatus } from "../core/version";

declare const __BUILD__: BuildInfo | undefined;

/** This copy's build, or null on the dev server. */
export const BUILD: BuildInfo | null = typeof __BUILD__ === "undefined" ? null : __BUILD__;

export const REPOSITORY = "https://github.com/maxgfr/slotmatch";

/** A tab left open checks again when it comes back after this long. */
const RECHECK_MS = 15 * 60_000;

/** version.json next to the page, bypassing every cache. */
async function fetchStatus(): Promise<UpdateStatus> {
  if (!BUILD) return { state: "dev" };
  try {
    const res = await fetch(new URL("version.json", document.baseURI), { cache: "no-store" });
    if (!res.ok) return { state: "unknown", reason: `the site answered ${res.status}.` };
    const online = parseBuildInfo(await res.json());
    return online ? compareBuilds(BUILD, online) : { state: "unknown", reason: "the online version file is not readable." };
  } catch {
    return { state: "unknown", reason: navigator.onLine ? "the site could not be reached." : "you are offline." };
  }
}

// One status for the whole page, shared by the banner and Settings.
let status: UpdateStatus | null = null;
let checkedAt = 0;
let run = 0;
const listeners = new Set<() => void>();

export function checkForUpdate(): void {
  const id = ++run;
  checkedAt = Date.now();
  status = null;
  listeners.forEach((l) => l());
  void fetchStatus().then((s) => {
    if (id !== run) return;
    status = s;
    listeners.forEach((l) => l());
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpdateStatus(): { status: UpdateStatus | null; recheck: () => void } {
  useEffect(() => {
    if (!checkedAt) checkForUpdate();
    const onVisible = () => document.visibilityState === "visible" && Date.now() - checkedAt > RECHECK_MS && checkForUpdate();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return { status: useSyncExternalStore(subscribe, () => status), recheck: checkForUpdate };
}

/** Refresh the cached page, then reload into the new version. Local data is untouched. */
export async function applyUpdate(): Promise<void> {
  try {
    await fetch(new URL("./", document.baseURI), { cache: "reload" });
  } catch {
    // Offline: the reload below still tries the network.
  }
  window.location.reload();
}
