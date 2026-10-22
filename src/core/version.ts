/** Identity of a production build, baked in by scripts/build.ts and published as version.json. */
export interface BuildInfo {
  version: string;
  /** Full git commit hash. */
  commit: string;
  /** ISO timestamp. */
  builtAt: string;
}

export function parseBuildInfo(v: unknown): BuildInfo | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.version !== "string" || typeof o.commit !== "string" || typeof o.builtAt !== "string") return null;
  if (!/^[0-9a-f]{7,40}$|^unknown$/.test(o.commit) || Number.isNaN(Date.parse(o.builtAt))) return null;
  return { version: o.version, commit: o.commit, builtAt: o.builtAt };
}

export type UpdateStatus =
  /** Running from the dev server: nothing to compare. */
  | { state: "dev" }
  | { state: "current"; online: BuildInfo }
  | { state: "available"; online: BuildInfo }
  | { state: "unknown"; reason: string };

/**
 * A different commit online means an update, unless the online build is older
 * (a stale cache or a rollback in progress): then this copy is kept.
 */
export function compareBuilds(running: BuildInfo | null, online: BuildInfo): UpdateStatus {
  if (!running) return { state: "dev" };
  if (online.commit === running.commit) return { state: "current", online };
  if (Date.parse(online.builtAt) < Date.parse(running.builtAt)) return { state: "current", online };
  return { state: "available", online };
}
