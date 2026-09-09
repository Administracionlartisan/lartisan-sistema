import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as guide from '../app/data/reportGuide.ts';

const source = readFileSync(new URL('../app/components/ReportNavigation.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const require = createRequire(import.meta.url);
const exports = {};
runInNewContext(compiled, { exports, require: id => id === '../data/reportGuide' ? guide : require(id) });
const Navigation = exports.default;
const { ADMIN_REPORTS, REPORT_AREAS, groupAvailableReports, describeReport, adminReportGuides } = guide;
function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  return [node, ...elements(node.props.children)];
}
const render = (selectedReport, reports = ADMIN_REPORTS, onSelect = () => {}) => Navigation({ selectedReport, reports, onSelect });

test('six areas cover all 28 actual reports exactly once', () => {
  assert.equal(REPORT_AREAS.length, 6);
  const ids = REPORT_AREAS.flatMap(area => area.reports);
  assert.equal(ids.length, 28);
  assert.equal(new Set(ids).size, 28);
  assert.deepEqual(new Set(ids), new Set(ADMIN_REPORTS.map(report => report.id)));
});

for (const report of ADMIN_REPORTS) test(`selecting ${report.id}, including from help, reveals its area`, () => {
  const tree = elements(render(report.id));
  const area = REPORT_AREAS.find(item => item.reports.includes(report.id));
  const pressed = tree.filter(node => node.type === 'button' && node.props['aria-pressed'] === true);
  assert.equal(pressed.length, 1);
  assert.match(renderToStaticMarkup(pressed[0]), new RegExp(area.title));
  const current = tree.filter(node => node.props['aria-current'] === 'page');
  assert.equal(current.length, 1);
  assert.equal(current[0].props.title, report.detail);
  assert.equal(tree.filter(node => node.props.className === 'report-option').length, area.reports.length);
  assert.match(describeReport(adminReportGuides.find(item => item.id === report.id)), new RegExp(`Panel central → ${area.title} →`));
});

test('empty areas and unauthorized report names are never rendered', () => {
  const permitted = ADMIN_REPORTS.filter(report => ['DetalleVentas', 'Personal'].includes(report.id));
  const grouped = groupAvailableReports(permitted);
  assert.deepEqual(grouped.map(area => area.id), ['ventas', 'personas']);
  const tree = render('DetalleVentas', permitted);
  const html = renderToStaticMarkup(tree);
  assert.doesNotMatch(html, /P&amp;L|Control bancario|Caja Mayor|Auditoría/);
  assert.match(html, /2 informes disponibles/);
  const calls = [];
  const limitedTree = elements(render('DetalleVentas', permitted, id => calls.push(id)));
  for (const button of limitedTree.filter(node => node.type === 'button')) button.props.onClick();
  assert.ok(calls.every(id => ['DetalleVentas', 'Personal'].includes(id)));
});

test('all desktop area buttons choose a permitted report, not an extra data action', () => {
  const calls = [];
  const buttons = elements(render('Resumen', ADMIN_REPORTS, id => calls.push(id)))
    .filter(node => node.type === 'button' && node.props['aria-controls']);
  buttons.forEach(button => button.props.onClick());
  assert.deepEqual(calls, REPORT_AREAS.slice(1).map(area => area.reports[0]));
  assert.doesNotMatch(source, /\b(fetch|localStorage|sessionStorage)\s*[.(]/);
});

test('mobile area selector has the same authorized destinations and rejects unknown values', () => {
  const calls = [];
  const select = elements(render('Resumen', ADMIN_REPORTS, id => calls.push(id))).find(node => node.type === 'select');
  select.props.onChange({ target: { value: 'stock' } });
  select.props.onChange({ target: { value: 'not-an-area' } });
  assert.deepEqual(calls, ['Stock']);
  assert.equal(elements(select).filter(node => node.type === 'option').length, 6);
});

test('a profile without reports gets an empty state and no controls', () => {
  const tree = render('Resumen', []);
  assert.match(renderToStaticMarkup(tree), /No tenés reportes habilitados/);
  assert.equal(elements(tree).filter(node => ['select', 'button'].includes(node.type)).length, 0);
});

test('single-report and stale selection states do not invent a selected report', () => {
  const permitted = ADMIN_REPORTS.filter(report => report.id === 'Fiscal');
  const tree = render('Resumen', permitted);
  assert.match(renderToStaticMarkup(tree), /1 informe disponible/);
  assert.equal(elements(tree).filter(node => node.props['aria-current'] === 'page').length, 0);
  assert.match(renderToStaticMarkup(tree), /En desarrollo/);
});

test('responsive and print rules keep navigation scoped to the panel', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.report-areas \{ display: none; \}/);
  assert.match(css, /\.report-area-mobile \{ display: block;/);
  assert.match(css, /\.no-print\s*\{/);
  assert.match(renderToStaticMarkup(render('Resumen')), /report-navigation no-print/);
});
