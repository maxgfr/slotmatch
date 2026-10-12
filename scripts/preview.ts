/**
 * Serve dist/ under /slotmatch/, the way GitHub Pages serves a project site.
 *
 *   bun scripts/preview.ts           serve until stopped
 *   bun scripts/preview.ts --check   start, check index and every referenced asset answer 200, stop
 */
import { join, normalize } from "node:path";

const BASE = "/slotmatch/";
const DIST = join(import.meta.dir, "..", "dist");
const check = process.argv.includes("--check");

const server = Bun.serve({
  port: check ? 0 : Number(process.env.PORT ?? 4173),
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/" || pathname === BASE.slice(0, -1)) return Response.redirect(BASE, 302);
    if (!pathname.startsWith(BASE)) return new Response("Not found", { status: 404 });
    const rel = normalize(decodeURIComponent(pathname.slice(BASE.length)) || "index.html");
    if (rel.startsWith("..")) return new Response("Forbidden", { status: 403 });
    const file = Bun.file(join(DIST, rel));
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file);
  },
});

const root = new URL(BASE, server.url).href;

if (!check) {
  console.log(`slotmatch preview: ${root}`);
} else {
  const failures: string[] = [];
  const get = async (url: string) => {
    const res = await fetch(url);
    if (res.status !== 200) failures.push(`${res.status} ${url}`);
    return res;
  };
  const html = await (await get(root)).text();
  const assets = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]!).filter((u) => !/^[a-z]+:/i.test(u));
  if (assets.length === 0) failures.push("index.html references no assets");
  for (const a of assets) {
    if (a.startsWith("/")) failures.push(`absolute asset path breaks under ${BASE}: ${a}`);
    await get(new URL(a, root).href);
  }
  server.stop(true);
  if (failures.length) {
    console.error(`preview check failed:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`preview check ok: index + ${assets.length} assets under ${BASE}`);
}
