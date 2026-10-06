// Verificación completa antes de entregar cualquier cambio: `npm run check`.
// Corre tipos, lint, todas las pruebas de JavaScript y, si hay PHP, las de PHP.
// Termina con código 1 si algo falla. Ver AGENTS.md.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const phpCandidates = [process.env.LARTISAN_PHP, "php", "C:/lartisan-dev/php/php.exe"].filter(Boolean);
const php = phpCandidates.find((candidate) => spawnSync(candidate, ["-v"], { stdio: "ignore", shell: false }).status === 0);
const env = { ...process.env, LARTISAN_CONFIG: join(root, "dev", "config.dev.php") };
const node = process.execPath;
const nodeTest = (...files) => [node, ["--experimental-strip-types", "--test", ...files]];

const steps = [
  ["Tipos (TypeScript)", [npx, ["tsc", "--noEmit"]]],
  ["Lint (sin errores)", [npx, ["eslint", "app", "db", "--max-warnings=1"]]],
  ["Anti-regresión", nodeTest("tests/regression-guards.test.mjs")],
  ["Seguridad y confiabilidad", nodeTest("tests/security.test.mjs", "tests/reliability-history.test.mjs", "tests/operational-outbox.test.mjs")],
  ["Usuarios, MRP y estructura", nodeTest("tests/user-management.test.mjs", "tests/mrp.test.mjs", "tests/module-structure.test.mjs", "tests/app-icons.test.mjs", "tests/report-navigation.test.mjs")],
  ["Catálogo", nodeTest("tests/catalog.test.mjs", "tests/catalog-runtime.test.mjs")],
  ["Ayuda y reportes", nodeTest("tests/assistant-help.test.mjs", "tests/report-guide.test.mjs")],
];
if (php) {
  for (const file of ["donweb-api/index.php", "donweb-api/bootstrap.php", "donweb-api/arca_fiscal_queue.php", "donweb-api/arca_wsfe.php", "donweb-api/mrp_sync.php", "donweb-api/pnl_sync.php", "donweb-api/assistant.php", "donweb-api/backup.php", "donweb-api/monitor.php"])
    steps.push([`Sintaxis PHP ${file.split("/")[1]}`, [php, ["-l", file]]]);
  for (const file of ["tests/operations-retention.php", "tests/sale-validation.php", "tests/timezone.php"])
    steps.push([`PHP ${file.split("/")[1]}`, [php, [file]]]);
}

const results = [];
for (const [label, [command, args]] of steps) {
  const started = Date.now();
  const run = spawnSync(command, args, { cwd: root, env, encoding: "utf8", shell: process.platform === "win32" && command === npx });
  const ok = run.status === 0;
  results.push([label, ok, Math.round((Date.now() - started) / 100) / 10]);
  console.log(`${ok ? "✓" : "✗"} ${label} (${results.at(-1)[2]} s)`);
  if (!ok) console.log(`${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split("\n").slice(-25).map((line) => `    ${line}`).join("\n"));
}
if (!php) console.log("! PHP no está disponible: no se corrieron las pruebas del servidor. Definí LARTISAN_PHP o instalá PHP 8.3.");
const failed = results.filter(([, ok]) => !ok);
console.log(failed.length ? `\n✗ ${failed.length} verificación(es) fallaron. No entregues el cambio: ver AGENTS.md.` : `\n✓ Todo en orden (${results.length} verificaciones).`);
process.exit(failed.length ? 1 : 0);
