import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('cargos adicionales están disponibles en el formulario y validados por la API', () => {
  const ui = readFileSync('app/modules/asistencia/ScheduleManager.tsx', 'utf8');
  const api = readFileSync('donweb-api/index.php', 'utf8');
  for (const title of ['repositor', 'vendedor', 'supervisora', 'repartidor']) {
    assert.match(ui, new RegExp(`"${title}"`));
    assert.match(api, new RegExp(`'${title}'`));
  }
  assert.match(ui, /attendance\/personnel\/job-title/);
  const endpoint = api.split("$route === 'attendance/personnel/job-title'")[1].split("$route === 'admin/personnel-files'")[0];
  assert.match(endpoint, /UPDATE users SET job_title=\? WHERE id=\?/);
  assert.match(endpoint, /user_can_access_site\(\$employee,\$site\)/);
  assert.match(endpoint, /attendance_personnel_title_updated/);
  assert.doesNotMatch(endpoint, /SET (?:role|password_hash|action_permissions|report_permissions)\s*=/);
});
