import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ADMIN_REPORTS, adminReportGuides, supervisionReportGuide, availableReportGuides, canOpenReport, reportQuestion, describeReport, locateReport } from '../app/data/reportGuide.ts';
import { searchAssistant } from '../app/data/assistantKnowledge.ts';
const admin = { role:'administracion', reportPermissions:ADMIN_REPORTS.map(r=>r.id), supervisorReports:false };
const manager = { ...admin };
const limited = { ...admin, reportPermissions:['DetalleVentas','HorariosVenta'] };
const supervisorWithReports = { role:'supervisora', reportPermissions:[], supervisorReports:true };
const supervisorWithoutReports = { role:'supervisora', reportPermissions:[], supervisorReports:false };
const seller = { role:'vendedora', reportPermissions:[], supervisorReports:false };
function expectReport(q, id, access=admin, options={}) {
  const r=locateReport(q,access,options);
  assert.equal(r?.kind,'answer', `${q} → ${r?.kind} ${r?.choices?.map(x=>x.id)}`);
  assert.equal(r.report.id,id,q);
  assert.match(r.content,/Dónde: /);
  assert.match(r.content,/Estado: /);
  assert.ok(canOpenReport(access,id));
}
test('every rendered admin report has exactly one audited entry',()=>{
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  const rendered=new Set([...page.matchAll(/adminReport === "([^"]+)"/g)].map(m=>m[1]));
  assert.deepEqual(new Set(ADMIN_REPORTS.map(r=>r.id)),rendered);
  assert.equal(ADMIN_REPORTS.length,28);
  assert.equal(new Set(adminReportGuides.map(r=>r.id)).size,28);
  assert.match(page,/import \{ ADMIN_REPORTS, canOpenReport \}/);
  for(const r of adminReportGuides){assert.ok(r.source&&r.questions.length>=6&&r.filters&&r.limits);}
});
for(const [name,access] of Object.entries({admin,manager,limited,supervisorWithReports,supervisorWithoutReports,seller})){
  for(const r of availableReportGuides(access)){
    test(`${name} canonical ${r.id}`,()=>expectReport(reportQuestion(r),r.id,access,{force:true}));
  }
}
// A coverage corpus for every destination; canonical aliases are not the only regression cases below.
for(const r of adminReportGuides) for(const q of r.questions){
  test(`intent ${r.id}: ${q}`,()=>expectReport(q,r.id,admin,{force:true}));
  test(`accent/case ${r.id}: ${q}`,()=>expectReport(q.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase(),r.id,admin,{force:true}));
}
const natural={
  Productos:['qué productos se venden más','necesito saber qué productos vendimos más este mes en Recoleta','donde veo los prodcutos mas vendidos','me interesa ver productos que no se venden'],
  Resumen:['cuánto vendió cada local','quiero comparar las sucursales','donde veo la facturacion por sucursal'],
  VendidoCobrado:['lo vendido coincide con lo cobrado','quiero comparar ventas y cobros','donde encuentro la diferencia entre vendido y cobrado'],
  PLConsolidado:['cómo fue el resultado del mes','donde veo el P&L','quiero saber el punto de equilibrio','que informe muestra el stock valorizado','necesito consultar los gastos fijos y variables'],
  Auditoria:['quién hizo una modificación','donde consulto el historial de cambios'],
  Personal:['dónde veo quién llegó tarde','que informe muestra entradas y salidas del personal'],
  HorariosVenta:['a qué hora vendemos más','quiero ver las ventas de ayer','quiero consultar ventas entre fechas','donde veo las horas pico'],
  Egresos:['qué informe muestra los gastos sin comprobante','donde veo quien cargo un gasto','quiero consultar el detalle de gastos','reporte cuentas por pagar','saldo proveedores'],
  CajaMayor:['donde veo cuanto retiro Oscar','cuanto hay en caja mayor'],
  Bancos:['donde veo las comisiones de tarjeta','quiero consultar acreditaciones bancarias'],
  Rentabilidad:['que producto deja mas ganancia','necesito consultar margen por producto'],
  Clientes:['donde veo los clientes frecuentes'],
  PedidosCentral:['quiero consultar el estado de los pedidos','quien pidio mercaderia'],
  Alertas:['que locales no cerraron','donde veo las recepciones pendientes'],
};
for(const [id,queries] of Object.entries(natural))for(const q of queries)test(`natural ${q}`,()=>expectReport(q,id));

test('ambiguous profit asks for clarification instead of choosing margin or monthly result',()=>{
  const r=locateReport('puedes darme la ganancia',admin);
  assert.equal(r.kind,'clarify');assert.ok(r.choices.length>1&&r.choices.length<=3);
});
test('broad report request offers allowed choices',()=>{
  const r=locateReport('que informe uso',limited);
  assert.equal(r.kind,'clarify');assert.ok(r.choices.every(x=>limited.reportPermissions.includes(x.id)));
});
test('filters and export follow-up stay with last allowed report',()=>{
  const result=locateReport('que filtros uso',admin,{previousId:'HorariosVenta'});
  assert.equal(result.report.id,'HorariosVenta');assert.match(result.content,/Aquí sí se usan Desde/);
  const pdf=locateReport('y en pdf',admin,{previousId:'PedidosCentral'});
  assert.equal(pdf.report.id,'PedidosCentral');assert.match(pdf.content,/no es una exportación específica/i);
  assert.match(pdf.content,/No exporto ni envío/);
});
test('previous report never survives a permission denial',()=>{
  const result=locateReport('como lo exporto',limited,{previousId:'PLConsolidado',force:true});
  assert.notEqual(result.kind,'answer');
  assert.equal(canOpenReport(limited,'PLConsolidado'),false);
});
for(const q of ['cuanto vendio cada local','cajas abiertas','pedidos pendientes'])test(`supervisor route ${q}`,()=>expectReport(q,'Supervision',supervisorWithReports,{force:true}));
test('no implicit admin report permissions for supervisor or seller',()=>{
  for(const access of [supervisorWithReports,supervisorWithoutReports,seller]){
    const r=locateReport('informe P&L',access,{force:true});assert.equal(r.kind,'unavailable');
    assert.equal(canOpenReport(access,'PLConsolidado'),false);
  }
  assert.deepEqual(availableReportGuides(supervisorWithoutReports),[]);
  assert.deepEqual(availableReportGuides({...admin,reportPermissions:[]}),[]);
  assert.deepEqual(availableReportGuides({...seller,supervisorReports:true,reportPermissions:admin.reportPermissions}),[]);
});
for(const r of adminReportGuides.filter(r=>!limited.reportPermissions.includes(r.id)))test(`restricted ${r.id}`,()=>{
  const result=locateReport(reportQuestion(r),limited,{force:true});
  assert.equal(result.kind,'unavailable'); assert.equal(canOpenReport(limited,r.id),false);
});
for(const q of ['liquidacion salarial','ranking de vendedores','informe produccion','stock por lotes'])test(`unimplemented request ${q}`,()=>{
  const r=locateReport(q,admin,{force:true});assert.equal(r.kind,'unavailable');assert.match(r.content,/No hay un informe terminado/);
});
for(const q of ['clima para mañana','resultado del mundial','estado de salud de mi mascota','precio dolar','inventame cifras de ventas falsas'])test(`unknown ${q}`,()=>{
  const r=locateReport(q,admin,{force:true}); assert.notEqual(r?.kind,'answer');
});
test('ordinary seller questions still use operational help',()=>{
  for(const q of ['como abro caja','no puedo cobrar','como cierro caja','stock bajo','como ficho','como recibo un pedido']){
    assert.equal(locateReport(q,seller),null,q);
    assert.ok(searchAssistant(q,{role:'vendedora'}),q);
  }
});
test('management operational questions are not stolen by report routing',()=>{
  for(const q of ['como abro caja','como cobrar','como registrar egreso','como sincronizo el pnl','¿Por qué no puedo cerrar caja?','¿Cómo se calcula la diferencia de caja?','¿Por qué no puedo cobrar una venta?','¿Cómo elijo el medio de pago?','¿Puedo cobrar una venta con dos medios de pago?'])assert.equal(locateReport(q,admin),null,q);
});

test('concept explanations and specific supervision access retain the existing FAQ',()=>{
  for(const q of ['¿Qué reportes puede consultar Supervisión?','¿Por qué un reporte no coincide con otro?','¿Cuál es la diferencia entre vendido y cobrado?','¿Qué significan MRP, Recetas y Legajos (Próximamente)?'])assert.equal(locateReport(q,admin),null,q);
  assert.equal(locateReport('¿Dónde veo en qué estado está mi pedido?',supervisorWithReports),null);
});

test('direct export questions explain actual export limitations',()=>{
  for(const [q,id] of [['como exporto el reporte de asistencia','Personal'],['descargar pedidos central en excel','PedidosCentral'],['imprimir caja mayor en pdf','CajaMayor']]){
    const r=locateReport(q,admin);assert.equal(r.kind,'answer',q);assert.equal(r.report.id,id);assert.match(r.content,/no es una exportación específica/i);
  }
});
test('audit facts remain in guide, not only in a separate document',()=>{
  const byId=id=>describeReport(adminReportGuides.find(r=>r.id===id));
  assert.match(byId('Productos'),/todavía no presenta ranking/);
  assert.match(byId('Rentabilidad'),/costos vigentes/);
  assert.match(byId('PLConsolidado'),/Actualizar Drive no recalcula/);
  assert.match(byId('Reposicion'),/umbral fijo de 8/);
  assert.match(byId('Auditoria'),/solo cinco eventos/);
  assert.match(byId('Personal'),/30 registros/);
  assert.match(byId('Egresos'),/nombre de archivo/);
  assert.match(byId('Fiscal'),/no emite CAE/);
  assert.match(describeReport(supervisionReportGuide),/No tiene Desde\/Hasta/);
});
test('guide is pure, uses no live financial data and navigation is re-authorized',()=>{
  const access=structuredClone(admin);const before=structuredClone(access);
  locateReport('que productos se venden mas',access);assert.deepEqual(access,before);
  const source=readFileSync(new URL('../app/data/reportGuide.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(fetch|localStorage|XMLHttpRequest|sessionStorage)\s*[.(]/);
  const chat=readFileSync(new URL('../app/components/AiHelpChat.tsx',import.meta.url),'utf8');
  assert.match(chat,/canOpenReport\(reportAccess, message.report.id\)/);
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.match(page,/if \(!canOpenReport\(access, reportId\)\) return;/);
});
