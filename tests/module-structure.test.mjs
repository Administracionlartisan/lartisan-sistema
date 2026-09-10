import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("la pagina principal consume los modulos separados", async () => {
  const page = await source("app/page.tsx");

  assert.match(page, /from "\.\/modules\/auth\/AuthScreens"/);
  assert.match(page, /from "\.\/modules\/ventas\/thermalReceipt"/);
  assert.match(page, /from "\.\/modules\/config\/operationalCatalog"/);
  assert.match(page, /from "\.\/modules\/shared\/types"/);
  assert.match(page, /from "\.\/modules\/usuarios\/apiUserMapper"/);
});

test("las responsabilidades extraidas no vuelven a declararse en page.tsx", async () => {
  const page = await source("app/page.tsx");

  assert.doesNotMatch(page, /function buildThermalReceipt/);
  assert.doesNotMatch(page, /function AccessScreen/);
  assert.doesNotMatch(page, /function ForcePasswordChangeScreen/);
  assert.doesNotMatch(page, /type Product =/);
  assert.doesNotMatch(page, /const PRODUCTS:/);
});

test("las pantallas extraidas mantienen sus estilos fuera del componente", async () => {
  const auth = await source("app/modules/auth/AuthScreens.tsx");
  const comingSoon = await source("app/modules/administracion/ComingSoonPanel.tsx");
  const authCss = await source("app/modules/auth/AuthScreens.module.css");
  const comingSoonCss = await source("app/modules/administracion/ComingSoonPanel.module.css");

  assert.match(auth, /AuthScreens\.module\.css/);
  assert.match(comingSoon, /ComingSoonPanel\.module\.css/);
  assert.ok(authCss.length > 0);
  assert.ok(comingSoonCss.length > 0);
});
