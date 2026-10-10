/**
 * Grabador local para Capacitación. Sólo admite localhost, credenciales de
 * demostración y recorridos de lectura/navegación: no crea ventas, cajas ni
 * movimientos. El cursor, clics y resaltados son temporales de la grabación.
 */
import playwright from "../.demo-local/tools-node/node_modules/playwright-core/index.js";
const { chromium } = playwright;

const baseUrl = process.env.TRAINING_DEMO_URL || "";
if (!/^http:\/\/(127\.0\.0\.1|\[::1\]|localhost):\d+\//.test(baseUrl)) throw new Error("La grabación admite exclusivamente localhost.");
const user = process.env.TRAINING_DEMO_USER || "";
const password = process.env.TRAINING_DEMO_PASSWORD || "";
if (!/^vendedora\.pruebas$/.test(user) || !password) throw new Error("Usá únicamente la cuenta ficticia vendedora.pruebas.");

const recordingsDir = ".demo-local/training-recordings/raw";
const flows = [
  ["01-introduccion-navegacion", ["Ventas", "Stock", "Guía"]],
  ["02-apertura-caja", ["Caja"]],
  ["03-ventas-medios-pago", ["Ventas"]],
  ["04-clientes", ["Clientes"]],
  ["05-stock-pedidos-devoluciones", ["Stock", "Pedido", "Devoluciones"]],
  ["06-egresos-incidencias", ["Egresos", "Incidencias"]],
  ["07-fichaje", ["Fichaje"]],
  ["08-chat-interno", ["__chat__"]],
  ["09-cierre-sincronizacion", ["Caja", "Ventas"]],
];

async function decorate(page) {
  await page.addStyleTag({ content: "#training-cursor{position:fixed;z-index:2147483647;width:28px;height:28px;border:3px solid #ec3a35;border-radius:50%;pointer-events:none;box-shadow:0 0 0 6px #ffffff99;transition:left .35s ease,top .35s ease,transform .2s ease}#training-cursor.click{transform:scale(.65);background:#ec3a35aa}.training-highlight{outline:4px solid #f5be32!important;outline-offset:4px!important;box-shadow:0 0 0 8px #f5be3255!important}" });
  await page.evaluate(() => { const cursor=document.createElement("div"); cursor.id="training-cursor"; cursor.setAttribute("aria-hidden","true"); cursor.style.left="60px"; cursor.style.top="90px"; document.body.append(cursor); });
}
async function spotlight(page, locator) {
  await locator.waitFor({ state: "visible", timeout: 5000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error("No se pudo localizar el control de demostración.");
  await page.evaluate(({x,y}) => { const cursor=document.querySelector("#training-cursor"); if(cursor){ cursor.style.left=`${x-14}px`; cursor.style.top=`${y-14}px`; } }, { x:box.x+box.width/2, y:box.y+box.height/2 });
  await locator.evaluate(el => el.classList.add("training-highlight")); await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelector("#training-cursor")?.classList.add("click")); await page.waitForTimeout(180); await locator.click();
  await page.evaluate(() => document.querySelector("#training-cursor")?.classList.remove("click")); await page.waitForTimeout(900);
  await locator.evaluate(el => el.classList.remove("training-highlight")).catch(() => {});
}
async function login(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("nombre.apellido").waitFor({ state: "visible", timeout: 15000 });
  await page.getByPlaceholder("nombre.apellido").fill(user); await page.getByPlaceholder("Tu contraseña").fill(password);
  await spotlight(page, page.getByRole("button", { name: "Ingresar", exact: true }));
  await page.getByText("Vendedora de Prueba", { exact: false }).waitFor({ state: "visible", timeout: 15000 });
  const closeWelcome = page.getByRole("button", { name: "Continuar en el sistema", exact: true }); if (await closeWelcome.count()) await closeWelcome.click();
}
async function visit(page, label) {
  if (label === "__chat__") { await spotlight(page, page.getByRole("button", { name: "Abrir chat interno", exact: true })); return; }
  await spotlight(page, page.getByRole("button", { name: label, exact: true }));
}

const browser = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, args: ["--disable-gpu", "--no-first-run", "--disable-sync"] });
try {
  for (const [name, steps] of flows) {
    console.log(`START ${name}`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: recordingsDir, size: { width: 1280, height: 720 } } });
    const page = await context.newPage(); await login(page); await decorate(page);
    for (const step of steps) { console.log(`STEP ${name} ${step}`); await visit(page, step); }
    await page.waitForTimeout(1100); const video = page.video(); await context.close();
    if (!video) throw new Error(`No se creó video para ${name}.`); console.log(`${name}=${await video.path()}`);
  }
} finally { await browser.close(); }
