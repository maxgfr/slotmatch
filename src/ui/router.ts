import { useSyncExternalStore } from "react";

/** Hash routes (`#/people/42?x=1`) so GitHub Pages never sees an unknown path. */
export interface Route {
  path: string[];
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, "");
  const q = raw.indexOf("?");
  const pathPart = q >= 0 ? raw.slice(0, q) : raw;
  const query = q >= 0 ? raw.slice(q + 1) : "";
  return {
    path: pathPart.split("/").filter(Boolean).map(decodeURIComponent),
    params: new URLSearchParams(query),
  };
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseHash(hash);
}

export function href(to: string): string {
  return `#${to.startsWith("/") ? to : `/${to}`}`;
}

export function navigate(to: string): void {
  window.location.hash = href(to);
}

/** The app URL without hash, used to build share links. */
export function appBaseUrl(): string {
  return window.location.href.replace(/#.*$/, "");
}
