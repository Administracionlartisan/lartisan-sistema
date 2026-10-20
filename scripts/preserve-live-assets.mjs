import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const origin = process.argv[2];
const output = resolve(process.argv[3] ?? "dist/client");
if (!origin) throw new Error("Indicá el origen público actual.");

const allowed = (value) => value.pathname.startsWith("/_next/static/");
const queue = [new URL("/", origin)];
const visited = new Set();

while (queue.length) {
  const url = queue.shift();
  if (visited.has(url.href)) continue;
  visited.add(url.href);
  const response = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) continue;
  const body = await response.text();
  const references = body.matchAll(/(?:["']|from\s*["'])(\/?_next\/static\/[^"'`\\\s)]+|\.\/?[^"'`\\\s)]+\.(?:js|css))(?:["'])/g);
  for (const match of references) {
    const candidate = new URL(match[1], url);
    if (allowed(candidate) && !visited.has(candidate.href)) queue.push(candidate);
  }
  if (!allowed(url)) continue;
  const target = resolve(output, `.${url.pathname}`);
  if (!target.startsWith(output)) throw new Error("Ruta de recurso inválida.");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body);
}

console.log(`Recursos de compatibilidad conservados: ${visited.size - 1}`);
