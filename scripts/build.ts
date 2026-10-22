/**
 * Production build into dist/. The build identity is baked into the app and
 * published next to it as version.json, so a running copy can tell whether a
 * newer one is online.
 */
import { $ } from "bun";
import { join } from "node:path";
import pkg from "../package.json";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");

const sha = process.env.GITHUB_SHA ?? (await $`git rev-parse HEAD`.cwd(ROOT).quiet().nothrow().text()).trim();
const build = { version: pkg.version, commit: sha || "unknown", builtAt: new Date().toISOString() };

await $`rm -rf ${DIST}`;
const result = await Bun.build({
  entrypoints: [join(ROOT, "index.html")],
  outdir: DIST,
  minify: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __BUILD__: JSON.stringify(build),
  },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
await Bun.write(join(DIST, "version.json"), JSON.stringify(build, null, 2) + "\n");
for (const out of result.outputs) console.log(`  ${out.path.slice(DIST.length + 1)}  ${(out.size / 1024).toFixed(1)} KB`);
console.log(`built ${build.version} (${build.commit.slice(0, 7)}) at ${build.builtAt}`);
