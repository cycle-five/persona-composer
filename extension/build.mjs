// Bundle the MV3 extension with esbuild and assemble the loadable dist/ dir.
//
//   node extension/build.mjs            # one-shot build
//   node extension/build.mjs --watch    # rebuild on change
//
// Output: extension/dist/ — point chrome://extensions "Load unpacked" at it.
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(here, "dist");
const watch = process.argv.includes("--watch");

// Each entry is bundled to a single IIFE file. Content scripts and the MV3
// service worker both want self-contained classic scripts (no ESM imports at
// runtime), so iife is the safe common format.
const entryPoints = {
  content: path.join(here, "src/content.ts"),
  background: path.join(here, "src/background.ts"),
  popup: path.join(here, "src/popup.ts"),
};

const buildOptions = {
  entryPoints,
  outdir,
  bundle: true,
  format: "iife",
  target: ["chrome111"],
  sourcemap: "inline",
  logLevel: "info",
};

// Static assets copied verbatim alongside the bundles.
const statics = ["manifest.json", "src/popup.html", "src/popup.css"];

async function copyStatics() {
  await Promise.all(
    statics.map((rel) =>
      cp(path.join(here, rel), path.join(outdir, path.basename(rel))),
    ),
  );
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

// The selector smoke test is a standalone console-pasteable script (not loaded
// by the extension). Built without a sourcemap so the paste stays clean.
async function buildSmoke() {
  await esbuild.build({
    entryPoints: { smoke: path.join(here, "src/smoke.ts") },
    outdir,
    bundle: true,
    format: "iife",
    target: ["chrome111"],
    sourcemap: false,
    logLevel: "info",
  });
}

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  await buildSmoke();
  await copyStatics();
  console.log("[persona-composer/ext] watching… (smoke + statics built once)");
} else {
  await esbuild.build(buildOptions);
  await buildSmoke();
  await copyStatics();
  console.log(`[persona-composer/ext] built → ${path.relative(process.cwd(), outdir)}`);
}
