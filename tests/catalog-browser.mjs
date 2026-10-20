// Prueba manual aislada: node tests/catalog-browser.mjs. Escucha solo en loopback.
// No envía ninguna operación a DonWeb ni guarda productos de prueba en producción.
import http from 'node:http';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const seedSource = readFileSync('app/modules/config/operationalCatalog.ts', 'utf8');
const rows = seedSource.slice(seedSource.indexOf('const raw:'), seedSource.indexOf('export const PRODUCTS'));
const tuples = [...rows.matchAll(/\["([^"]+)", "([^"]+)", "([^"]+)", (\d+), "(\d+)"\]/g)];
let catalog = { revision: 1, products: tuples.map((m, i) => ({ id: i + 1, name: m[1], detail: m[2], category: m[3], price: Number(m[4]), onlinePrice: Math.round(Number(m[4]) * 1.25), code: m[5], barcode: 'LART-' + m[5], barcodeAliases: m[5] === '501' ? ['LART-401'] : [] })), priceChanges: [] };
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Home from './app/page.tsx';
    const nativeFetch=window.fetch.bind(window);
    window.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,location.href); return nativeFetch('/mock?path='+encodeURIComponent(url.pathname)+'&role='+(new URLSearchParams(location.search).get('role')||'administracion'),options);};
    createRoot(document.getElementById('root')).render(<Home/>);`,
    loader: 'tsx', resolveDir: process.cwd(),
  }, bundle: true, write: false, outfile: 'work/catalog-harness.js', format: 'iife', define: { 'process.env.NODE_ENV': '"development"' },
});
const script = bundle.outputFiles.find(f => f.path.endsWith('.js')).contents;
const css = readdirSync('dist/client/_next/static/css').filter(p => p.endsWith('.css')).map(p => readFileSync(resolve('dist/client/_next/static/css', p))).join('\n');
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8971');
  if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(script); }
  if (url.pathname === '/app.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname === '/mock') {
    res.setHeader('Content-Type', 'application/json');
    const path = url.searchParams.get('path'), role = url.searchParams.get('role');
    const sites = ['Recoleta', 'Villa Mitre', 'Congreso', 'Maure', 'Novo Pacheco'];
    const send = data => res.end(JSON.stringify(data));
    if (path === '/api/catalog') {
      if (req.method === 'PUT') {
        let text = ''; for await (const chunk of req) text += chunk;
        const body = JSON.parse(text);
        if (role !== 'administracion') { res.statusCode = 403; return send({ error: 'Sin permiso' }); }
        if (body.revision !== catalog.revision) { res.statusCode = 409; return send({ error: 'Catálogo modificado' }); }
        catalog = { ...body, revision: catalog.revision + 1 };
      }
      return send(catalog);
    }
    if (path.endsWith('/auth/me')) return send({ user: { id: role, username: 'prueba', fullName: 'Prueba aislada', role, assignedLocation: 'Recoleta', assignedLocations: sites, accessAllLocations: true } });
    if (path.endsWith('/operations/states')) return send({ states: Object.fromEntries(sites.map(site => [site, { revision: 1, state: { stock: Object.fromEntries(catalog.products.map(p => [p.id, p.code === '501' ? 2 : 0])), cashOpen: true, stockRequests: [] } }])) });
    return send({ ok: true, users: [], requests: [], sales: [], payments: [], records: [], events: [], items: [], connected: false, alerts: [], revisions: {}, revision: 2 });
  }
  if (url.pathname !== '/') { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
}).listen(8971, '127.0.0.1', () => console.log('Prueba aislada: http://127.0.0.1:8971/?portal=admin'));
