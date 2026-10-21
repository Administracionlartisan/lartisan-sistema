import { test } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import { summarizePromotions } from '../app/modules/reports/promotionSummary.ts';

test('cuenta promociones activas por local, sin duplicar ni incluir anuladas o fuera de semana', () => {
  const base = { site: 'Maure', date: '2026-10-19', promotion: '15% efectivo', status: 'activa' };
  const sales = [
    { ...base, id: '1' }, { ...base, id: '1' }, { ...base, id: '2' },
    { ...base, id: '3', promotion: '10% débito' },
    { ...base, id: '4', site: 'Villa Mitre' },
    { ...base, id: '5', status: 'anulada' },
    { ...base, id: '6', date: '2026-10-26' },
    { ...base, id: '7', promotion: null },
  ];
  deepStrictEqual(summarizePromotions(sales, '2026-10-19', '2026-10-25'), [
    { site: 'Maure', promotion: '10% débito', count: 1 },
    { site: 'Maure', promotion: '15% efectivo', count: 2 },
    { site: 'Villa Mitre', promotion: '15% efectivo', count: 1 },
  ]);
});
