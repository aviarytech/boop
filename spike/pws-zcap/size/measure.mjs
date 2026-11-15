// THROWAWAY spike code (#286): bundle-size probes. `node size/measure.mjs`
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
const kb = n => (n / 1024).toFixed(0).padStart(5) + " kB";
for (const [entry, platform] of [["server-verify.ts", "browser"], ["server-verify.ts", "node"], ["client-delegate.ts", "browser"], ["client-pws.ts", "browser"], ["agent-invoke.ts", "browser"]]) {
  const result = await build({ entryPoints: [`size/${entry}`], bundle: true, minify: true, format: "esm", platform, write: false, metafile: true, logLevel: "silent",
    ...(platform === "browser" ? { conditions: ["browser", "import"] } : {}) }).catch(error => ({ error }));
  if (result.error) { console.log(`${entry} [${platform}] FAILED: ${String(result.error.message).split("\n").slice(0, 3).join(" | ")}`); continue; }
  const bytes = result.outputFiles[0].contents;
  const byPackage = {};
  for (const [file, info] of Object.entries(Object.values(result.metafile.outputs)[0].inputs)) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(file);
    const name = match ? match[1] : "(spike code)";
    byPackage[name] = (byPackage[name] ?? 0) + info.bytesInOutput;
  }
  const top = Object.entries(byPackage).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([name, n]) => `${name} ${(n / 1024).toFixed(0)}`).join(", ");
  console.log(`${entry.padEnd(20)} [${platform.padEnd(7)}] min ${kb(bytes.length)}  gzip ${kb(gzipSync(bytes).length)}  top(kB): ${top}`);
}
