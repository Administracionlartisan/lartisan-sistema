<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/pnl_sync.php';
require __DIR__ . '/cash_sheet_sync.php';
require __DIR__ . '/test_operating_date.php';
require __DIR__ . '/mrp_sync.php';
require __DIR__ . '/assistant.php';
require __DIR__ . '/arca_wsfe.php';
require __DIR__ . '/internal_chat.php';
require __DIR__ . '/training.php';
require __DIR__ . '/attendance_presence.php';

configure_cors($config);
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$route = trim((string) ($_GET['route'] ?? ''), '/');
// La cookie de sesión no protege contra CSRF por sí sola: toda escritura debe
// venir de los orígenes web habilitados. Las lecturas GET no se ven afectadas.
if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)
    && !in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) {
    json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
}
try {
    $pdo = db($config);
} catch (Throwable $error) {
    error_log('LARTISAN API database initialization failed: ' . $error->getMessage());
    // El detalle queda en el log; la respuesta pública no revela la tecnología usada.
    json_response(['ok' => false, 'error' => 'database_initialization_failed'], 503);
}
if ($method === 'GET' && ($route === '' || $route === 'health')) {
    $pdo->query('SELECT 1');
    json_response(['ok' => true, 'service' => 'lartisan-api']);
}
// Una migración auxiliar nunca debe bloquear el acceso al sistema. Cada módulo
// también valida su propia estructura justo antes de usarse, donde puede dar un
// error específico sin dejar fuera al resto de la operación.
foreach ([
    'users' => static fn () => ensure_user_locations_schema($pdo),
    'locations' => static fn () => ensure_locations_schema($pdo),
    'operations' => static fn () => ensure_operations_schema($pdo),
    'mrp' => static fn () => ensure_mrp_schema($pdo),
    'arca_wsfe' => static fn () => ensure_arca_wsfe_schema($pdo),
    'test_operating_date' => static fn () => ensure_test_operating_date_schema($pdo),
    'internal_chat' => static fn () => ensure_internal_chat_schema($pdo),
    'training' => static fn () => ensure_training_schema($pdo),
    'attendance_presence' => static fn () => ensure_attendance_presence_schema($pdo),
] as $schema => $ensure) {
    try {
        $ensure();
    } catch (Throwable $error) {
        error_log('LARTISAN deferred ' . $schema . ' schema update: ' . $error->getMessage());
    }
}

// Capacitación de ventas: catálogo publicado, avance por usuario y gestión
// exclusiva de Administración. Los vídeos se alojan como URLs administrables;
// el API nunca expone archivos de operación, sesiones ni credenciales.
if ($method === 'GET' && $route === 'training/chapters') {
    $trainingUser = require_user($pdo); ensure_training_schema($pdo);
    $stmt = $pdo->prepare('SELECT c.*,p.watched_seconds,p.completed_at FROM training_chapters c LEFT JOIN training_progress p ON p.chapter_id=c.id AND p.user_id=? WHERE c.published=1 ORDER BY c.sort_order,c.title');
    $stmt->execute([(int)$trainingUser['id']]);
    $chapters = [];
    foreach ($stmt->fetchAll() as $row) {
        $roles = training_roles(json_decode((string)$row['role_targets'], true) ?: []);
        if (!in_array((string)$trainingUser['role'], $roles, true)) continue;
        $chapters[] = training_chapter_payload($row, $row);
    }
    json_response(['ok'=>true,'chapters'=>$chapters]);
}
if ($method === 'POST' && $route === 'training/progress') {
    $trainingUser = require_user($pdo); ensure_training_schema($pdo); $body=request_body();
    $id = trim((string)($body['chapterId'] ?? '')); $watched=max(0,min(86400,(int)($body['watchedSeconds'] ?? 0))); $complete=!empty($body['complete']);
    $chapter=$pdo->prepare('SELECT role_targets,published FROM training_chapters WHERE id=?'); $chapter->execute([$id]); $row=$chapter->fetch();
    if (!$row || !(bool)$row['published'] || !in_array((string)$trainingUser['role'],training_roles(json_decode((string)$row['role_targets'],true) ?: []),true)) json_response(['ok'=>false,'error'=>'Capítulo no disponible.'],404);
    $pdo->prepare('INSERT INTO training_progress (user_id,chapter_id,watched_seconds,completed_at,last_viewed_at) VALUES (?,?,?,IF(?,NOW(),NULL),NOW()) ON DUPLICATE KEY UPDATE watched_seconds=GREATEST(watched_seconds,VALUES(watched_seconds)),completed_at=IF(completed_at IS NOT NULL OR VALUES(completed_at) IS NULL,completed_at,NOW()),last_viewed_at=NOW()')->execute([(int)$trainingUser['id'],$id,$watched,$complete?1:0]);
    training_audit($pdo,(int)$trainingUser['id'],$complete?'chapter_completed':'chapter_viewed',$id); json_response(['ok'=>true]);
}
if ($method === 'GET' && $route === 'admin/training/chapters') {
    require_user($pdo,['administracion']); ensure_training_schema($pdo); $rows=$pdo->query('SELECT * FROM training_chapters ORDER BY sort_order,title')->fetchAll(); json_response(['ok'=>true,'chapters'=>array_map(static fn($row)=>training_chapter_payload($row),$rows)]);
}
if ($method === 'POST' && $route === 'admin/training/chapters') {
    $trainingAdmin=require_user($pdo,['administracion']); ensure_training_schema($pdo); $body=request_body(); $id=trim((string)($body['id']??''));
    if (!preg_match('/^[a-z0-9-]{3,64}$/',$id)) json_response(['ok'=>false,'error'=>'Identificador de capítulo inválido.'],422);
    $title=trim((string)($body['title']??'')); $description=trim((string)($body['description']??'')); $script=trim((string)($body['script']??'')); $roles=training_roles(is_array($body['roles']??null)?$body['roles']:[]); $video=trim((string)($body['videoUrl']??''));
    if ($title===''||mb_strlen($title)>160||$description===''||$script===''||!$roles||($video!==''&&!training_video_url_allowed($video,$config))) json_response(['ok'=>false,'error'=>'Revisá título, descripción, guion, roles y URL de video autorizada.'],422);
    $captions=trim((string)($body['captionsVtt']??'')); $existing=$pdo->prepare('SELECT * FROM training_chapters WHERE id=?'); $existing->execute([$id]); $old=$existing->fetch();
    if ($old) $pdo->prepare('INSERT INTO training_chapter_versions (chapter_id,version_label,snapshot_json,changed_by,change_kind) VALUES (?,?,?,?,?)')->execute([$id,$old['version_label'],json_encode($old,JSON_UNESCAPED_UNICODE),(int)$trainingAdmin['id'],'updated']);
    $version=trim((string)($body['version']??($old['version_label']??'1.0'))); $duration=max(0,min(7200,(int)($body['durationSeconds']??0))); $order=max(1,(int)($body['order']??999));
    $published=!empty($body['published']); $mandatory=!empty($body['mandatory']);
    if (($published || $mandatory) && !training_is_ready_for_publication($video,$captions,$duration)) json_response(['ok'=>false,'error'=>'Para publicar u obligar un capítulo se requiere video HTTPS real, duración y subtítulos WebVTT válidos.'],422);
    $pdo->prepare('INSERT INTO training_chapters (id,title,description,role_targets,version_label,duration_seconds,script_text,video_url,captions_vtt,sort_order,published,mandatory,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),description=VALUES(description),role_targets=VALUES(role_targets),version_label=VALUES(version_label),duration_seconds=VALUES(duration_seconds),script_text=VALUES(script_text),video_url=VALUES(video_url),captions_vtt=VALUES(captions_vtt),sort_order=VALUES(sort_order),published=VALUES(published),mandatory=VALUES(mandatory),updated_by=VALUES(updated_by)')->execute([$id,$title,$description,json_encode($roles,JSON_UNESCAPED_UNICODE),$version,$duration,$script,$video?:null,$captions?:null,$order,$published?1:0,$mandatory?1:0,(int)$trainingAdmin['id'],(int)$trainingAdmin['id']]);
    training_audit($pdo,(int)$trainingAdmin['id'],$old?'chapter_updated':'chapter_created',$id); json_response(['ok'=>true]);
}
if ($method === 'POST' && preg_match('#^admin/training/chapters/([a-z0-9-]{3,64})/(publish|unpublish)$#',$route,$matches)) {
    $trainingAdmin=require_user($pdo,['administracion']); ensure_training_schema($pdo); $published=$matches[2]==='publish'?1:0;
    if ($published) { $check=$pdo->prepare('SELECT video_url,captions_vtt,duration_seconds FROM training_chapters WHERE id=?'); $check->execute([$matches[1]]); $row=$check->fetch(); if(!$row) json_response(['ok'=>false,'error'=>'Capítulo inexistente.'],404); if (!training_is_ready_for_publication((string)$row['video_url'],(string)$row['captions_vtt'],(int)$row['duration_seconds'])) json_response(['ok'=>false,'error'=>'El capítulo no tiene video real, duración y WebVTT validados.'],422); }
    $stmt=$pdo->prepare('UPDATE training_chapters SET published=?,updated_by=? WHERE id=?'); $stmt->execute([$published,(int)$trainingAdmin['id'],$matches[1]]); if(!$stmt->rowCount()) json_response(['ok'=>false,'error'=>'Capítulo inexistente.'],404); training_audit($pdo,(int)$trainingAdmin['id'],$published?'chapter_published':'chapter_unpublished',$matches[1]); json_response(['ok'=>true]);
}

// Catálogo administrable de sucursales y franquicias. La API, no el navegador,
// decide qué locales son operativos; así una nueva sucursal entra de forma
// coherente en fichaje, caja, permisos, reportes y grupos de chat.
if ($method === 'GET' && $route === 'locations') {
    $user = require_user($pdo); ensure_locations_schema($pdo);
    $rows = $pdo->query('SELECT site, site_code, kind, address, city, province, active FROM lartisan_locations WHERE active = 1 ORDER BY site')->fetchAll();
    if (($user['role'] ?? '') !== 'administracion' && !is_primary_user($user, $config)) {
        $rows = array_values(array_filter($rows, static fn (array $row): bool => user_can_access_site($user, (string) $row['site'])));
    }
    json_response(['ok' => true, 'locations' => $rows]);
}

if ($method === 'GET' && $route === 'admin/locations') {
    $admin = require_user($pdo);
    if (($admin['role'] ?? '') !== 'administracion' && !is_primary_user($admin, $config)) json_response(['ok' => false, 'error' => 'Acceso no autorizado.'], 403);
    ensure_locations_schema($pdo); ensure_attendance_presence_schema($pdo);
    $rows = $pdo->query('SELECT l.site, l.site_code, l.kind, l.address, l.city, l.province, l.contact_name, l.contact_phone, l.active, l.created_at, l.updated_at, p.latitude, p.longitude, p.radius_meters, p.max_accuracy_meters FROM lartisan_locations l LEFT JOIN lartisan_site_presence_settings p ON p.site=l.site ORDER BY l.active DESC, l.site')->fetchAll();
    json_response(['ok' => true, 'locations' => array_map(static fn (array $row): array => [
        'site' => $row['site'], 'code' => $row['site_code'], 'kind' => $row['kind'], 'address' => $row['address'], 'city' => $row['city'], 'province' => $row['province'], 'contactName' => $row['contact_name'], 'contactPhone' => $row['contact_phone'], 'active' => (bool) $row['active'], 'latitude' => $row['latitude'] === null ? null : (float) $row['latitude'], 'longitude' => $row['longitude'] === null ? null : (float) $row['longitude'], 'radiusMeters' => $row['radius_meters'] === null ? 100 : (int) $row['radius_meters'], 'maxAccuracyMeters' => $row['max_accuracy_meters'] === null ? 75 : (int) $row['max_accuracy_meters'], 'createdAt' => $row['created_at'], 'updatedAt' => $row['updated_at'],
    ], $rows)]);
}

if ($method === 'POST' && $route === 'admin/locations/geocode') {
    $admin = require_user($pdo);
    if (($admin['role'] ?? '') !== 'administracion' && !is_primary_user($admin, $config)) json_response(['ok' => false, 'error' => 'Acceso no autorizado.'], 403);
    $body = request_body();
    $parts = [trim((string) ($body['address'] ?? '')), trim((string) ($body['city'] ?? '')), trim((string) ($body['province'] ?? '')), 'Argentina'];
    $query = implode(', ', array_filter($parts, static fn (string $item): bool => $item !== ''));
    if (mb_strlen($query, 'UTF-8') < 8 || mb_strlen($query, 'UTF-8') > 300) json_response(['ok' => false, 'error' => 'Ingresá una dirección completa para buscar coordenadas.'], 422);
    // Nominatim is only a coordinate suggestion. Administración must review it
    // before saving the geofence, so an ambiguous address cannot silently move
    // the attendance perimeter.
    $url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=ar&q=' . rawurlencode($query);
    $context = stream_context_create(['http' => ['method' => 'GET', 'timeout' => 8, 'header' => "User-Agent: LArtisan-Operations/1.0 (location setup)\\r\\nAccept: application/json\\r\\n"], 'https' => ['method' => 'GET', 'timeout' => 8, 'header' => "User-Agent: LArtisan-Operations/1.0 (location setup)\\r\\nAccept: application/json\\r\\n"]]);
    $raw = @file_get_contents($url, false, $context); $results = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($results)) json_response(['ok' => false, 'error' => 'No se pudo consultar el geocodificador. Podés cargar las coordenadas manualmente.'], 502);
    $candidates = [];
    foreach ($results as $result) {
        $lat = filter_var($result['lat'] ?? null, FILTER_VALIDATE_FLOAT); $lon = filter_var($result['lon'] ?? null, FILTER_VALIDATE_FLOAT);
        if ($lat === false || $lon === false) continue;
        $candidates[] = ['label' => (string) ($result['display_name'] ?? 'Ubicación sugerida'), 'latitude' => (float) $lat, 'longitude' => (float) $lon];
    }
    audit($pdo, (int) $admin['id'], 'location_geocode_requested', mb_substr($query, 0, 180, 'UTF-8'));
    json_response(['ok' => true, 'candidates' => $candidates]);
}

if ($method === 'POST' && $route === 'admin/locations') {
    $admin = require_user($pdo);
    if (($admin['role'] ?? '') !== 'administracion' && !is_primary_user($admin, $config)) json_response(['ok' => false, 'error' => 'Acceso no autorizado.'], 403);
    ensure_locations_schema($pdo); ensure_attendance_presence_schema($pdo);
    $body = request_body();
    $site = trim((string) ($body['site'] ?? '')); $code = strtolower(trim((string) ($body['code'] ?? '')));
    $kind = (string) ($body['kind'] ?? 'Local propio'); $address = trim((string) ($body['address'] ?? ''));
    $city = trim((string) ($body['city'] ?? '')); $province = trim((string) ($body['province'] ?? ''));
    $contactName = trim((string) ($body['contactName'] ?? '')); $contactPhone = trim((string) ($body['contactPhone'] ?? ''));
    $lat = filter_var($body['latitude'] ?? null, FILTER_VALIDATE_FLOAT); $lon = filter_var($body['longitude'] ?? null, FILTER_VALIDATE_FLOAT);
    $radius = filter_var($body['radiusMeters'] ?? 100, FILTER_VALIDATE_INT); $accuracy = filter_var($body['maxAccuracyMeters'] ?? 75, FILTER_VALIDATE_INT);
    if (!preg_match('/^[\\p{L}0-9][\\p{L}0-9 .\\-]{1,78}$/u', $site) || !preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $code) || strlen($code) > 48 || !in_array($kind, ['Local propio', 'Franquicia'], true) || $address === '' || $city === '' || $province === '') json_response(['ok' => false, 'error' => 'Completá nombre, código, tipo y dirección del local.'], 422);
    if ($lat === false || $lon === false || $lat < -90 || $lat > 90 || $lon < -180 || $lon > 180 || $radius === false || $radius < 75 || $radius > 150 || $accuracy === false || $accuracy < 10 || $accuracy > 150) json_response(['ok' => false, 'error' => 'Confirmá coordenadas, radio (75–150 m) y precisión máxima.'], 422);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO lartisan_locations (site, site_code, kind, address, city, province, contact_name, contact_phone, active, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')->execute([$site, $code, $kind, $address, $city, $province, $contactName ?: null, $contactPhone ?: null, $admin['id'], $admin['id']]);
        $pdo->prepare('INSERT INTO lartisan_site_presence_settings (site, latitude, longitude, radius_meters, max_accuracy_meters, updated_by) VALUES (?, ?, ?, ?, ?, ?)')->execute([$site, $lat, $lon, $radius, $accuracy, $admin['id']]);
        audit($pdo, (int) $admin['id'], 'location_created', $site . ' · ' . $kind . ' · geocerca ' . $radius . ' m');
        $pdo->commit();
    } catch (PDOException $error) { if ($pdo->inTransaction()) $pdo->rollBack(); json_response(['ok' => false, 'error' => 'El nombre o código del local ya existe.'], 409); }
    json_response(['ok' => true]);
}

// Las rutas con nombres de local que contienen espacios dependen del rewrite del
// hosting. Aceptamos además `?site=` para que la actualización no pierda el
// identificador en esa capa y siga usando el mismo control administrativo.
if ($method === 'PATCH' && (preg_match('#^admin/locations/([^/]+)$#', $route, $matches) || ($route === 'admin/locations' && isset($_GET['site'])))) {
    $admin = require_user($pdo);
    if (($admin['role'] ?? '') !== 'administracion' && !is_primary_user($admin, $config)) json_response(['ok' => false, 'error' => 'Acceso no autorizado.'], 403);
    ensure_locations_schema($pdo); ensure_attendance_presence_schema($pdo);
    $site = rawurldecode($matches[1] ?? (string) $_GET['site']); $body = request_body();
    $existingStmt = $pdo->prepare('SELECT * FROM lartisan_locations WHERE site=? FOR UPDATE'); $pdo->beginTransaction();
    try {
        $existingStmt->execute([$site]); $existing = $existingStmt->fetch(); if (!$existing) throw new RuntimeException('Local inexistente.');
        $kind = (string) ($body['kind'] ?? $existing['kind']); $address = trim((string) ($body['address'] ?? $existing['address'])); $city = trim((string) ($body['city'] ?? $existing['city'])); $province = trim((string) ($body['province'] ?? $existing['province']));
        $contactName = trim((string) ($body['contactName'] ?? $existing['contact_name'])); $contactPhone = trim((string) ($body['contactPhone'] ?? $existing['contact_phone'])); $active = array_key_exists('active', $body) ? (!empty($body['active']) ? 1 : 0) : (int) $existing['active'];
        $lat = filter_var($body['latitude'] ?? null, FILTER_VALIDATE_FLOAT); $lon = filter_var($body['longitude'] ?? null, FILTER_VALIDATE_FLOAT); $radius = filter_var($body['radiusMeters'] ?? 100, FILTER_VALIDATE_INT); $accuracy = filter_var($body['maxAccuracyMeters'] ?? 75, FILTER_VALIDATE_INT);
        if (!in_array($kind, ['Local propio', 'Franquicia'], true) || $address === '' || $city === '' || $province === '' || $lat === false || $lon === false || $radius === false || $radius < 75 || $radius > 150 || $accuracy === false || $accuracy < 10 || $accuracy > 150) throw new RuntimeException('Configuración de local o geocerca inválida.');
        if (!$active) { $state = $pdo->prepare('SELECT state_json FROM operation_site_states WHERE site=? FOR UPDATE'); $state->execute([$site]); $row = $state->fetch(); $snapshot = $row ? json_decode((string) $row['state_json'], true) : []; if (!empty($snapshot['cashOpen'])) throw new RuntimeException('No se puede desactivar un local con caja abierta.'); }
        $pdo->prepare('UPDATE lartisan_locations SET kind=?,address=?,city=?,province=?,contact_name=?,contact_phone=?,active=?,updated_by=? WHERE site=?')->execute([$kind, $address, $city, $province, $contactName ?: null, $contactPhone ?: null, $active, $admin['id'], $site]);
        $pdo->prepare('INSERT INTO lartisan_site_presence_settings (site,latitude,longitude,radius_meters,max_accuracy_meters,updated_by) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE latitude=VALUES(latitude),longitude=VALUES(longitude),radius_meters=VALUES(radius_meters),max_accuracy_meters=VALUES(max_accuracy_meters),updated_by=VALUES(updated_by)')->execute([$site, $lat, $lon, $radius, $accuracy, $admin['id']]);
        audit($pdo, (int) $admin['id'], $active ? 'location_updated' : 'location_deactivated', $site . ' · geocerca ' . $radius . ' m'); $pdo->commit();
    } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); json_response(['ok' => false, 'error' => $error->getMessage()], 422); }
    json_response(['ok' => true]);
}

if ($method === 'GET' && $route === 'attendance/presence-settings') {
    $user = require_user($pdo);
    ensure_attendance_presence_schema($pdo);
    $site = trim((string) ($_GET['site'] ?? ''));
    if (!user_can_access_site($user, $site)) json_response(['ok' => false, 'error' => 'Local no autorizado.'], 403);
    $settings = presence_settings($pdo, $site);
    // Las coordenadas exactas solo las puede consultar Administración. El cliente
    // conoce las tolerancias necesarias para informar el consentimiento, pero la
    // geocerca de referencia y su validación permanecen en el servidor.
    json_response(['ok' => true, 'configured' => $settings !== null, 'settings' => $settings === null ? null : [
        'site' => $settings['site'],
        'radiusMeters' => (int) $settings['radius_meters'],
        'maxAccuracyMeters' => (int) $settings['max_accuracy_meters'],
        'updatedAt' => $settings['updated_at'],
    ]]);
}

if ($method === 'GET' && $route === 'admin/attendance/presence-settings') {
    $settingsUser = require_user($pdo);
    if (($settingsUser['role'] ?? '') !== 'administracion' && !is_primary_user($settingsUser, $config)) json_response(['ok' => false, 'error' => 'Acceso no autorizado'], 403);
    ensure_attendance_presence_schema($pdo);
    $rows = $pdo->query('SELECT site, latitude, longitude, radius_meters, max_accuracy_meters, updated_at FROM lartisan_site_presence_settings ORDER BY site')->fetchAll();
    json_response(['ok' => true, 'settings' => array_map(static fn ($row) => ['site' => $row['site'], 'latitude' => $row['latitude'] === null ? null : (float) $row['latitude'], 'longitude' => $row['longitude'] === null ? null : (float) $row['longitude'], 'radiusMeters' => (int) $row['radius_meters'], 'maxAccuracyMeters' => (int) $row['max_accuracy_meters'], 'updatedAt' => $row['updated_at']], $rows)]);
}

// El nombre del local puede contener espacios. La ruta histórica se conserva para
// compatibilidad, y la variante con ?site= evita que proxies reescriban ese tramo.
if ($method === 'PUT' && (
    preg_match('#^admin/attendance/presence-settings/([^/]+)$#', $route, $matches)
    || ($route === 'admin/attendance/presence-settings' && isset($_GET['site']))
)) {
    $user = require_user($pdo);
    // La cuenta administradora principal conserva acceso de recuperación a la
    // configuración de presencia aunque su fila de rol se haya desincronizado.
    if (($user['role'] ?? '') !== 'administracion' && !is_primary_user($user, $config)) json_response(['ok' => false, 'error' => 'Acceso no autorizado'], 403);
    ensure_attendance_presence_schema($pdo);
    $site = isset($matches[1]) ? rawurldecode($matches[1]) : trim((string) $_GET['site']);
    if (!in_array($site, operational_sites(), true)) json_response(['ok' => false, 'error' => 'Local inválido.'], 422);
    $body = request_body(); $lat = filter_var($body['latitude'] ?? null, FILTER_VALIDATE_FLOAT); $lon = filter_var($body['longitude'] ?? null, FILTER_VALIDATE_FLOAT);
    $radius = filter_var($body['radiusMeters'] ?? null, FILTER_VALIDATE_INT); $accuracy = filter_var($body['maxAccuracyMeters'] ?? null, FILTER_VALIDATE_INT);
    if ($lat === false || $lon === false || $lat < -90 || $lat > 90 || $lon < -180 || $lon > 180 || $radius === false || $radius < 75 || $radius > 150 || $accuracy === false || $accuracy < 10 || $accuracy > 150) json_response(['ok' => false, 'error' => 'Coordenadas o límites inválidos. Radio permitido: 75 a 150 m.'], 422);
    $pdo->prepare('INSERT INTO lartisan_site_presence_settings (site, latitude, longitude, radius_meters, max_accuracy_meters, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE latitude=VALUES(latitude), longitude=VALUES(longitude), radius_meters=VALUES(radius_meters), max_accuracy_meters=VALUES(max_accuracy_meters), updated_by=VALUES(updated_by)')->execute([$site, $lat, $lon, $radius, $accuracy, $user['id']]);
    audit($pdo, (int) $user['id'], 'presence_geofence_configured', $site . ' · radio ' . $radius . ' m');
    json_response(['ok' => true, 'settings' => presence_settings($pdo, $site)]);
}

if ($method === 'POST' && $route === 'attendance/clock') {
    $user = require_user($pdo); ensure_operations_schema($pdo); ensure_attendance_presence_schema($pdo);
    $body = request_body(); $site = trim((string) ($body['site'] ?? '')); $kind = (string) ($body['kind'] ?? '');
    if (!user_can_access_site($user, $site) || !in_array($kind, ['Entrada', 'Salida'], true)) json_response(['ok' => false, 'error' => 'Fichaje inválido o local no autorizado.'], 422);
    $geo = is_array($body['geolocation'] ?? null) ? $body['geolocation'] : [];
    $trustedDevice = attendance_authorized_device($pdo, $site, is_array($body['deviceAuth'] ?? null) ? $body['deviceAuth'] : []);
    $evaluation = $trustedDevice
        ? ['ok' => true, 'reason' => 'Equipo autorizado', 'device' => $trustedDevice]
        : presence_evaluate($pdo, $site, $geo);
    $evidence = ['reason' => $evaluation['reason'], 'distanceMeters' => isset($evaluation['distance']) ? round((float) $evaluation['distance'], 1) : null, 'accuracyMeters' => isset($evaluation['accuracy']) ? round((float) $evaluation['accuracy'], 1) : null, 'capturedAt' => $geo['capturedAt'] ?? null];
    $pdo->beginTransaction();
    try {
        if (!$evaluation['ok']) {
            $id = presence_uuid();
            $pdo->prepare('INSERT INTO lartisan_attendance_exceptions (id, user_id, site, kind, reason, evidence_json) VALUES (?, ?, ?, ?, ?, ?)')->execute([$id, $user['id'], $site, $kind, $evaluation['reason'], json_encode($evidence, JSON_UNESCAPED_UNICODE)]);
            audit($pdo, (int) $user['id'], 'attendance_exception_requested', $site . ' · ' . $kind . ' · ' . $evaluation['reason']);
            $pdo->commit(); json_response(['ok' => false, 'exception' => true, 'exceptionId' => $id, 'reason' => $evaluation['reason'], 'message' => 'El fichaje requiere autorización de Supervisión.']);
        }
        $record = attendance_append_to_locked_state($pdo, $site, $user, $kind, $trustedDevice
            ? ['presenceStatus' => 'Equipo autorizado', 'attendanceDeviceId' => (string) $trustedDevice['id']]
            : ['presenceStatus' => 'Dentro de zona', 'distanceMeters' => $evidence['distanceMeters'], 'accuracyMeters' => $evidence['accuracyMeters'], 'locationCapturedAt' => $evidence['capturedAt']]);
        audit($pdo, (int) $user['id'], $trustedDevice ? 'attendance_clocked_with_authorized_device' : 'attendance_clocked_with_geofence', $site . ' · ' . $kind);
        $pdo->commit(); json_response(['ok' => true, 'record' => $record]);
    } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
}

if ($method === 'POST' && $route === 'attendance/devices') {
    $user = require_user($pdo); ensure_attendance_presence_schema($pdo); $body = request_body();
    $site = trim((string) ($body['site'] ?? '')); $deviceId = trim((string) ($body['deviceId'] ?? '')); $token = trim((string) ($body['token'] ?? '')); $label = trim((string) ($body['label'] ?? 'Computadora del local'));
    if (!user_can_access_site($user, $site) || !preg_match('/^[a-f0-9-]{36}$/i', $deviceId) || strlen($token) < 32 || strlen($token) > 300 || $label === '') json_response(['ok' => false, 'error' => 'Solicitud de equipo inválida.'], 422);
    $label = mb_substr($label, 0, 120); $hash = hash('sha256', $token);
    $existing = $pdo->prepare('SELECT * FROM lartisan_attendance_devices WHERE site=? AND device_id=? LIMIT 1'); $existing->execute([$site, $deviceId]); $row = $existing->fetch();
    if ($row && $row['status'] === 'Aprobado') json_response(['ok' => true, 'device' => ['status' => 'Aprobado', 'label' => $row['label']]]);
    if ($row) $pdo->prepare("UPDATE lartisan_attendance_devices SET token_hash=?, label=?, status='Pendiente', requested_by=?, requested_at=NOW(), approved_by=NULL, approved_at=NULL WHERE id=?")->execute([$hash, $label, $user['id'], $row['id']]);
    else $pdo->prepare("INSERT INTO lartisan_attendance_devices (id,site,device_id,token_hash,label,requested_by) VALUES (?,?,?,?,?,?)")->execute([presence_uuid(), $site, $deviceId, $hash, $label, $user['id']]);
    audit($pdo, (int) $user['id'], 'attendance_device_requested', $site . ' · ' . $label);
    json_response(['ok' => true, 'device' => ['status' => 'Pendiente', 'label' => $label]]);
}

if ($method === 'GET' && $route === 'attendance/devices/status') {
    $user = require_user($pdo); ensure_attendance_presence_schema($pdo); $site = trim((string) ($_GET['site'] ?? '')); $deviceId = trim((string) ($_GET['deviceId'] ?? ''));
    if (!user_can_access_site($user, $site) || !preg_match('/^[a-f0-9-]{36}$/i', $deviceId)) json_response(['ok' => false, 'error' => 'Equipo inválido.'], 422);
    $stmt = $pdo->prepare('SELECT status,label FROM lartisan_attendance_devices WHERE site=? AND device_id=? LIMIT 1'); $stmt->execute([$site, $deviceId]); $row = $stmt->fetch();
    json_response(['ok' => true, 'device' => $row ? ['status' => (string) $row['status'], 'label' => (string) $row['label']] : null]);
}

// Las excepciones de presencia se revisan en Supervisión. La habilitación
// "Personal" identifica a las supervisoras responsables (hoy Betzi y Andrea)
// sin convertir a Administración en aprobadora de sus propios fichajes.
function can_resolve_attendance_exceptions(array $user): bool
{
    return ($user['role'] ?? '') === 'supervisora' && user_can_report($user, 'Personal');
}

// Solo las supervisoras habilitadas para Personal (Betzi y Andrea actualmente)
// pueden confiar o revocar una computadora fija. Administración conserva la
// auditoría, pero no reemplaza la validación operativa del local.
if ($method === 'GET' && $route === 'attendance/devices/review') {
    $reviewer = require_user($pdo); ensure_attendance_presence_schema($pdo);
    if (!can_resolve_attendance_exceptions($reviewer)) json_response(['ok' => false, 'error' => 'Solo Supervisión autorizada puede revisar computadoras de fichaje.'], 403);
    $rows = $pdo->query("SELECT d.id,d.site,d.label,d.status,d.requested_at,u.full_name FROM lartisan_attendance_devices d JOIN users u ON u.id=d.requested_by ORDER BY d.requested_at DESC LIMIT 200")->fetchAll();
    $rows = array_values(array_filter($rows, static fn (array $row): bool => user_can_access_site($reviewer, (string) $row['site'])));
    json_response(['ok' => true, 'devices' => $rows]);
}

if ($method === 'POST' && preg_match('#^attendance/devices/([a-f0-9-]{36})/(approve|revoke)$#i', $route, $matches)) {
    $reviewer = require_user($pdo); ensure_attendance_presence_schema($pdo);
    if (!can_resolve_attendance_exceptions($reviewer)) json_response(['ok' => false, 'error' => 'Solo Supervisión autorizada puede resolver computadoras de fichaje.'], 403);
    $lookup = $pdo->prepare('SELECT site FROM lartisan_attendance_devices WHERE id=? LIMIT 1'); $lookup->execute([$matches[1]]); $device = $lookup->fetch();
    if (!$device) json_response(['ok' => false, 'error' => 'Equipo inexistente.'], 404);
    if (!user_can_access_site($reviewer, (string) $device['site'])) json_response(['ok' => false, 'error' => 'No tenés acceso a este local.'], 403);
    $status = strtolower($matches[2]) === 'approve' ? 'Aprobado' : 'Revocado';
    $stmt = $pdo->prepare('UPDATE lartisan_attendance_devices SET status=?, approved_by=?, approved_at=NOW() WHERE id=?'); $stmt->execute([$status, $reviewer['id'], $matches[1]]);
    audit($pdo, (int) $reviewer['id'], $status === 'Aprobado' ? 'attendance_device_approved' : 'attendance_device_revoked', $matches[1]); json_response(['ok' => true]);
}

if ($method === 'GET' && $route === 'admin/attendance/devices') {
    require_user($pdo, ['administracion']); ensure_attendance_presence_schema($pdo);
    $rows = $pdo->query("SELECT d.id,d.site,d.label,d.status,d.requested_at,u.full_name FROM lartisan_attendance_devices d JOIN users u ON u.id=d.requested_by ORDER BY d.requested_at DESC LIMIT 200")->fetchAll();
    json_response(['ok' => true, 'devices' => $rows]);
}

// Administración conserva la consulta y auditoría, pero no puede resolver.
if ($method === 'GET' && $route === 'admin/attendance/exceptions') {
    require_user($pdo, ['administracion']); ensure_attendance_presence_schema($pdo);
    $rows = $pdo->query("SELECT e.*, u.full_name FROM lartisan_attendance_exceptions e JOIN users u ON u.id=e.user_id ORDER BY e.requested_at DESC LIMIT 200")->fetchAll();
    json_response(['ok' => true, 'exceptions' => $rows]);
}

if ($method === 'GET' && $route === 'attendance/exceptions') {
    $reviewer = require_user($pdo); ensure_attendance_presence_schema($pdo);
    if (!can_resolve_attendance_exceptions($reviewer)) json_response(['ok' => false, 'error' => 'Solo Supervisión autorizada puede revisar excepciones de fichaje.'], 403);
    $rows = $pdo->query("SELECT e.*, u.full_name FROM lartisan_attendance_exceptions e JOIN users u ON u.id=e.user_id ORDER BY e.requested_at DESC LIMIT 200")->fetchAll();
    $rows = array_values(array_filter($rows, static fn (array $row): bool => user_can_access_site($reviewer, (string) $row['site'])));
    json_response(['ok' => true, 'exceptions' => $rows]);
}

if ($method === 'POST' && preg_match('#^attendance/exceptions/([a-f0-9-]{36})/(approve|reject)$#i', $route, $matches)) {
    $reviewer = require_user($pdo); ensure_operations_schema($pdo); ensure_attendance_presence_schema($pdo);
    if (!can_resolve_attendance_exceptions($reviewer)) json_response(['ok' => false, 'error' => 'Solo Supervisión autorizada puede resolver excepciones de fichaje.'], 403);
    $action = strtolower($matches[2]); $body = request_body(); $note = trim((string) ($body['note'] ?? ''));
    $pdo->beginTransaction();
    try {
        $lookup = $pdo->prepare('SELECT e.*, u.full_name FROM lartisan_attendance_exceptions e JOIN users u ON u.id=e.user_id WHERE e.id=? FOR UPDATE'); $lookup->execute([$matches[1]]); $exception = $lookup->fetch();
        if (!$exception) throw new RuntimeException('Excepción inexistente.');
        if (!user_can_access_site($reviewer, (string) $exception['site'])) throw new RuntimeException('No tenés acceso al local de esta excepción.');
        if ($exception['status'] !== 'Pendiente') { $pdo->commit(); json_response(['ok' => true, 'alreadyResolved' => true]); }
        if ($action === 'approve') {
            $recordUser = ['id' => (int) $exception['user_id'], 'full_name' => (string) $exception['full_name']];
            attendance_append_to_locked_state($pdo, (string) $exception['site'], $recordUser, (string) $exception['kind'], ['presenceStatus' => 'Excepción aprobada', 'attendanceExceptionId' => (string) $exception['id']]);
        }
        $pdo->prepare('UPDATE lartisan_attendance_exceptions SET status=?, resolved_at=NOW(), resolved_by=?, resolution_note=? WHERE id=?')->execute([$action === 'approve' ? 'Aprobada' : 'Rechazada', $reviewer['id'], $note ?: null, $exception['id']]);
        audit($pdo, (int) $reviewer['id'], $action === 'approve' ? 'attendance_exception_approved' : 'attendance_exception_rejected', $exception['site'] . ' · ' . $exception['kind']);
        $pdo->commit(); json_response(['ok' => true]);
    } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
}

// Horarios versionados: Supervisión administra solo sus locales y Administración
// conserva la visión total. Nunca se reemplaza una versión anterior: se cierra
// su vigencia el día previo y el informe puede reconstruir cualquier período.
if ($method === 'GET' && $route === 'attendance/schedule-users') {
    $scheduleUser = require_user($pdo); ensure_attendance_presence_schema($pdo);
    if (($scheduleUser['role'] ?? '') !== 'administracion' && (($scheduleUser['role'] ?? '') !== 'supervisora' || !user_can_report($scheduleUser, 'Personal'))) json_response(['ok' => false, 'error' => 'No tenés permiso para gestionar horarios.'], 403);
    $rows = $pdo->query("SELECT id, full_name, role, active, assigned_locations, access_all_locations FROM users WHERE active=1 ORDER BY full_name")->fetchAll();
    $users = [];
    foreach ($rows as $row) {
        $profile = ['id'=>(int)$row['id'], 'full_name'=>(string)$row['full_name'], 'role'=>(string)$row['role'], 'active'=>(bool)$row['active'], 'assigned_locations'=>$row['assigned_locations'] ?? '[]', 'access_all_locations'=>(bool)$row['access_all_locations']];
        $locations = ($scheduleUser['role'] ?? '') === 'administracion' ? operational_sites() : array_values(array_filter(operational_sites(), static fn(string $site): bool => user_can_access_site($scheduleUser, $site) && user_can_access_site($profile, $site)));
        if ($locations) $users[] = ['id'=>(int)$row['id'], 'name'=>(string)$row['full_name'], 'role'=>(string)$row['role'], 'sites'=>$locations];
    }
    json_response(['ok'=>true,'users'=>$users]);
}

// Alta acotada para el personal que únicamente fichará. Supervisión puede
// gestionar su propia dotación, sin recibir permisos para crear cuentas de
// Administración ni de Compras.
if ($method === 'GET' && $route === 'attendance/personnel') {
    $manager = require_user($pdo); ensure_attendance_presence_schema($pdo);
    if (($manager['role'] ?? '') !== 'administracion' && (($manager['role'] ?? '') !== 'supervisora' || !user_can_report($manager, 'Personal'))) json_response(['ok'=>false,'error'=>'No tenés permiso para gestionar personal.'],403);
    $rows = $pdo->query("SELECT id,full_name,username,role,job_title,assigned_locations,assigned_location,active FROM users WHERE active=1 ORDER BY full_name")->fetchAll();
    $out=[]; foreach($rows as $row){ if (($manager['role'] ?? '') !== 'administracion' && !array_intersect(assigned_locations($manager), assigned_locations($row))) continue; $out[]=['id'=>(int)$row['id'],'name'=>$row['full_name'],'username'=>$row['username'],'role'=>$row['role'],'jobTitle'=>$row['job_title'],'sites'=>assigned_locations($row)]; }
    json_response(['ok'=>true,'personnel'=>$out]);
}

if ($method === 'POST' && $route === 'attendance/personnel') {
    $manager = require_user($pdo); ensure_attendance_presence_schema($pdo); $body=request_body();
    if (($manager['role'] ?? '') !== 'administracion' && (($manager['role'] ?? '') !== 'supervisora' || !user_can_report($manager, 'Personal'))) json_response(['ok'=>false,'error'=>'No tenés permiso para dar de alta personal.'],403);
    $name=trim((string)($body['fullName']??'')); $username=mb_strtolower(trim((string)($body['username']??'')),'UTF-8'); $password=(string)($body['temporaryPassword']??''); $title=(string)($body['jobTitle']??''); $site=trim((string)($body['site']??''));
    $titles=['jefe_area','cocinero','ayudante_cocina'];
    if ($name==='' || !valid_username($username) || !valid_password($password) || !in_array($title,$titles,true) || !in_array($site,operational_sites(),true)) json_response(['ok'=>false,'error'=>'Revisá nombre, usuario, contraseña, cargo y local.'],422);
    if (($manager['role'] ?? '') !== 'administracion' && !user_can_access_site($manager,$site)) json_response(['ok'=>false,'error'=>'No podés dar de alta personal para ese local.'],403);
    ensure_personnel_files_schema($pdo);
    try {
        $pdo->beginTransaction();
        $stmt=$pdo->prepare("INSERT INTO users (username,full_name,password_hash,role,job_title,assigned_location,assigned_locations,access_all_locations,report_permissions,action_permissions,mfa_required) VALUES (?,?,?,'personal',?,?,?,0,'[]','[]',0)");
        $stmt->execute([$username,$name,password_hash($password,PASSWORD_DEFAULT),$title,$site,json_encode([$site],JSON_UNESCAPED_UNICODE)]);
        $id=(int)$pdo->lastInsertId();
        $fileId=bin2hex(random_bytes(16));
        $pdo->prepare("INSERT INTO lartisan_personnel_files (id,employee_user_id,job_title,assigned_site,status,created_by) VALUES (?,?,?,?, 'activo',?)")->execute([$fileId,$id,$title,$site,(int)$manager['id']]);
        $pdo->commit();
    } catch(PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if ((string)$e->getCode()==='23000') json_response(['ok'=>false,'error'=>'Ese usuario ya existe.'],409);
        throw $e;
    }
    audit($pdo,(int)$manager['id'],'attendance_personnel_created','user_id='.$id.';file_id='.$fileId.';site='.$site.';title='.$title); json_response(['ok'=>true,'id'=>$id,'personnelFileId'=>$fileId],201);
}

if ($method === 'GET' && $route === 'admin/personnel-files') {
    $admin=require_user($pdo,['administracion']); ensure_personnel_files_schema($pdo);
    $rows=$pdo->query("SELECT f.id,f.employee_user_id,f.job_title,f.assigned_site,f.status,f.created_at,f.updated_at,u.full_name,u.username,u.role FROM lartisan_personnel_files f JOIN users u ON u.id=f.employee_user_id ORDER BY u.full_name")->fetchAll();
    json_response(['ok'=>true,'files'=>array_map(static fn($row)=>['id'=>$row['id'],'employeeUserId'=>(int)$row['employee_user_id'],'name'=>$row['full_name'],'username'=>$row['username'],'accessRole'=>$row['role'],'jobTitle'=>$row['job_title'],'site'=>$row['assigned_site'],'status'=>$row['status'],'createdAt'=>$row['created_at'],'updatedAt'=>$row['updated_at']],$rows)]);
}

if ($method === 'GET' && $route === 'attendance/schedules') {
    $scheduleUser = require_user($pdo); ensure_attendance_presence_schema($pdo);
    if (($scheduleUser['role'] ?? '') !== 'administracion' && (($scheduleUser['role'] ?? '') !== 'supervisora' || !user_can_report($scheduleUser, 'Personal'))) json_response(['ok'=>false,'error'=>'No tenés permiso para consultar horarios.'],403);
    $site = trim((string)($_GET['site'] ?? ''));
    if ($site !== '' && !user_can_access_site($scheduleUser, $site)) json_response(['ok'=>false,'error'=>'Local no autorizado.'],403);
    $sql = 'SELECT s.*,u.full_name AS employee_name,c.full_name AS created_by_name FROM lartisan_employee_schedule_versions s JOIN users u ON u.id=s.employee_user_id JOIN users c ON c.id=s.created_by';
    $params=[]; if ($site !== '') { $sql.=' WHERE s.site=?'; $params[]=$site; } elseif (($scheduleUser['role'] ?? '') !== 'administracion') { $allowed=array_values(array_filter(operational_sites(),static fn(string $value): bool=>user_can_access_site($scheduleUser,$value))); if(!$allowed) json_response(['ok'=>true,'schedules'=>[]]); $sql.=' WHERE s.site IN ('.implode(',',array_fill(0,count($allowed),'?')).')'; $params=$allowed; }
    $sql.=' ORDER BY s.site,u.full_name,s.effective_from DESC,s.weekday'; $stmt=$pdo->prepare($sql); $stmt->execute($params);
    json_response(['ok'=>true,'schedules'=>array_map('attendance_schedule_payload',$stmt->fetchAll())]);
}

if ($method === 'POST' && $route === 'attendance/schedules') {
    $scheduleUser=require_user($pdo); ensure_attendance_presence_schema($pdo); $body=request_body();
    if (($scheduleUser['role'] ?? '') !== 'administracion' && (($scheduleUser['role'] ?? '') !== 'supervisora' || !user_can_report($scheduleUser,'Personal'))) json_response(['ok'=>false,'error'=>'No tenés permiso para modificar horarios.'],403);
    $employeeId=filter_var($body['employeeUserId']??null,FILTER_VALIDATE_INT); $site=trim((string)($body['site']??'')); $effective=trim((string)($body['effectiveFrom']??'')); $days=is_array($body['days']??null)?$body['days']:[];
    if ($employeeId===false || $employeeId===null || !user_can_access_site($scheduleUser,$site) || !preg_match('/^\d{4}-\d{2}-\d{2}$/',$effective) || count($days)!==7) json_response(['ok'=>false,'error'=>'Revisá empleado, local, fecha de vigencia y los siete días.'],422);
    try { $effectiveDate=new DateTimeImmutable($effective); } catch(Throwable $error) { json_response(['ok'=>false,'error'=>'Fecha de vigencia inválida.'],422); }
    $employee=$pdo->prepare('SELECT id,full_name,active FROM users WHERE id=?'); $employee->execute([$employeeId]); $employeeRow=$employee->fetch(); if(!$employeeRow || !(bool)$employeeRow['active']) json_response(['ok'=>false,'error'=>'La persona seleccionada no está activa.'],422);
    $normalized=[];
    foreach($days as $day){ $weekday=filter_var($day['weekday']??null,FILTER_VALIDATE_INT); $start=trim((string)($day['startsAt']??'')); $end=trim((string)($day['endsAt']??'')); $tolerance=filter_var($day['toleranceMinutes']??10,FILTER_VALIDATE_INT); if($weekday===false||$weekday<1||$weekday>7||$tolerance===false||$tolerance<0||$tolerance>120||isset($normalized[$weekday])) json_response(['ok'=>false,'error'=>'Configuración semanal inválida.'],422); if(($start===''&&$end!=='')||($start!==''&&$end==='')||($start!==''&&!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/',$start))||($end!==''&&!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/',$end))||($start!==''&&$end<=$start)) json_response(['ok'=>false,'error'=>'Cada día laborable requiere entrada anterior a salida; para franco dejá ambos vacíos.'],422); $normalized[$weekday]=[$start?:null,$end?:null,$tolerance]; }
    $pdo->beginTransaction();
    try {
        foreach($normalized as $weekday=>[$start,$end,$tolerance]){
            // Cierra solo la versión vigente anterior. Una versión futura queda
            // intacta, evitando que editar hoy destruya una planificación ya cargada.
            $previous=$pdo->prepare('SELECT id FROM lartisan_employee_schedule_versions WHERE employee_user_id=? AND site=? AND weekday=? AND effective_from<? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC LIMIT 1 FOR UPDATE'); $previous->execute([$employeeId,$site,$weekday,$effective,$effective]); $row=$previous->fetch();
            if($row) $pdo->prepare('UPDATE lartisan_employee_schedule_versions SET effective_to=DATE_SUB(?, INTERVAL 1 DAY) WHERE id=?')->execute([$effective,$row['id']]);
            $same=$pdo->prepare('SELECT id FROM lartisan_employee_schedule_versions WHERE employee_user_id=? AND site=? AND weekday=? AND effective_from=? FOR UPDATE'); $same->execute([$employeeId,$site,$weekday,$effective]); if($same->fetch()) throw new RuntimeException('Ya existe una versión para esa fecha. Elegí otra fecha de vigencia.');
            // Si ya existe una modificación futura, esta vigencia se cierra el
            // día anterior. Así nunca quedan dos reglas activas para un día.
            $next=$pdo->prepare('SELECT effective_from FROM lartisan_employee_schedule_versions WHERE employee_user_id=? AND site=? AND weekday=? AND effective_from>? ORDER BY effective_from ASC LIMIT 1 FOR UPDATE'); $next->execute([$employeeId,$site,$weekday,$effective]); $future=$next->fetchColumn();
            $endsOn=$future ? (new DateTimeImmutable((string)$future))->modify('-1 day')->format('Y-m-d') : null;
            $pdo->prepare('INSERT INTO lartisan_employee_schedule_versions (id,employee_user_id,site,weekday,starts_at,ends_at,tolerance_minutes,effective_from,effective_to,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')->execute([presence_uuid(),$employeeId,$site,$weekday,$start,$end,$tolerance,$effective,$endsOn,$scheduleUser['id']]);
        }
        audit($pdo,(int)$scheduleUser['id'],'attendance_schedule_version_created',$employeeRow['full_name'].' · '.$site.' · desde '.$effective); $pdo->commit();
    } catch(Throwable $error){if($pdo->inTransaction())$pdo->rollBack(); throw $error;}
    json_response(['ok'=>true]);
}

if ($method === 'GET' && $route === 'attendance/report') {
    $reportUser=require_user($pdo); ensure_operations_schema($pdo); ensure_attendance_presence_schema($pdo);
    if (($reportUser['role'] ?? '') !== 'administracion' && (($reportUser['role'] ?? '') !== 'supervisora' || !user_can_report($reportUser,'Personal'))) json_response(['ok'=>false,'error'=>'No tenés permiso para consultar asistencia.'],403);
    $from=trim((string)($_GET['from']??'')); $to=trim((string)($_GET['to']??'')); $site=trim((string)($_GET['site']??''));
    if(!preg_match('/^\d{4}-\d{2}-\d{2}$/',$from)||!preg_match('/^\d{4}-\d{2}-\d{2}$/',$to)||$from>$to||((strtotime($to)-strtotime($from))/86400)>366) json_response(['ok'=>false,'error'=>'Elegí un intervalo válido de hasta 366 días.'],422);
    if($site!==''&&!user_can_access_site($reportUser,$site))json_response(['ok'=>false,'error'=>'Local no autorizado.'],403);
    $allowed=$site!==''?[$site]:(($reportUser['role']??'')==='administracion'?operational_sites():array_values(array_filter(operational_sites(),static fn(string $value):bool=>user_can_access_site($reportUser,$value))));
    $marks=[]; if($allowed){$stmt=$pdo->prepare('SELECT site,state_json FROM operation_site_states WHERE site IN ('.implode(',',array_fill(0,count($allowed),'?')).')');$stmt->execute($allowed);foreach($stmt->fetchAll() as $state){$records=json_decode((string)$state['state_json'],true)['attendanceRecords']??[];foreach(is_array($records)?$records:[] as $record){if(!is_array($record)||empty($record['userId']))continue;$date=attendance_local_date((string)($record['atISO']??''));if($date&&$date>=$from&&$date<=$to)$marks[(int)$record['userId'].'|'.$state['site'].'|'.$date][]=$record;}}}
    $scheduleStmt=$pdo->prepare('SELECT DISTINCT s.employee_user_id,s.site,u.full_name FROM lartisan_employee_schedule_versions s JOIN users u ON u.id=s.employee_user_id WHERE s.site IN ('.implode(',',array_fill(0,count($allowed),'?')).') AND s.effective_from<=? AND (s.effective_to IS NULL OR s.effective_to>=?)');$scheduleStmt->execute(array_merge($allowed,[$to,$from]));
    $rows=[];$period=new DatePeriod(new DateTimeImmutable($from),new DateInterval('P1D'),(new DateTimeImmutable($to))->modify('+1 day'));
    foreach($scheduleStmt->fetchAll() as $person)foreach($period as $day){$date=$day->format('Y-m-d');$schedule=attendance_schedule_for($pdo,(int)$person['employee_user_id'],(string)$person['site'],$date);if(!$schedule||$schedule['starts_at']===null)continue;$key=(int)$person['employee_user_id'].'|'.$person['site'].'|'.$date;$entries=$marks[$key]??[];usort($entries,static fn($a,$b)=>strcmp((string)($a['atISO']??''),(string)($b['atISO']??'')));$in=array_values(array_filter($entries,static fn($item)=>($item['kind']??'')==='Entrada'));$out=array_values(array_filter($entries,static fn($item)=>($item['kind']??'')==='Salida'));$late=null;$early=null;$status='Sin fichaje';if($in){$actual=(new DateTimeImmutable((string)$in[0]['atISO']))->setTimezone(new DateTimeZone('America/Argentina/Buenos_Aires'))->format('H:i');$allowedStart=(new DateTimeImmutable($date.' '.$schedule['starts_at']))->modify('+'.(int)$schedule['tolerance_minutes'].' minutes')->format('H:i');$late=max(0,(strtotime($date.' '.$actual)-strtotime($date.' '.$allowedStart))/60);$status=$out?'Completo':'Salida pendiente';if($out){$actualOut=(new DateTimeImmutable((string)end($out)['atISO']))->setTimezone(new DateTimeZone('America/Argentina/Buenos_Aires'))->format('H:i');$early=max(0,(strtotime($date.' '.$schedule['ends_at'])-strtotime($date.' '.$actualOut))/60);}}$rows[]=['employeeUserId'=>(int)$person['employee_user_id'],'employeeName'=>(string)$person['full_name'],'site'=>(string)$person['site'],'date'=>$date,'expectedIn'=>substr((string)$schedule['starts_at'],0,5),'expectedOut'=>substr((string)$schedule['ends_at'],0,5),'toleranceMinutes'=>(int)$schedule['tolerance_minutes'],'actualIn'=>$in?((new DateTimeImmutable((string)$in[0]['atISO']))->setTimezone(new DateTimeZone('America/Argentina/Buenos_Aires'))->format('H:i')):null,'actualOut'=>$out?((new DateTimeImmutable((string)end($out)['atISO']))->setTimezone(new DateTimeZone('America/Argentina/Buenos_Aires'))->format('H:i')):null,'lateMinutes'=>$late===null?null:(int)round($late),'earlyMinutes'=>$early===null?null:(int)round($early),'status'=>$status];}
    json_response(['ok'=>true,'rows'=>$rows]);
}

// Con una contraseña temporal solo se puede cambiarla (o salir). Antes esto se
// controlaba únicamente en dos rutas y el resto de las escrituras lo permitía.
if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)
    && !in_array($route, ['auth/login', 'auth/logout', 'auth/change-password', 'auth/request-reset', 'auth/confirm-reset-code'], true)) {
    $sessionUser = current_user($pdo);
    if ($sessionUser && !empty($sessionUser['must_change_password'])) {
        json_response(['ok' => false, 'error' => 'Primero debés cambiar la contraseña temporal.'], 403);
    }
}

if ($method === 'GET' && $route === 'admin/arca/status') {
    require_user($pdo, ['administracion']);
    ensure_arca_wsfe_schema($pdo);
    json_response(['ok' => true, 'arca' => arca_wsfe_configuration_status($config)]);
}

// Prueba exclusivamente en homologación: verifica firma y autenticación WSAA.
// No solicita CAE, no crea comprobantes y no toca producción.
if ($method === 'POST' && $route === 'admin/arca/homologation-test') {
    $user = require_user($pdo, ['administracion']);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) {
        json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    }
    ensure_arca_wsfe_schema($pdo);
    try {
        $ticket = arca_wsaa_request_ticket($config);
        $points = arca_wsfe_configuration_status($config)['pointsOfSale'];
        if (!$points) throw new RuntimeException('No hay puntos de venta ARCA configurados.');
        // Consultas de lectura: validan todos los puntos configurados para
        // Factura A y B. No solicitan CAE ni reservan numeración.
        $checks = [];
        foreach ($points as $site => $configuredPoint) {
            $pointOfSale = (int) $configuredPoint;
            foreach ([1 => 'Factura A', 6 => 'Factura B'] as $voucherType => $label) {
                $checks[] = [
                    'site' => (string) $site,
                    'pointOfSale' => $pointOfSale,
                    'voucherType' => $voucherType,
                    'voucherLabel' => $label,
                    'lastVoucherNumber' => arca_wsfe_last_voucher_number($config, $pointOfSale, $voucherType),
                ];
            }
        }
        // El ticket se prueba y se descarta. Persistir token/sign requiere una
        // clave de cifrado separada que todavía no se configuró en el servidor.
        unset($ticket['token'], $ticket['sign']);
        audit($pdo, (int) $user['id'], 'arca_wsaa_homologation_verified', 'wsfe');
        json_response(['ok' => true, 'environment' => 'homologacion', 'ticketExpiresAt' => $ticket['expiresAt'], 'checks' => $checks]);
    } catch (Throwable $error) {
        // Esta ruta está limitada a Administración y no emite comprobantes. Mostrar
        // la causa operativa permite corregir certificados/configuración sin tener
        // que adivinar frente a un mensaje genérico.
        $arcaError = $error->getMessage();
        error_log('LARTISAN ARCA WSAA homologation test failed: ' . $arcaError);
        audit($pdo, (int) $user['id'], 'arca_wsaa_homologation_failed');
        json_response(['ok' => false, 'error' => 'No se pudo validar ARCA en homologación: ' . $arcaError], 422);
    }
}

// Consulta de producción estrictamente de lectura. Valida WSAA y WSFE para
// todos los puntos configurados mediante FECompUltimoAutorizado: no solicita
// CAE, no reserva numeración y no crea comprobantes.
if (in_array($method, ['GET', 'POST'], true) && $route === 'admin/arca/production-preflight') {
    $user = require_user($pdo, ['administracion']);
    // La variante GET se limita a una consulta autenticada de lectura para
    // permitir la verificación operativa desde Administración. POST conserva
    // la protección de origen para cualquier cliente web.
    if ($method === 'POST' && !in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) {
        json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    }
    ensure_arca_wsfe_schema($pdo);
    try {
        $status = arca_wsfe_configuration_status($config);
        if ($status['environment'] !== 'produccion' || !$status['readyForProductionTest']) {
            throw new RuntimeException('Producción no está configurada para una consulta segura.');
        }
        $ticket = arca_wsaa_request_ticket($config);
        $checks = [];
        foreach ($status['pointsOfSale'] as $site => $configuredPoint) {
            foreach ([1 => 'Factura A', 6 => 'Factura B'] as $voucherType => $label) {
                $checks[] = [
                    'site' => (string) $site,
                    'pointOfSale' => (int) $configuredPoint,
                    'voucherType' => $voucherType,
                    'voucherLabel' => $label,
                    'lastVoucherNumber' => arca_wsfe_last_voucher_number($config, (int) $configuredPoint, $voucherType),
                ];
            }
        }
        unset($ticket['token'], $ticket['sign']);
        audit($pdo, (int) $user['id'], 'arca_wsfe_production_preflight_verified', 'read_only');
        json_response(['ok' => true, 'environment' => 'produccion', 'ticketExpiresAt' => $ticket['expiresAt'], 'checks' => $checks, 'message' => 'Consulta de producción validada. No se emitió ningún comprobante.']);
    } catch (Throwable $error) {
        $arcaError = $error->getMessage();
        error_log('LARTISAN ARCA production preflight failed: ' . $arcaError);
        audit($pdo, (int) $user['id'], 'arca_wsfe_production_preflight_failed');
        json_response(['ok' => false, 'error' => 'No se pudo validar ARCA en producción: ' . $arcaError], 422);
    }
}

// Cola interna de preparación fiscal. No emite comprobantes ni llama a ARCA.
if ($method === 'GET' && $route === 'admin/arca/fiscal-documents') {
    require_user($pdo, ['administracion']);
    ensure_arca_wsfe_schema($pdo);
    $rows = $pdo->query('SELECT id, sale_reference, site_name, point_of_sale, voucher_type, voucher_number, cae, cae_expires_on, environment, status, response_summary, created_at, updated_at FROM arca_fiscal_documents ORDER BY updated_at DESC LIMIT 200')->fetchAll();
    json_response(['ok' => true, 'documents' => $rows]);
}

if ($method === 'GET' && $route === 'admin/arca/eligible-sales') {
    require_user($pdo, ['administracion']);
    try {
        ensure_normalized_operations_schema($pdo);
        ensure_arca_wsfe_schema($pdo);
        require_once __DIR__ . '/arca_fiscal_queue.php';

        // Esta consulta sólo usa columnas presentes desde la primera versión de
        // ambas tablas. Así la cola no queda fuera de servicio mientras el
        // servidor completa migraciones no esenciales de datos de cliente.
        // Las notas de crédito usan una referencia distinta a la venta, por lo
        // que no hace falta depender de document_kind para excluirlas.
        $cutover = arca_fiscal_cutover($config);
        if (!$cutover) json_response(['ok' => true, 'sales' => [], 'cutoverRequired' => true]);
        // HEX evita comparar textos con collations históricas distintas entre las
        // tablas importadas y las tablas fiscales nuevas.
        $statement = $pdo->prepare("SELECT s.id,s.site,s.occurred_at,s.net_amount,s.invoice_type,s.customer_name,s.status,d.id AS document_id,d.status AS fiscal_status,d.voucher_number,d.cae FROM lartisan_sales s LEFT JOIN arca_fiscal_documents d ON HEX(d.sale_reference) = HEX(s.id) WHERE s.status='activa' AND s.occurred_at >= ? AND s.invoice_type IN ('Factura A','Factura B','Factura B electrónica') ORDER BY s.occurred_at DESC LIMIT 50");
        $statement->execute([$cutover]);
        json_response(['ok' => true, 'sales' => $statement->fetchAll(), 'cutover' => $cutover]);
    } catch (Throwable $error) {
        error_log('LARTISAN fiscal eligible sales failed: ' . $error->getMessage());
        json_response(['ok' => false, 'error' => 'No se pudo cargar la cola fiscal. Intentá nuevamente o revisá la salud de la API.'], 500);
    }
}

if ($method === 'POST' && $route === 'admin/arca/fiscal-documents/prepare') {
    $user = require_user($pdo, ['administracion']);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) {
        json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    }
    try {
        // Se carga sólo en la operación fiscal: cualquier incompatibilidad futura
        // no puede interrumpir salud, ventas, stock ni el resto de la API.
        require_once __DIR__ . '/arca_fiscal_queue.php';
        $document = arca_prepare_fiscal_document($pdo, $config, (int) $user['id'], request_body());
        audit($pdo, (int) $user['id'], 'arca_fiscal_document_prepared', (string) ($document['sale_reference'] ?? ''));
        json_response(['ok' => true, 'document' => $document, 'message' => 'Comprobante preparado internamente. No se emitió CAE ni se informó a ARCA.']);
    } catch (InvalidArgumentException $error) {
        json_response(['ok' => false, 'error' => $error->getMessage()], 422);
    } catch (PDOException $error) {
        throw $error;
    } catch (RuntimeException $error) {
        // Configuración fiscal faltante: Administración necesita el motivo exacto.
        json_response(['ok' => false, 'error' => $error->getMessage()], 422);
    }
}

if ($method === 'POST' && $route === 'admin/arca/fiscal-documents/issue') {
    $user = require_user($pdo, ['administracion']);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    try {
        require_once __DIR__ . '/arca_fiscal_queue.php';
        $document = arca_issue_fiscal_document($pdo, $config, (int) $user['id'], (int) (request_body()['documentId'] ?? 0));
        audit($pdo, (int) $user['id'], 'arca_fiscal_document_authorized', (string) ($document['id'] ?? ''));
        json_response(['ok' => true, 'document' => $document, 'message' => 'Comprobante autorizado por ARCA con CAE.']);
    } catch (InvalidArgumentException $error) { json_response(['ok' => false, 'error' => $error->getMessage()], 422); }
    catch (PDOException $error) { throw $error; }
    // Incluye "ARCA no confirmó la emisión… pendiente de conciliación": Administración
    // debe verlo para no reintentar un comprobante que ARCA pudo haber autorizado.
    catch (RuntimeException $error) { json_response(['ok' => false, 'error' => $error->getMessage()], 422); }
}

if ($method === 'POST' && $route === 'admin/arca/fiscal-documents/credit-note/prepare') {
    $user = require_user($pdo, ['administracion']);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    try {
        require_once __DIR__ . '/arca_fiscal_queue.php';
        $document = arca_prepare_credit_note($pdo, $config, (int) $user['id'], request_body());
        audit($pdo, (int) $user['id'], 'arca_credit_note_prepared', (string) ($document['id'] ?? ''));
        json_response(['ok' => true, 'document' => $document, 'message' => 'Nota de crédito preparada. Requiere confirmación explícita antes de solicitar CAE.']);
    } catch (InvalidArgumentException $error) { json_response(['ok' => false, 'error' => $error->getMessage()], 422); }
    catch (PDOException $error) { throw $error; }
    catch (RuntimeException $error) { json_response(['ok' => false, 'error' => $error->getMessage()], 422); }
}
$pdo->exec(
    "CREATE TABLE IF NOT EXISTS password_recovery_codes (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        code_hash VARCHAR(255) NOT NULL,
        attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        requested_ip VARCHAR(45) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_recovery_user_created (user_id, created_at),
        INDEX idx_recovery_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
);

if ($method === 'GET' && $route === 'admin/pnl/google-callback') {
    $state = (string) ($_GET['state'] ?? '');
    $code = (string) ($_GET['code'] ?? '');
    $stateHash = hash('sha256', $state);
    ensure_pnl_sync_schema($pdo);
    $lookup = $pdo->prepare('SELECT user_id FROM pnl_oauth_states WHERE state_hash = ? AND expires_at > NOW() LIMIT 1');
    $lookup->execute([$stateHash]);
    $userId = $lookup->fetchColumn();
    $pdo->prepare('DELETE FROM pnl_oauth_states WHERE state_hash = ?')->execute([$stateHash]);
    $success = false;
    $message = 'No se pudo validar la autorización de Google.';
    try {
        if (!$userId || $code === '') throw new RuntimeException($message);
        pnl_exchange_authorization_code($pdo, $config, $code);
        audit($pdo, (int) $userId, 'pnl_google_connected', 'lectura_solo');
        $success = true;
        $message = 'Google quedó conectado con permiso de solo lectura. Ya podés volver a Administración y actualizar el P&L.';
    } catch (Throwable $error) {
        $message = 'No se pudo conectar Google: ' . htmlspecialchars($error->getMessage(), ENT_QUOTES, 'UTF-8');
    }
    http_response_code($success ? 200 : 400);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>L’ARTISAN · P&L</title><body style="font-family:Arial,sans-serif;padding:40px;color:#183a67"><h1>' . ($success ? 'Conexión lista' : 'No se pudo completar') . '</h1><p>' . $message . '</p><p><a href="https://admin.lartisantaller.com/">Volver a Administración</a></p></body></html>';
    exit;
}

if ($method === 'GET' && $route === 'admin/pnl/authorization-url') {
    $admin = require_user($pdo, ['administracion']);
    try {
        json_response(['ok' => true, 'authorizationUrl' => pnl_authorization_url($pdo, $config, (int) $admin['id'])]);
    } catch (PDOException $error) {
        throw $error;
    } catch (RuntimeException $error) {
        // Ej.: "La conexión de Google no está configurada todavía."
        json_response(['ok' => false, 'error' => $error->getMessage()], 422);
    }
}

// La autorización de escritura de cierres no comparte el token de lectura de
// P&L. Así se puede revocar una sin afectar la otra y nunca se amplían
// silenciosamente permisos que Administración no aprobó.
if ($method === 'GET' && $route === 'admin/cash-sheets/google-callback') {
    $state = (string) ($_GET['state'] ?? '');
    $code = (string) ($_GET['code'] ?? '');
    ensure_cash_sheet_sync_schema($pdo);
    $lookup = $pdo->prepare('SELECT user_id FROM cash_sheet_oauth_states WHERE state_hash = ? AND expires_at > NOW() LIMIT 1');
    $lookup->execute([hash('sha256', $state)]);
    $userId = $lookup->fetchColumn();
    $pdo->prepare('DELETE FROM cash_sheet_oauth_states WHERE state_hash = ?')->execute([hash('sha256', $state)]);
    $success = false;
    $message = 'No se pudo validar la autorización de Google Sheets.';
    try {
        if (!$userId || $code === '') throw new RuntimeException($message);
        cash_sheet_exchange_authorization_code($pdo, $config, $code);
        audit($pdo, (int) $userId, 'cash_sheets_google_connected', 'escritura_cierres');
        $success = true;
        $message = 'Google Sheets quedó conectado para los cierres. Volvé a Administración para hacer la prueba controlada.';
    } catch (Throwable $error) {
        $message = 'No se pudo conectar Google Sheets: ' . htmlspecialchars($error->getMessage(), ENT_QUOTES, 'UTF-8');
    }
    http_response_code($success ? 200 : 400);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>L’ARTISAN · Google Sheets</title><body style="font-family:Arial,sans-serif;padding:40px;color:#183a67"><h1>' . ($success ? 'Conexión lista' : 'No se pudo completar') . '</h1><p>' . $message . '</p><p><a href="https://admin.lartisantaller.com/">Volver a Administración</a></p></body></html>';
    exit;
}

if ($method === 'GET' && $route === 'admin/cash-sheets/status') {
    require_user($pdo, ['administracion']);
    ensure_cash_sheet_sync_schema($pdo);
    $locations = is_array($config['cash_sheet_sync']['locations'] ?? null) ? $config['cash_sheet_sync']['locations'] : [];
    $configured = [];
    foreach (operational_sites() as $site) {
        $item = $locations[$site] ?? [];
        $configured[$site] = is_array($item) && trim((string) ($item['spreadsheet_id'] ?? '')) !== '' && trim((string) ($item['sheet'] ?? '')) !== '';
    }
    $last = $pdo->query("SELECT site,status,business_date,sheet_name,target_row,finished_at,error_message FROM cash_sheet_sync_runs ORDER BY started_at DESC LIMIT 20")->fetchAll();
    json_response(['ok' => true, 'provider' => cash_sheet_provider($config), 'connected' => cash_sheet_is_connected($pdo, $config), 'configured' => $configured, 'lastRuns' => $last]);
}

if ($method === 'GET' && $route === 'admin/cash-sheets/authorization-url') {
    $admin = require_user($pdo, ['administracion']);
    if (cash_sheet_provider($config) === 'apps_script') {
        json_response(['ok' => false, 'error' => 'La integración usa Apps Script. Publicá el script con el dueño de las planillas y configurá su URL segura en el servidor.'], 409);
    }
    try {
        json_response(['ok' => true, 'authorizationUrl' => cash_sheet_authorization_url($pdo, $config, (int) $admin['id'])]);
    } catch (RuntimeException $error) {
        json_response(['ok' => false, 'error' => $error->getMessage()], 422);
    }
}

// Fecha operativa de prueba: sólo Administración puede habilitarla y su
// alcance no es configurable desde el navegador. La lectura está autenticada
// para que Ventas pueda representar la misma fecha que validará la API.
if ($method === 'GET' && $route === 'operations/test-operating-date') {
    require_user($pdo);
    json_response(['ok' => true, 'testOperatingDate' => test_operating_date_public_payload($pdo)]);
}

if ($method === 'POST' && $route === 'admin/test-operating-date/enable') {
    $admin = require_user($pdo, ['administracion']);
    $input = request_body();
    $site = trim((string) ($input['site'] ?? ''));
    $businessDate = trim((string) ($input['businessDate'] ?? ''));
    $label = trim((string) ($input['label'] ?? ''));
    $purpose = trim((string) ($input['purpose'] ?? ''));
    validate_test_operating_date_scope($site, $businessDate, $label);
    if ($purpose === '' || mb_strlen($purpose) > 500) {
        json_response(['ok' => false, 'error' => 'Indicá el motivo auditado de la prueba.'], 422);
    }
    ensure_test_operating_date_schema($pdo);
    $active = active_test_operating_date($pdo);
    if ($active !== null) {
        if ((string) $active['site'] !== $site || (string) $active['business_date'] !== $businessDate) {
            json_response(['ok' => false, 'error' => 'Ya existe una ventana de prueba activa; cerrala antes de habilitar otra.'], 409);
        }
        json_response(['ok' => true, 'testOperatingDate' => test_operating_date_public_payload($pdo)]);
    }
    $pdo->prepare("INSERT INTO test_operating_date_runs (site,business_date,label,purpose,status,enabled_by) VALUES (?,?,?,?,'active',?)")
        ->execute([$site, $businessDate, $label, $purpose, (int) $admin['id']]);
    audit($pdo, (int) $admin['id'], 'test_operating_date_enabled', $site . ' · ' . $businessDate . ' · ' . $label . ' · ' . mb_substr($purpose, 0, 300));
    json_response(['ok' => true, 'testOperatingDate' => test_operating_date_public_payload($pdo)]);
}

if ($method === 'POST' && $route === 'admin/test-operating-date/disable') {
    $admin = require_user($pdo, ['administracion']);
    ensure_test_operating_date_schema($pdo);
    $active = active_test_operating_date($pdo);
    if ($active !== null) {
        $pdo->prepare("UPDATE test_operating_date_runs SET status='disabled',disabled_by=?,disabled_at=NOW() WHERE id=? AND status='active'")
            ->execute([(int) $admin['id'], (int) $active['id']]);
        audit($pdo, (int) $admin['id'], 'test_operating_date_disabled', (string) $active['site'] . ' · ' . (string) $active['business_date'] . ' · ' . (string) $active['label']);
    }
    json_response(['ok' => true, 'testOperatingDate' => ['active' => false]]);
}

if ($method === 'POST' && $route === 'cash-sheets/close') {
    $user = require_user($pdo);
    try {
        $result = cash_sheet_sync_close($pdo, $config, $user, request_body());
        json_response(['ok' => true, 'sync' => $result]);
    } catch (InvalidArgumentException $error) {
        json_response(['ok' => false, 'error' => $error->getMessage()], 422);
    } catch (RuntimeException $error) {
        error_log('LARTISAN cash-sheet sync failed: ' . $error->getMessage());
        json_response(['ok' => false, 'error' => $error->getMessage()], 503);
    }
}

if ($method === 'POST' && $route === 'cash-sheets/adjustment') {
    $user = require_user($pdo);
    try {
        $result = cash_sheet_sync_adjustment($pdo, $config, $user, request_body());
        json_response(['ok' => true, 'sync' => $result]);
    } catch (InvalidArgumentException $error) {
        json_response(['ok' => false, 'error' => $error->getMessage()], 422);
    } catch (RuntimeException $error) {
        error_log('LARTISAN cash-sheet adjustment failed: ' . $error->getMessage());
        json_response(['ok' => false, 'error' => $error->getMessage()], 503);
    }
}

if ($method === 'GET' && $route === 'admin/pnl/latest') {
    require_user($pdo, ['administracion']);
    ensure_pnl_sync_schema($pdo);
    $latest = $pdo->query("SELECT rows_imported, payload_json, started_at, finished_at FROM pnl_sync_runs WHERE status = 'verified' ORDER BY id DESC LIMIT 1")->fetch();
    $connected = pnl_is_connected($pdo, $config);
    json_response([
        'ok' => true,
        'connected' => $connected,
        'snapshot' => $latest ? [
            'rows' => json_decode((string) $latest['payload_json'], true) ?: [],
            'rowsImported' => (int) $latest['rows_imported'],
            'updatedAt' => $latest['finished_at'] ?: $latest['started_at'],
        ] : null,
    ]);
}

if ($method === 'POST' && $route === 'admin/pnl/sync') {
    $admin = require_user($pdo, ['administracion']);
    ensure_pnl_sync_schema($pdo);
    $last = $pdo->query("SELECT started_at FROM pnl_sync_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE) ORDER BY id DESC LIMIT 1")->fetchColumn();
    if ($last) json_response(['ok' => false, 'error' => 'Esperá un minuto antes de volver a sincronizar.'], 429);
    $sheetId = trim((string) ($config['pnl_sync']['spreadsheet_id'] ?? ''));
    $range = (string) ($config['pnl_sync']['range'] ?? "'P&L Consolidado 2026 COPIA'!A1:AN220");
    if ($sheetId === '') json_response(['ok' => false, 'error' => 'La fuente financiera no está configurada en el servidor'], 503);
    $pdo->prepare("INSERT INTO pnl_sync_runs (status, source_spreadsheet_id, source_range, triggered_by, started_at) VALUES ('running', ?, ?, ?, NOW())")
        ->execute([$sheetId, $range, $admin['id']]);
    $runId = (int) $pdo->lastInsertId();
    try {
        $rows = pnl_fetch_sheet_values($pdo, $config);
        $payload = json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) throw new RuntimeException('No se pudo guardar la copia de lectura del P&L.');
        $pdo->prepare("UPDATE pnl_sync_runs SET status = 'verified', rows_imported = ?, payload_json = ?, payload_hash = ?, finished_at = NOW() WHERE id = ?")
            ->execute([count($rows), $payload, hash('sha256', $payload), $runId]);
        audit($pdo, (int) $admin['id'], 'pnl_synced_from_google', 'filas=' . count($rows));
        json_response(['ok' => true, 'snapshot' => ['rows' => $rows, 'rowsImported' => count($rows), 'updatedAt' => date('Y-m-d H:i:s')]]);
    } catch (Throwable $error) {
        $pdo->prepare("UPDATE pnl_sync_runs SET status = 'failed', error_message = ?, finished_at = NOW() WHERE id = ?")
            ->execute([substr($error->getMessage(), 0, 1000), $runId]);
        audit($pdo, (int) $admin['id'], 'pnl_sync_failed');
        json_response(['ok' => false, 'error' => 'No se pudo actualizar el P&L. Se conserva la última versión válida.'], 502);
    }
}

if ($method === 'GET' && $route === 'admin/expenses/latest') {
    $admin = require_user($pdo, ['administracion']);
    ensure_expense_sync_schema($pdo);
    $latest = $pdo->query("SELECT rows_imported, payload_json, started_at, finished_at FROM expense_sync_runs WHERE status = 'verified' ORDER BY id DESC LIMIT 1")->fetch();
    $connected = pnl_is_connected($pdo, $config);
    $lastUpdate = $latest ? ($latest['finished_at'] ?: $latest['started_at']) : null;
    $stale = !$lastUpdate || strtotime((string) $lastUpdate) < (time() - 15 * 60);
    // Evita lecturas simultáneas desde varias pestañas y reintentos continuos
    // si Drive devuelve un error. Administración conserva "Actualizar ahora".
    $recentAttempt = $pdo->query("SELECT started_at FROM expense_sync_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE) ORDER BY id DESC LIMIT 1")->fetchColumn();
    if ($connected && $stale && !$recentAttempt) {
        try {
            expense_sync_from_google($pdo, $config, (int) $admin['id']);
            $latest = $pdo->query("SELECT rows_imported, payload_json, started_at, finished_at FROM expense_sync_runs WHERE status = 'verified' ORDER BY id DESC LIMIT 1")->fetch();
        } catch (Throwable $error) {
            error_log('LARTISAN automatic expense sync failed: ' . $error->getMessage());
        }
    }
    json_response([
        'ok' => true,
        'connected' => $connected,
        'snapshot' => $latest ? [
            'data' => json_decode((string) $latest['payload_json'], true) ?: [],
            'rowsImported' => (int) $latest['rows_imported'],
            'updatedAt' => $latest['finished_at'] ?: $latest['started_at'],
        ] : null,
    ]);
}

if ($method === 'POST' && $route === 'admin/expenses/sync') {
    $admin = require_user($pdo, ['administracion']);
    ensure_expense_sync_schema($pdo);
    $last = $pdo->query("SELECT started_at FROM expense_sync_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE) ORDER BY id DESC LIMIT 1")->fetchColumn();
    if ($last) json_response(['ok' => false, 'error' => 'Esperá un minuto antes de volver a sincronizar.'], 429);
    try {
        json_response(['ok' => true, 'snapshot' => expense_sync_from_google($pdo, $config, (int) $admin['id'])]);
    } catch (Throwable $error) {
        json_response(['ok' => false, 'error' => 'No se pudieron actualizar gastos y cuentas por pagar. Se conserva la última versión válida.'], 502);
    }
}

if ($method === 'GET' && $route === 'mrp/latest') {
    $mrpUser = require_mrp_user($pdo);
    ensure_mrp_schema($pdo);
    $latest = $pdo->query("SELECT payload_json, rows_imported, started_at, finished_at FROM mrp_sync_runs WHERE status='verified' ORDER BY id DESC LIMIT 1")->fetch();
    // Reading the catalog never triggers imports, OAuth or background replacement.
    $lastAttempt = $pdo->query("SELECT id, status, error_message, started_at FROM mrp_sync_runs ORDER BY id DESC LIMIT 1")->fetch();
    $review = $pdo->query('SELECT required_review, recipe_key, changed_at FROM mrp_recipe_review_state WHERE id=1')->fetch();
    $data = $latest ? mrp_apply_actual_stock($pdo, mrp_apply_recipe_overrides($pdo, json_decode((string) $latest['payload_json'], true) ?: [])) : null;
    if ($data && $review && (int) $review['required_review'] === 1) $data['recipeReview'] = ['required' => true, 'recipeKey' => $review['recipe_key'], 'changedAt' => $review['changed_at']];
    json_response(['ok' => true, 'importMode' => 'one_time_file',
        'canImport' => $mrpUser['role'] === 'administracion',
        'lastAttempt' => $lastAttempt ? ['id' => $lastAttempt['id'], 'status' => $lastAttempt['status'], 'startedAt' => $lastAttempt['started_at']] : null,
        'snapshot' => $latest ? [
        'data' => $data,
        'rowsImported' => (int) $latest['rows_imported'],
        'updatedAt' => $latest['finished_at'] ?: $latest['started_at'],
    ] : null, 'canEditRecipes' => mrp_can_edit_recipes($mrpUser)]);
}

if ($method === 'GET' && $route === 'mrp/recipes/history') {
    require_mrp_user($pdo); ensure_mrp_schema($pdo);
    $rows = $pdo->query("SELECT l.recipe_key, l.before_json, l.after_json, l.changed_at, COALESCE(NULLIF(u.full_name, ''), u.username, 'Sistema') AS changed_by
        FROM mrp_recipe_change_log l LEFT JOIN users u ON u.id=l.changed_by ORDER BY l.changed_at DESC, l.id DESC LIMIT 50")->fetchAll();
    $history = array_map(static function (array $row): array {
        $before = $row['before_json'] ? json_decode((string) $row['before_json'], true) : null;
        $after = json_decode((string) $row['after_json'], true) ?: [];
        return ['recipe' => $after['recipe'] ?? $row['recipe_key'], 'changedBy' => $row['changed_by'], 'changedAt' => $row['changed_at'], 'previousCost' => $before['costPerUnit'] ?? null, 'currentCost' => $after['costPerUnit'] ?? null, 'components' => $after['components'] ?? 0];
    }, $rows);
    json_response(['ok' => true, 'history' => $history]);
}

if ($method === 'GET' && $route === 'purchase-costs/catalog') {
    $user = require_user($pdo, ['administracion', 'vendedora', 'supervisora', 'compras']); ensure_mrp_schema($pdo);
    if (!mrp_can_register_production_purchase($user)) json_response(['ok' => false, 'error' => 'Tu usuario no tiene el permiso «Cargar compras de producción» con acceso a Villa Mitre. Pedíselo a Administración.'], 403);
    $latest = $pdo->query("SELECT payload_json FROM mrp_sync_runs WHERE status='verified' ORDER BY id DESC LIMIT 1")->fetchColumn();
    $snapshot = mrp_apply_recipe_overrides($pdo, json_decode((string) $latest, true) ?: []);
    $inputs = array_map(static fn (array $input): array => ['key' => mrp_key($input['item'] ?? ''), 'name' => (string) ($input['item'] ?? ''), 'unit' => (string) ($input['unit'] ?? $input['stockUnit'] ?? 'unidad'), 'unitCost' => $input['unitCost'] ?? null], $snapshot['inputs'] ?? []);
    usort($inputs, static fn (array $a, array $b): int => strnatcasecmp($a['name'], $b['name']));
    $history = $pdo->query("SELECT h.*, COALESCE(NULLIF(u.full_name,''),u.username) AS loaded_by_name FROM mrp_input_cost_history h LEFT JOIN users u ON u.id=h.loaded_by ORDER BY h.created_at DESC, h.id DESC LIMIT 200")->fetchAll();
    $orders = $pdo->query("SELECT id, source_order_id, item_name, provider_name, unit, quantity, status FROM mrp_purchase_orders WHERE status IN ('Por pedir','Pedido','Recibido') ORDER BY created_at DESC LIMIT 300")->fetchAll();
    json_response(['ok' => true, 'inputs' => $inputs, 'history' => $history, 'orders' => $orders, 'canLoad' => true]);
}

if ($method === 'POST' && $route === 'purchase-costs') {
    $user = require_user($pdo, ['administracion', 'vendedora', 'supervisora', 'compras']); ensure_mrp_schema($pdo);
    if (!mrp_can_register_production_purchase($user)) json_response(['ok' => false, 'error' => 'Tu usuario no tiene el permiso «Cargar compras de producción» con acceso a Villa Mitre. Pedíselo a Administración.'], 403);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    $body = request_body(); $provider = mrp_clean_text($body['provider'] ?? '', 190); $invoice = mrp_clean_text($body['invoice'] ?? '', 100); $date = mrp_clean_text($body['purchaseDate'] ?? '', 10); $paymentMethod = mrp_clean_text($body['paymentMethod'] ?? '', 60); $lines = $body['lines'] ?? [];
    if ($provider === '' || $invoice === '' || !preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', $date) || !is_array($lines) || count($lines) < 1 || count($lines) > 100) json_response(['ok' => false, 'error' => 'Indicá fecha, proveedor, factura y al menos un insumo válido.'], 422);
    $latest = $pdo->query("SELECT payload_json FROM mrp_sync_runs WHERE status='verified' ORDER BY id DESC LIMIT 1")->fetchColumn(); $base = json_decode((string) $latest, true) ?: [];
    $known = []; foreach (($base['inputs'] ?? []) as $input) $known[mrp_key($input['item'] ?? '')] = $input;
    $clean = []; foreach ($lines as $line) { $key = mrp_key($line['inputKey'] ?? ''); $quantity = (float) ($line['quantity'] ?? 0); $cost = (float) ($line['unitCost'] ?? 0); $expectedQuantity = ($line['expectedQuantity'] ?? '') === '' ? null : (float) $line['expectedQuantity']; $expectedCost = ($line['expectedUnitCost'] ?? '') === '' ? null : (float) $line['expectedUnitCost']; $orderReference = mrp_clean_text($line['sourceOrderReference'] ?? '', 100); $observations = mrp_clean_text($line['observations'] ?? '', 1000); if (!isset($known[$key]) || !is_finite($quantity) || $quantity <= 0 || !is_finite($cost) || $cost <= 0 || ($expectedQuantity !== null && (!is_finite($expectedQuantity) || $expectedQuantity < 0)) || ($expectedCost !== null && (!is_finite($expectedCost) || $expectedCost <= 0))) json_response(['ok' => false, 'error' => 'Cada línea debe usar un insumo válido, cantidad y costo positivos; los valores esperados deben ser válidos.'], 422); $clean[] = [$key, $quantity, $cost, $expectedQuantity, $expectedCost, $orderReference ?: null, $observations ?: null]; }
    $batch = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x', mt_rand(0,65535), mt_rand(0,65535), mt_rand(0,65535), mt_rand(0,65535), mt_rand(16384,20479), mt_rand(0,65535), mt_rand(0,65535), mt_rand(0,65535)); $warnings = [];
    $pdo->beginTransaction(); try { foreach ($clean as [$key, $quantity, $cost, $expectedQuantity, $expectedCost, $orderReference, $observations]) { $previousStmt=$pdo->prepare('SELECT unit_cost FROM mrp_input_cost_overrides WHERE input_key=?'); $previousStmt->execute([$key]); $previous=$previousStmt->fetchColumn(); if ($previous === false) $previous=$known[$key]['unitCost'] ?? null; $previous=$previous === null ? null : (float)$previous; $warning=$previous && ($cost/$previous >= 2 || $cost/$previous <= .5); if ($warning) $warnings[]=$known[$key]['item'] ?? $key; $unit=mrp_clean_text($known[$key]['unit'] ?? $known[$key]['stockUnit'] ?? 'unidad',40); $differences=[]; if ($expectedQuantity !== null && abs($quantity-$expectedQuantity) > 0.0001) $differences[]='cantidad real distinta a la solicitada'; if ($expectedCost !== null && abs($cost-$expectedCost) > 0.0001) $differences[]='precio real distinto al previsto'; $validation = $expectedQuantity === null && $expectedCost === null ? 'Sin referencia' : ($differences ? 'Con diferencia' : 'Validada'); $reason = $differences ? implode('; ', $differences) : null; $pdo->prepare('INSERT INTO mrp_input_cost_history (batch_id,input_key,input_name,unit,quantity,expected_quantity,previous_unit_cost,expected_unit_cost,new_unit_cost,provider_name,invoice_number,source_order_reference,payment_method,purchase_date,variation_warning,validation_status,difference_reason,observations,loaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([$batch,$key,$known[$key]['item'] ?? $key,$unit,$quantity,$expectedQuantity,$previous,$expectedCost,$cost,$provider,$invoice,$orderReference,$paymentMethod ?: null,$date,$warning?1:0,$validation,$reason,$observations,$user['id']]); $pdo->prepare('INSERT INTO mrp_input_cost_overrides (input_key,unit_cost,updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE unit_cost=VALUES(unit_cost),updated_by=VALUES(updated_by),updated_at=NOW()')->execute([$key,$cost,$user['id']]); } $pdo->prepare('INSERT INTO mrp_recipe_review_state (id,required_review,recipe_key,changed_by,changed_at) VALUES (1,1,?,?,NOW()) ON DUPLICATE KEY UPDATE required_review=1,recipe_key=VALUES(recipe_key),changed_by=VALUES(changed_by),changed_at=NOW()')->execute(['costos-de-insumos',$user['id']]); audit($pdo,(int)$user['id'],'production_purchase_loaded','factura='.$invoice.'; lote='.$batch); $pdo->commit(); } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
    json_response(['ok'=>true,'batchId'=>$batch,'warnings'=>$warnings]);
}

if ($method === 'PUT' && preg_match('#^mrp/recipes/([a-z0-9 -]+)$#i', $route, $matches)) {
    $mrpUser = require_mrp_user($pdo);
    if (!mrp_can_edit_recipes($mrpUser)) json_response(['ok' => false, 'error' => 'Tu usuario no tiene el permiso «Editar recetas y costos». Pedíselo a Administración.'], 403);
    ensure_mrp_schema($pdo);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    $body = request_body(); $key = mrp_key(rawurldecode($matches[1]));
    $name = mrp_clean_text($body['recipe'] ?? '', 190); $yield = (float) ($body['yield'] ?? 0); $items = $body['items'] ?? [];
    if ($key === '' || $name === '' || !is_finite($yield) || $yield <= 0 || !is_array($items) || count($items) < 1 || count($items) > 100) json_response(['ok' => false, 'error' => 'Indicá receta, rendimiento y al menos un componente válido.'], 422);
    $cleanItems = [];
    foreach ($items as $line) {
        $ingredient = mrp_clean_text($line['ingredient'] ?? '', 190); $quantity = (float) ($line['quantity'] ?? 0); $unit = mrp_clean_text($line['unit'] ?? '', 40);
        if ($ingredient === '' || $unit === '' || !is_finite($quantity) || $quantity <= 0) json_response(['ok' => false, 'error' => 'Cada componente requiere insumo, cantidad y unidad válidos.'], 422);
        $cleanItems[] = ['sourceLine' => count($cleanItems) + 1, 'ingredient' => $ingredient, 'quantity' => $quantity, 'unit' => $unit, 'yield' => $yield, 'perUnit' => $quantity / $yield, 'expectedPerUnit' => $quantity / $yield, 'type' => mrp_clean_text($line['type'] ?? 'Insumo', 80), 'dictionaryCheck' => '', 'unitCheck' => ''];
    }
    $latestPayload = $pdo->query("SELECT payload_json FROM mrp_sync_runs WHERE status='verified' ORDER BY id DESC LIMIT 1")->fetchColumn();
    $latestData = json_decode((string) $latestPayload, true) ?: []; $inputCosts = []; $recipeCosts = [];
    foreach (($latestData['inputs'] ?? []) as $input) $inputCosts[mrp_key($input['item'] ?? '')] = $input['unitCost'] ?? null;
    foreach (mrp_apply_recipe_overrides($pdo, $latestData)['recipes'] ?? [] as $known) $recipeCosts[mrp_key($known['recipe'] ?? '')] = $known['costPerUnit'] ?? null;
    $cost = 0.0; $missing = [];
    foreach ($cleanItems as $item) { $componentKey = mrp_key($item['ingredient']); $componentCost = strpos(mrp_lower($item['type']), 'subreceta') !== false ? ($recipeCosts[$componentKey] ?? null) : ($inputCosts[$componentKey] ?? null); if ($componentCost === null || (float) $componentCost <= 0) $missing[] = $item['ingredient']; else $cost += $item['perUnit'] * (float) $componentCost; }
    $recipe = ['sourceKey' => $key, 'recipe' => $name, 'yield' => $yield, 'components' => count($cleanItems), 'costPerUnit' => $missing ? null : round($cost, 4), 'costStatus' => $missing ? 'Pendiente de costo' : 'Calculado', 'missingCosts' => array_values(array_unique($missing)), 'items' => $cleanItems];
    $old = $pdo->prepare('SELECT recipe_json FROM mrp_recipe_overrides WHERE recipe_key=?'); $old->execute([$key]); $before = $old->fetchColumn();
    $json = json_encode($recipe, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO mrp_recipe_overrides (recipe_key,recipe_json,updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE recipe_json=VALUES(recipe_json),updated_by=VALUES(updated_by),updated_at=NOW()')->execute([$key, $json, $mrpUser['id']]);
        $pdo->prepare('INSERT INTO mrp_recipe_change_log (recipe_key,before_json,after_json,changed_by) VALUES (?,?,?,?)')->execute([$key, $before ?: null, $json, $mrpUser['id']]);
        $pdo->prepare('INSERT INTO mrp_recipe_review_state (id,required_review,recipe_key,changed_by,changed_at) VALUES (1,1,?,?,NOW()) ON DUPLICATE KEY UPDATE required_review=1,recipe_key=VALUES(recipe_key),changed_by=VALUES(changed_by),changed_at=NOW()')->execute([$key, $mrpUser['id']]);
        audit($pdo, (int) $mrpUser['id'], 'mrp_recipe_saved', $key); $pdo->commit();
    } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
    json_response(['ok' => true, 'recipe' => $recipe]);
}

if ($method === 'POST' && $route === 'mrp/sync') {
    require_mrp_user($pdo);
    json_response(['ok' => false, 'error' => 'La sincronización MRP fue reemplazada por una importación única desde archivo.'], 409);
}

if ($method === 'POST' && $route === 'mrp/import') {
    $admin = require_user($pdo, ['administracion']);
    // Cookie authentication alone is not a CSRF boundary.
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true))
        json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0)
        json_response(['ok' => false, 'error' => 'Se requiere un archivo JSON.'], 415);
    $raw = file_get_contents('php://input', false, null, 0, 2000001);
    if ($raw === false || strlen($raw) > 2000000) json_response(['ok' => false, 'error' => 'Archivo demasiado grande.'], 413);
    try {
        $bundle = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
        if (!is_array($bundle)) throw new InvalidArgumentException('Archivo inválido.');
        json_response(['ok' => true, 'result' => mrp_import_once($pdo, $bundle, (int) $admin['id'])]);
    } catch (InvalidArgumentException | JsonException $error) {
        json_response(['ok' => false, 'error' => $error->getMessage()], 422);
    } catch (Throwable $error) {
        error_log('LARTISAN one-time MRP import failed: ' . $error->getMessage());
        json_response(['ok' => false, 'error' => 'No se completó la importación. No se guardó una carga parcial.'], 500);
    }
}

if ($method === 'GET' && $route === 'mrp/operations') {
    require_mrp_user($pdo);
    ensure_mrp_schema($pdo);
    $orders = $pdo->query("SELECT o.*, COALESCE(SUM(r.quantity_received),0) AS received_quantity FROM mrp_purchase_orders o LEFT JOIN mrp_receipts r ON r.purchase_order_id=o.id GROUP BY o.id ORDER BY o.created_at DESC LIMIT 200")->fetchAll();
    $controls = $pdo->query("SELECT * FROM mrp_weekly_controls ORDER BY updated_at DESC LIMIT 200")->fetchAll();
    $stocks = $pdo->query("SELECT s.*, COALESCE(NULLIF(u.full_name,''),u.username) AS counted_by_name FROM mrp_input_stock s LEFT JOIN users u ON u.id=s.counted_by ORDER BY s.input_name LIMIT 500")->fetchAll();
    json_response(['ok' => true, 'orders' => $orders, 'controls' => $controls, 'stocks' => $stocks, 'canCountStock' => mrp_can_count_stock(require_mrp_user($pdo))]);
}

if ($method === 'POST' && $route === 'mrp/stock-counts') {
    $mrpUser = require_mrp_user($pdo);
    if (!mrp_can_count_stock($mrpUser)) json_response(['ok' => false, 'error' => 'Tu usuario no tiene el permiso «Contar stock de insumos (MRP)». Pedíselo a Administración.'], 403);
    ensure_mrp_schema($pdo);
    $body = request_body();
    $key = mrp_clean_text($body['inputKey'] ?? '', 190);
    $name = mrp_clean_text($body['inputName'] ?? '', 190);
    $unit = mrp_clean_text($body['unit'] ?? '', 40);
    $actual = (float) ($body['actualQuantity'] ?? -1);
    $notes = mrp_clean_text($body['notes'] ?? '', 1000);
    if ($key === '' || $name === '' || $unit === '' || !is_finite($actual) || $actual < 0) json_response(['ok' => false, 'error' => 'Completá insumo, unidad y stock real válido.'], 422);
    $previousStmt = $pdo->prepare('SELECT actual_quantity FROM mrp_input_stock WHERE input_key=?'); $previousStmt->execute([$key]);
    $previous = $previousStmt->fetchColumn();
    $pdo->beginTransaction(); try {
        $pdo->prepare('INSERT INTO mrp_input_stock (input_key,input_name,unit,actual_quantity,counted_by) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE input_name=VALUES(input_name),unit=VALUES(unit),actual_quantity=VALUES(actual_quantity),counted_by=VALUES(counted_by),counted_at=NOW()')->execute([$key,$name,$unit,$actual,$mrpUser['id']]);
        $pdo->prepare('INSERT INTO mrp_input_stock_history (input_key,input_name,unit,previous_quantity,actual_quantity,notes,counted_by) VALUES (?,?,?,?,?,?,?)')->execute([$key,$name,$unit,$previous === false ? null : $previous,$actual,$notes ?: null,$mrpUser['id']]);
        audit($pdo, (int) $mrpUser['id'], 'mrp_actual_stock_counted', $key . '=' . $actual . ' ' . $unit); $pdo->commit();
    } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
    json_response(['ok' => true]);
}

if ($method === 'POST' && $route === 'mrp/production-runs') {
    $mrpUser = require_mrp_user($pdo); ensure_mrp_schema($pdo); $body = request_body();
    $week = mrp_clean_text($body['weekKey'] ?? '', 20); $recipeKey = mrp_clean_text($body['recipeKey'] ?? '', 190); $quantity = (float) ($body['quantityProduced'] ?? 0); $notes = mrp_clean_text($body['notes'] ?? '', 1000);
    if (!preg_match('/^\d{4}-S\d{1,2}$/', $week) || $recipeKey === '' || !is_finite($quantity) || $quantity <= 0) json_response(['ok'=>false,'error'=>'Indicá semana, receta y producción válida.'],422);
    $latest = $pdo->query("SELECT payload_json FROM mrp_sync_runs WHERE status='verified' ORDER BY id DESC LIMIT 1")->fetchColumn();
    $snapshot = $latest ? mrp_apply_recipe_overrides($pdo, json_decode((string)$latest,true) ?: []) : []; $recipe = null;
    foreach (($snapshot['recipes'] ?? []) as $row) if (($row['sourceKey'] ?? mrp_key($row['recipe'] ?? '')) === $recipeKey) { $recipe=$row; break; }
    if (!$recipe) json_response(['ok'=>false,'error'=>'Receta no encontrada.'],404);
    $pdo->beginTransaction(); try {
        foreach (($recipe['items'] ?? []) as $item) { if (strpos(mrp_lower((string)($item['type'] ?? '')), 'subreceta') !== false) continue; $key=mrp_key($item['ingredient'] ?? ''); $used=(float)($item['perUnit'] ?? 0)*$quantity; if ($key==='' || $used<=0) continue; $st=$pdo->prepare('SELECT actual_quantity,input_name,unit FROM mrp_input_stock WHERE input_key=? FOR UPDATE'); $st->execute([$key]); $current=$st->fetch(); if (!$current) continue; $after=max(0,(float)$current['actual_quantity']-$used); $pdo->prepare('UPDATE mrp_input_stock SET actual_quantity=?,counted_by=?,counted_at=NOW() WHERE input_key=?')->execute([$after,$mrpUser['id'],$key]); $pdo->prepare('INSERT INTO mrp_input_stock_history (input_key,input_name,unit,previous_quantity,actual_quantity,notes,counted_by) VALUES (?,?,?,?,?,?,?)')->execute([$key,$current['input_name'],$current['unit'],$current['actual_quantity'],$after,'Consumo producción: '.($recipe['recipe'] ?? $recipeKey),$mrpUser['id']]); }
        $pdo->prepare('INSERT INTO mrp_production_runs (week_key,recipe_key,recipe_name,quantity_produced,notes,produced_by) VALUES (?,?,?,?,?,?)')->execute([$week,$recipeKey,$recipe['recipe'],$quantity,$notes ?: null,$mrpUser['id']]); audit($pdo,(int)$mrpUser['id'],'mrp_production_confirmed',$recipeKey.'='.$quantity); $pdo->commit();
    } catch(Throwable $error){if($pdo->inTransaction())$pdo->rollBack();throw $error;} json_response(['ok'=>true],201);
}

if ($method === 'POST' && $route === 'mrp/orders') {
    $mrpUser = require_mrp_user($pdo);
    $body = request_body();
    $item = mrp_clean_text($body['itemName'] ?? '', 190);
    $provider = mrp_clean_text($body['providerName'] ?? '', 190);
    $unit = mrp_clean_text($body['unit'] ?? '', 40);
    $quantity = (float) ($body['quantity'] ?? 0);
    $notes = mrp_clean_text($body['notes'] ?? '', 1000);
    if ($item === '' || $unit === '' || !is_finite($quantity) || $quantity <= 0) json_response(['ok' => false, 'error' => 'Completá insumo, unidad y una cantidad válida.'], 422);
    $pdo->prepare('INSERT INTO mrp_purchase_orders (item_name, provider_name, unit, quantity, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$item, $provider ?: null, $unit, $quantity, $notes ?: null, $mrpUser['id']]);
    $id = (int) $pdo->lastInsertId();
    audit($pdo, (int) $mrpUser['id'], 'mrp_purchase_order_created', 'order_id=' . $id);
    json_response(['ok' => true, 'id' => $id], 201);
}

if ($method === 'PATCH' && preg_match('#^mrp/orders/(\d+)$#', $route, $matches)) {
    $mrpUser = require_mrp_user($pdo);
    $body = request_body();
    $id = (int) $matches[1];
    $version = (int) ($body['rowVersion'] ?? 0);
    $status = mrp_clean_text($body['status'] ?? '', 30);
    if (!in_array($status, ['Por pedir', 'Pedido', 'Recibido', 'Cancelado'], true) || $version < 1) json_response(['ok' => false, 'error' => 'Estado o versión inválida.'], 422);
    $stmt = $pdo->prepare('UPDATE mrp_purchase_orders SET status=?, row_version=row_version+1 WHERE id=? AND row_version=?');
    $stmt->execute([$status, $id, $version]);
    if ($stmt->rowCount() !== 1) json_response(['ok' => false, 'error' => 'Otro usuario actualizó esta orden. Volvé a cargarla.'], 409);
    audit($pdo, (int) $mrpUser['id'], 'mrp_purchase_order_updated', 'order_id=' . $id);
    json_response(['ok' => true, 'rowVersion' => $version + 1]);
}

if ($method === 'POST' && preg_match('#^mrp/orders/(\d+)/receipts$#', $route, $matches)) {
    $mrpUser = require_mrp_user($pdo);
    $orderId = (int) $matches[1];
    $body = request_body();
    $quantity = (float) ($body['quantityReceived'] ?? 0);
    $notes = mrp_clean_text($body['notes'] ?? '', 1000);
    if (!is_finite($quantity) || $quantity <= 0) json_response(['ok' => false, 'error' => 'Indicá una cantidad recibida válida.'], 422);
    $exists = $pdo->prepare('SELECT id FROM mrp_purchase_orders WHERE id=?');
    $exists->execute([$orderId]);
    if (!$exists->fetchColumn()) json_response(['ok' => false, 'error' => 'Orden no encontrada.'], 404);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO mrp_receipts (purchase_order_id, quantity_received, notes, received_by) VALUES (?, ?, ?, ?)')
            ->execute([$orderId, $quantity, $notes ?: null, $mrpUser['id']]);
        $pdo->prepare("UPDATE mrp_purchase_orders o SET status=IF((SELECT COALESCE(SUM(quantity_received),0) FROM mrp_receipts WHERE purchase_order_id=o.id)>=o.quantity,'Recibido','Pedido'), row_version=row_version+1 WHERE id=?")
            ->execute([$orderId]);
        audit($pdo, (int) $mrpUser['id'], 'mrp_receipt_recorded', 'order_id=' . $orderId);
        $pdo->commit();
    } catch (Throwable $error) { $pdo->rollBack(); throw $error; }
    json_response(['ok' => true], 201);
}

if ($method === 'POST' && $route === 'mrp/controls') {
    $mrpUser = require_mrp_user($pdo);
    $body = request_body();
    $week = mrp_clean_text($body['weekKey'] ?? '', 20);
    $item = mrp_clean_text($body['itemName'] ?? '', 190);
    $expected = (float) ($body['expectedQuantity'] ?? 0);
    $actual = (float) ($body['actualQuantity'] ?? 0);
    $notes = mrp_clean_text($body['notes'] ?? '', 1000);
    if (!preg_match('/^\d{4}-S\d{1,2}$/', $week) || $item === '' || !is_finite($expected) || !is_finite($actual) || $expected < 0 || $actual < 0) json_response(['ok' => false, 'error' => 'Control semanal inválido.'], 422);
    $difference = $actual - $expected;
    $status = abs($difference) < 0.0001 ? 'OK' : ($difference > 0 ? 'Comprado de más' : 'Comprado de menos');
    $pdo->prepare("INSERT INTO mrp_weekly_controls (week_key,item_name,expected_quantity,actual_quantity,status,notes,updated_by) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE expected_quantity=VALUES(expected_quantity),actual_quantity=VALUES(actual_quantity),status=VALUES(status),notes=VALUES(notes),updated_by=VALUES(updated_by),row_version=row_version+1")
        ->execute([$week, $item, $expected, $actual, $status, $notes ?: null, $mrpUser['id']]);
    audit($pdo, (int) $mrpUser['id'], 'mrp_weekly_control_updated', $week . ' ' . $item);
    json_response(['ok' => true, 'status' => $status]);
}

if ($method === 'POST' && $route === 'auth/login') {
    $body = request_body();
    $username = mb_strtolower(trim((string) ($body['username'] ?? '')), 'UTF-8');
    $password = (string) ($body['password'] ?? '');
    if ($username === '' || $password === '') {
        json_response(['ok' => false, 'error' => 'Usuario y contraseña son obligatorios'], 422);
    }

    $stmt = $pdo->prepare('SELECT * FROM users WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);
    $user = $stmt->fetch();
    $locked = $user && $user['locked_until'] && strtotime($user['locked_until']) > time();
    if (!$user || !(bool) $user['active'] || $locked || !password_verify($password, $user['password_hash'])) {
        if ($user && !$locked) {
            $attempts = (int) $user['failed_attempts'] + 1;
            $lockUntil = $attempts >= 5 ? date('Y-m-d H:i:s', time() + 15 * 60) : null;
            $pdo->prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
                ->execute([$attempts, $lockUntil, $user['id']]);
            audit($pdo, (int) $user['id'], 'login_failed');
        } else {
            audit($pdo, null, 'login_failed', $username);
        }
        json_response(['ok' => false, 'error' => 'Credenciales inválidas'], 401);
    }

    $pdo->prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?')->execute([$user['id']]);
    create_session($pdo, (int) $user['id'], $config);
    audit($pdo, (int) $user['id'], 'login_success');
    json_response(['ok' => true, 'user' => public_user($user, $config)]);
}

if ($method === 'POST' && $route === 'auth/logout') {
    $user = current_user($pdo);
    clear_session($pdo, $config);
    audit($pdo, $user ? (int) $user['id'] : null, 'logout');
    json_response(['ok' => true]);
}

if ($method === 'GET' && $route === 'auth/me') {
    $user = require_user($pdo);
    json_response(['ok' => true, 'user' => public_user($user, $config)]);
}

// Chat interno: cada lectura y escritura vuelve a comprobar la participación
// en el servidor. No hay rutas públicas ni enlaces que concedan acceso.
if (str_starts_with($route, 'chat')) {
    $chatUser = require_user($pdo);
    ensure_internal_chat_schema($pdo);
    chat_ensure_default_groups($pdo);
    if ($method === 'GET' && preg_match('#^chat/attachments/([a-f0-9]{32})$#', $route, $matches)) {
        chat_serve_attachment($pdo, $chatUser, $matches[1]);
    }
    if ($method === 'GET' && $route === 'chat/bootstrap') {
        $settings = $pdo->prepare('SELECT sound_enabled,desktop_enabled,push_enabled FROM internal_chat_settings WHERE user_id=?');
        $settings->execute([(int) $chatUser['id']]); $row = $settings->fetch() ?: ['sound_enabled' => 1, 'desktop_enabled' => 0, 'push_enabled' => 0];
        // chat_can_contact también comprueba el estado activo: incluirlo evita
        // que los contactos válidos queden descartados por un campo ausente.
        $candidates = $pdo->query('SELECT id,full_name,role,assigned_location,active FROM users WHERE active=1 ORDER BY full_name ASC')->fetchAll();
        $contacts = array_values(array_map(static fn ($item) => ['id' => (string) $item['id'], 'name' => $item['full_name'], 'role' => $item['role'], 'site' => $item['assigned_location']], array_filter($candidates, static fn ($item) => chat_can_contact($chatUser, $item))));
        $pushCredentials = chat_push_credentials($pdo);
        json_response(['ok' => true, 'settings' => ['sound' => (bool) $row['sound_enabled'], 'desktop' => (bool) $row['desktop_enabled'], 'push' => (bool) $row['push_enabled']], 'push' => ['available' => $pushCredentials !== null, 'publicKey' => $pushCredentials['public_key'] ?? null], 'contacts' => $contacts]);
    }
    if ($method === 'GET' && $route === 'chat/threads') {
        $statement = $pdo->prepare('SELECT t.id FROM internal_chat_threads t JOIN internal_chat_participants p ON p.thread_id=t.id WHERE p.user_id=? ORDER BY t.site_name IS NULL, t.title');
        $statement->execute([(int) $chatUser['id']]);
        // Versiones iniciales podían crear más de un grupo lógico durante una
        // importación. Sólo se expone el grupo canónico por tipo/local; las
        // filas antiguas se preservan para auditoría y nunca se eliminan.
        $seenGroups = [];
        $threads = [];
        foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $id) {
            $thread = chat_serialized_thread($pdo, (string) $id, (int) $chatUser['id']);
            $groupKey = in_array($thread['kind'], ['local', 'operativo'], true)
                ? $thread['kind'] . ':' . (string) ($thread['site'] ?? '')
                : $thread['id'];
            if (isset($seenGroups[$groupKey])) continue;
            $seenGroups[$groupKey] = true;
            $threads[] = $thread;
        }
        json_response(['ok' => true, 'threads' => $threads]);
    }
    if ($method === 'GET' && $route === 'chat/messages') {
        $threadId = (string) ($_GET['thread'] ?? ''); chat_require_member($pdo, $threadId, $chatUser);
        $query = trim((string) ($_GET['q'] ?? ''));
        $messages = chat_message_rows($pdo, $threadId, (int) $chatUser['id'], $query);
        foreach ($messages as &$message) $message['own'] = $message['sender']['id'] === (string) $chatUser['id'];
        unset($message);
        json_response(['ok' => true, 'messages' => $messages]);
    }
    if ($method === 'POST' && $route === 'chat/direct') {
        $body = request_body(); $recipientId = (int) ($body['recipientId'] ?? 0);
        $statement = $pdo->prepare('SELECT * FROM users WHERE id=? AND active=1'); $statement->execute([$recipientId]); $recipient = $statement->fetch();
        if (!$recipient || !chat_can_contact($chatUser, $recipient)) json_response(['ok' => false, 'error' => 'No podés iniciar una conversación con este usuario.'], 403);
        $ids = [(int) $chatUser['id'], $recipientId]; sort($ids, SORT_NUMERIC); $key = 'direct:' . implode(':', $ids);
        $existing = $pdo->prepare("SELECT t.id FROM internal_chat_threads t JOIN internal_chat_participants a ON a.thread_id=t.id AND a.user_id=? JOIN internal_chat_participants b ON b.thread_id=t.id AND b.user_id=? WHERE t.kind=? LIMIT 1");
        $existing->execute([$ids[0], $ids[1], $key]); $threadId = (string) ($existing->fetchColumn() ?: '');
        if ($threadId === '') { $threadId = chat_id(); $pdo->prepare('INSERT INTO internal_chat_threads (id,kind,title,created_by) VALUES (?,?,?,?)')->execute([$threadId, $key, $recipient['full_name'], (int) $chatUser['id']]); foreach ($ids as $id) $pdo->prepare('INSERT INTO internal_chat_participants (thread_id,user_id) VALUES (?,?)')->execute([$threadId,$id]); audit($pdo, (int) $chatUser['id'], 'internal_chat_direct_created', 'thread=' . $threadId); }
        json_response(['ok' => true, 'thread' => chat_serialized_thread($pdo, $threadId, (int) $chatUser['id'])]);
    }
    if ($method === 'POST' && $route === 'chat/messages') {
        $body = request_body(); $threadId = (string) ($body['threadId'] ?? ''); chat_require_member($pdo, $threadId, $chatUser);
        $clientId = strtolower(trim((string) ($body['clientId'] ?? '')));
        if (!preg_match('/^[a-f0-9-]{16,36}$/', $clientId)) json_response(['ok' => false, 'error' => 'Identificador de envío inválido.'], 422);
        $rate = $pdo->prepare('SELECT COUNT(*) FROM internal_chat_messages WHERE user_id=? AND created_at>=DATE_SUB(NOW(), INTERVAL 10 MINUTE)'); $rate->execute([(int) $chatUser['id']]);
        if ((int) $rate->fetchColumn() >= 80) json_response(['ok' => false, 'error' => 'Esperá unos minutos antes de enviar más mensajes.'], 429);
        $existing = $pdo->prepare('SELECT id FROM internal_chat_messages WHERE user_id=? AND client_message_id=?'); $existing->execute([(int) $chatUser['id'], $clientId]);
        $messageId = (string) ($existing->fetchColumn() ?: '');
        if ($messageId === '') {
            try { $text = chat_normalize_text($body['body'] ?? '', 4000); } catch (InvalidArgumentException $error) { json_response(['ok' => false, 'error' => $error->getMessage()], 422); }
            $rawAttachments = is_array($body['attachments'] ?? null) ? $body['attachments'] : [];
            if (count($rawAttachments) > 3) json_response(['ok' => false, 'error' => 'Podés adjuntar hasta tres archivos por mensaje.'], 422);
            try { $files = array_map('chat_attachment_payload', $rawAttachments); } catch (InvalidArgumentException $error) { json_response(['ok' => false, 'error' => $error->getMessage()], 422); }
            $messageId = chat_id(); $pdo->beginTransaction();
            try { $pdo->prepare('INSERT INTO internal_chat_messages (id,thread_id,user_id,client_message_id,body) VALUES (?,?,?,?,?)')->execute([$messageId,$threadId,(int)$chatUser['id'],$clientId,$text]); $insertFile=$pdo->prepare('INSERT INTO internal_chat_attachments (id,message_id,original_name,mime_type,byte_size,content) VALUES (?,?,?,?,?,?)'); foreach($files as $file) $insertFile->execute([$file['id'],$messageId,$file['name'],$file['mime'],strlen($file['content']),$file['content']]); audit($pdo,(int)$chatUser['id'],'internal_chat_message_created','thread='.$threadId.';message='.$messageId.';attachments='.count($files)); $pdo->commit(); chat_notify_push_recipients($pdo, $threadId, (int) $chatUser['id']); } catch(Throwable $error) { if($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
        }
        json_response(['ok' => true, 'messageId' => $messageId]);
    }
    if ($method === 'POST' && $route === 'chat/read') {
        $body=request_body(); $threadId=(string)($body['threadId']??''); chat_require_member($pdo,$threadId,$chatUser); $pdo->prepare('UPDATE internal_chat_participants SET last_read_at=NOW() WHERE thread_id=? AND user_id=?')->execute([$threadId,(int)$chatUser['id']]); json_response(['ok'=>true]);
    }
    if ($method === 'POST' && $route === 'chat/settings') {
        $body=request_body(); $pdo->prepare('INSERT INTO internal_chat_settings (user_id,sound_enabled,desktop_enabled,push_enabled) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE sound_enabled=VALUES(sound_enabled),desktop_enabled=VALUES(desktop_enabled),push_enabled=VALUES(push_enabled)')->execute([(int)$chatUser['id'],!empty($body['sound'])?1:0,!empty($body['desktop'])?1:0,!empty($body['push'])?1:0]); audit($pdo,(int)$chatUser['id'],'internal_chat_settings_updated'); json_response(['ok'=>true]);
    }
    if ($method === 'POST' && $route === 'chat/push/subscribe') {
        $body = request_body(); $subscription = chat_push_subscription($body); if (!$subscription) json_response(['ok' => false, 'error' => 'La suscripción de notificaciones no es válida.'], 422);
        if (!chat_push_credentials($pdo)) json_response(['ok' => false, 'error' => 'Este servidor no admite notificaciones push.'], 503);
        $pdo->prepare('INSERT INTO internal_chat_push_subscriptions (user_id,endpoint_hash,endpoint,p256dh_key,auth_key,user_agent,enabled) VALUES (?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),endpoint=VALUES(endpoint),p256dh_key=VALUES(p256dh_key),auth_key=VALUES(auth_key),user_agent=VALUES(user_agent),enabled=1,last_error=NULL')->execute([(int) $chatUser['id'], hash('sha256', $subscription['endpoint']), $subscription['endpoint'], $subscription['p256dh'], $subscription['auth'], substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255)]);
        $pdo->prepare('INSERT INTO internal_chat_settings (user_id,sound_enabled,desktop_enabled,push_enabled) VALUES (?,1,0,1) ON DUPLICATE KEY UPDATE push_enabled=1')->execute([(int) $chatUser['id']]); audit($pdo, (int) $chatUser['id'], 'internal_chat_push_subscribed'); json_response(['ok' => true]);
    }
    if ($method === 'POST' && $route === 'chat/push/unsubscribe') {
        $body = request_body(); $subscription = chat_push_subscription($body); if (!$subscription) json_response(['ok' => false, 'error' => 'La suscripción de notificaciones no es válida.'], 422);
        $pdo->prepare('UPDATE internal_chat_push_subscriptions SET enabled=0 WHERE user_id=? AND endpoint_hash=?')->execute([(int) $chatUser['id'], hash('sha256', $subscription['endpoint'])]); $pdo->prepare('UPDATE internal_chat_settings SET push_enabled=0 WHERE user_id=?')->execute([(int) $chatUser['id']]); audit($pdo, (int) $chatUser['id'], 'internal_chat_push_unsubscribed'); json_response(['ok' => true]);
    }
    if ($method === 'POST' && preg_match('#^chat/messages/([a-f0-9]{32})/(edit|delete)$#', $route, $matches)) {
        $statement=$pdo->prepare('SELECT m.*,t.id AS thread_access FROM internal_chat_messages m JOIN internal_chat_participants t ON t.thread_id=m.thread_id AND t.user_id=? WHERE m.id=?'); $statement->execute([(int)$chatUser['id'],$matches[1]]); $message=$statement->fetch();
        if(!$message || (int)$message['user_id'] !== (int)$chatUser['id'] || $message['deleted_at']) json_response(['ok'=>false,'error'=>'No podés modificar este mensaje.'],403);
        if(strtotime((string)$message['created_at']) < time()-900) json_response(['ok'=>false,'error'=>'El mensaje sólo puede modificarse durante 15 minutos.'],422);
        if($matches[2] === 'edit') { $body=request_body(); try{$text=chat_normalize_text($body['body']??'',4000);}catch(InvalidArgumentException $error){json_response(['ok'=>false,'error'=>$error->getMessage()],422);} $pdo->prepare('UPDATE internal_chat_messages SET body=?,edited_at=NOW() WHERE id=?')->execute([$text,$message['id']]); audit($pdo,(int)$chatUser['id'],'internal_chat_message_edited','message='.$message['id']); }
        else { $pdo->prepare('UPDATE internal_chat_messages SET body=\'\',deleted_at=NOW() WHERE id=?')->execute([$message['id']]); audit($pdo,(int)$chatUser['id'],'internal_chat_message_deleted','message='.$message['id']); }
        json_response(['ok'=>true]);
    }
    json_response(['ok' => false, 'error' => 'Ruta de chat no encontrada.'], 404);
}

if ($method === 'GET' && $route === 'catalog') {
    require_user($pdo);
    ensure_catalog_schema($pdo);
    $row = $pdo->query('SELECT document_json FROM catalog_documents WHERE id = 1')->fetch();
    $catalog = $row ? json_decode((string) $row['document_json'], true) : null;
    json_response(['ok' => true, 'catalog' => is_array($catalog) ? $catalog : null]);
}

if ($method === 'PUT' && $route === 'catalog') {
    $user = require_user($pdo, ['administracion']);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) {
        json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    }
    if (!empty($user['must_change_password'])) {
        json_response(['ok' => false, 'error' => 'Primero debés cambiar la contraseña temporal.'], 403);
    }
    ensure_catalog_schema($pdo);
    $body = request_body();
    $expectedRevision = max(0, (int) ($body['revision'] ?? -1));
    $products = $body['products'] ?? null;
    $priceChanges = $body['priceChanges'] ?? [];
    if (!is_array($products) || count($products) < 1 || count($products) > 1000 || !is_array($priceChanges)) {
        json_response(['ok' => false, 'error' => 'Catálogo inválido.'], 422);
    }
    $ids = [];
    $codes = [];
    foreach ($products as $product) {
        if (!is_array($product) || !is_numeric($product['id'] ?? null) || (int) $product['id'] < 1 || !is_string($product['name'] ?? null) || trim((string) $product['name']) === '' || !is_string($product['category'] ?? null) || trim((string) $product['category']) === '' || !is_string($product['barcode'] ?? null) || !preg_match('/^LART-\\d{3}$/', $product['barcode']) || !is_numeric($product['price'] ?? null) || !is_numeric($product['onlinePrice'] ?? null) || (float) $product['price'] < 0 || (float) $product['onlinePrice'] < 0) {
            json_response(['ok' => false, 'error' => 'Un producto del catálogo no es válido.'], 422);
        }
        $id = (int) $product['id'];
        if (isset($ids[$id])) json_response(['ok' => false, 'error' => 'Hay identificadores de producto duplicados.'], 422);
        $ids[$id] = true;
        $labels = array_merge([$product['barcode']], is_array($product['barcodeAliases'] ?? null) ? $product['barcodeAliases'] : []);
        foreach ($labels as $label) {
            if (!is_string($label) || !preg_match('/^LART-\\d{3}$/', $label) || isset($codes[$label])) json_response(['ok' => false, 'error' => 'Hay códigos de barras duplicados o inválidos.'], 422);
            $codes[$label] = true;
        }
    }
    $pdo->beginTransaction();
    try {
        $row = $pdo->query('SELECT revision, document_json FROM catalog_documents WHERE id = 1 FOR UPDATE')->fetch();
        $currentRevision = $row ? (int) $row['revision'] : 0;
        if ($currentRevision !== $expectedRevision) {
            $pdo->rollBack();
            json_response(['ok' => false, 'error' => 'Otra persona actualizó el catálogo. Recargá y revisá los cambios.'], 409);
        }
        $previous = $row ? json_decode((string) $row['document_json'], true) : null;
        if (is_array($previous['products'] ?? null)) {
            $incoming = array_fill_keys(array_map(static fn(array $p): int => (int) $p['id'], $products), true);
            foreach ($previous['products'] as $old) if (is_array($old) && isset($old['id']) && !isset($incoming[(int) $old['id']])) {
                $pdo->rollBack();
                json_response(['ok' => false, 'error' => 'No se pueden eliminar productos con historial.'], 422);
            }
        }
        $catalog = ['revision' => $currentRevision + 1, 'products' => array_values($products), 'priceChanges' => array_values($priceChanges), 'updatedAt' => gmdate('c')];
        $json = json_encode($catalog, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false || strlen($json) > 1_000_000) throw new RuntimeException('El catálogo supera el tamaño permitido.');
        if ($row) $pdo->prepare('UPDATE catalog_documents SET revision = ?, document_json = ?, updated_by = ? WHERE id = 1')->execute([$catalog['revision'], $json, $user['id']]);
        else $pdo->prepare('INSERT INTO catalog_documents (id, revision, document_json, updated_by) VALUES (1, ?, ?, ?)')->execute([$catalog['revision'], $json, $user['id']]);
        audit($pdo, (int) $user['id'], 'catalog_updated');
        $pdo->commit();
        json_response(['ok' => true, 'catalog' => $catalog]);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

// Registra accesos a áreas sensibles sin convertir cada actualización de página
// en ruido. La misma persona queda asentada una vez por módulo cada 30 minutos.
if ($method === 'POST' && $route === 'activity/module-opened') {
    $user = require_user($pdo);
    if (!in_array($_SERVER['HTTP_ORIGIN'] ?? '', $config['allowed_origins'], true)) {
        json_response(['ok' => false, 'error' => 'Origen no autorizado.'], 403);
    }
    $module = trim((string) (request_body()['module'] ?? ''));
    $allowedModules = ['MRP semanal', 'Recetas y costos', 'Compras de producción', 'Reportes'];
    if (!in_array($module, $allowedModules, true)) {
        json_response(['ok' => false, 'error' => 'Módulo inválido.'], 422);
    }
    $recent = $pdo->prepare("SELECT 1 FROM audit_log WHERE user_id = ? AND event_type = 'module_opened' AND event_detail = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE) LIMIT 1");
    $recent->execute([(int) $user['id'], $module]);
    if (!$recent->fetchColumn()) {
        audit($pdo, (int) $user['id'], 'module_opened', $module);
    }
    json_response(['ok' => true]);
}

if ($method === 'POST' && $route === 'assistant/chat') {
    $user = require_user($pdo);
    ensure_assistant_schema($pdo);
    $body = request_body();
    $question = assistant_clean_text($body['question'] ?? '', 1200);
    $site = assistant_clean_text($body['site'] ?? '', 80);
    $section = assistant_clean_text($body['section'] ?? '', 120);
    $history = is_array($body['history'] ?? null) ? $body['history'] : [];
    if (mb_strlen($question, 'UTF-8') < 2) {
        json_response(['ok' => false, 'error' => 'Escribí una pregunta para consultar al asistente.'], 422);
    }
    if ($site !== '' && !in_array($site, operational_sites(), true)) $site = '';
    if ($site !== '' && $user['role'] !== 'administracion' && !user_can_access_site($user, $site)) {
        json_response(['ok' => false, 'error' => 'No tenés acceso a ese local.'], 403);
    }
    $rate = $pdo->prepare("SELECT COUNT(*) FROM ai_chat_messages WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)");
    $rate->execute([(int) $user['id']]);
    if ((int) $rate->fetchColumn() >= 12) {
        json_response(['ok' => false, 'error' => 'Alcanzaste el límite momentáneo. Esperá unos minutos antes de volver a consultar.'], 429);
    }
    $insert = $pdo->prepare("INSERT INTO ai_chat_messages (user_id, role_snapshot, site, section_name, question, status) VALUES (?, ?, ?, ?, ?, 'processing')");
    $insert->execute([(int) $user['id'], $user['role'], $site ?: null, $section ?: null, $question]);
    $messageId = (int) $pdo->lastInsertId();
    try {
        $result = assistant_openai_response($config, $user, $site, $section, $question, $history);
        $pdo->prepare("UPDATE ai_chat_messages SET answer = ?, status = 'answered', request_id = ? WHERE id = ?")
            ->execute([$result['answer'], $result['requestId'] ?: null, $messageId]);
        audit($pdo, (int) $user['id'], 'ai_assistant_question', 'message_id=' . $messageId);
        json_response(['ok' => true, 'messageId' => $messageId, 'answer' => $result['answer']]);
    } catch (Throwable $error) {
        error_log('LARTISAN assistant failed: ' . $error->getMessage());
        $pdo->prepare("UPDATE ai_chat_messages SET status = 'failed' WHERE id = ?")->execute([$messageId]);
        $notConfigured = $error->getMessage() === 'assistant_not_configured';
        json_response([
            'ok' => false,
            'messageId' => $messageId,
            'error' => $notConfigured
                ? 'El asistente está instalado y pendiente de activar por Administración.'
                : 'El asistente no pudo responder ahora. Podés enviar la consulta a Administración.',
        ], 503);
    }
}

if ($method === 'POST' && $route === 'assistant/escalate') {
    $user = require_user($pdo);
    ensure_assistant_schema($pdo);
    $body = request_body();
    $question = assistant_clean_text($body['question'] ?? '', 1200);
    $site = assistant_clean_text($body['site'] ?? '', 80);
    $section = assistant_clean_text($body['section'] ?? '', 120);
    $chatMessageId = filter_var($body['messageId'] ?? null, FILTER_VALIDATE_INT) ?: null;
    if (mb_strlen($question, 'UTF-8') < 2) {
        json_response(['ok' => false, 'error' => 'No hay una consulta para enviar.'], 422);
    }
    if ($site !== '' && !in_array($site, operational_sites(), true)) $site = '';
    if ($site !== '' && $user['role'] !== 'administracion' && !user_can_access_site($user, $site)) {
        json_response(['ok' => false, 'error' => 'No tenés acceso a ese local.'], 403);
    }
    $rate = $pdo->prepare("SELECT COUNT(*) FROM ai_support_requests WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)");
    $rate->execute([(int) $user['id']]);
    if ((int) $rate->fetchColumn() >= 5) {
        json_response(['ok' => false, 'error' => 'Ya enviaste varias consultas hoy. Administración las revisará desde su bandeja.'], 429);
    }
    $stmt = $pdo->prepare("INSERT INTO ai_support_requests (chat_message_id, user_id, username_snapshot, role_snapshot, site, section_name, question) VALUES (?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([$chatMessageId, (int) $user['id'], $user['full_name'], $user['role'], $site ?: null, $section ?: null, $question]);
    $requestId = (int) $pdo->lastInsertId();
    audit($pdo, (int) $user['id'], 'ai_support_requested', 'request_id=' . $requestId);
    json_response(['ok' => true, 'requestId' => $requestId, 'message' => 'Consulta enviada a Administración.']);
}

if ($method === 'GET' && $route === 'admin/assistant-requests') {
    require_user($pdo, ['administracion']);
    ensure_assistant_schema($pdo);
    $rows = $pdo->query("SELECT id, username_snapshot, role_snapshot, site, section_name, question, status, created_at, resolved_at FROM ai_support_requests ORDER BY (status = 'pendiente') DESC, created_at DESC LIMIT 100")->fetchAll();
    json_response(['ok' => true, 'requests' => $rows]);
}

if ($method === 'PATCH' && preg_match('#^admin/assistant-requests/(\d+)$#', $route, $matches)) {
    $admin = require_user($pdo, ['administracion']);
    ensure_assistant_schema($pdo);
    $requestId = (int) $matches[1];
    $pdo->prepare("UPDATE ai_support_requests SET status = 'resuelta', resolved_at = NOW(), resolved_by = ? WHERE id = ? AND status = 'pendiente'")
        ->execute([(int) $admin['id'], $requestId]);
    audit($pdo, (int) $admin['id'], 'ai_support_resolved', 'request_id=' . $requestId);
    json_response(['ok' => true]);
}

if ($method === 'POST' && $route === 'auth/change-password') {
    $user = require_user($pdo);
    $body = request_body();
    $currentPassword = (string) ($body['currentPassword'] ?? '');
    $newPassword = (string) ($body['newPassword'] ?? '');
    if (!password_verify($currentPassword, $user['password_hash'])) {
        json_response(['ok' => false, 'error' => 'La contraseña actual no es correcta'], 422);
    }
    if (!valid_password($newPassword)) {
        json_response(['ok' => false, 'error' => 'La nueva contraseña no cumple los requisitos'], 422);
    }
    $hash = password_hash($newPassword, PASSWORD_DEFAULT);
    $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
        ->execute([$hash, $user['id']]);
    $pdo->prepare('DELETE FROM user_sessions WHERE user_id = ?')->execute([$user['id']]);
    audit($pdo, (int) $user['id'], 'password_changed');
    clear_session($pdo, $config);
    json_response(['ok' => true]);
}

if ($method === 'POST' && $route === 'auth/request-reset') {
    $body = request_body();
    $username = mb_strtolower(trim((string) ($body['username'] ?? '')), 'UTF-8');
    $stmt = $pdo->prepare('SELECT id, role FROM users WHERE username = ? AND active = 1 LIMIT 1');
    $stmt->execute([$username]);
    $resetUser = $stmt->fetch();

    if ($resetUser && $resetUser['role'] === 'administracion') {
        $userId = (int) $resetUser['id'];
        $recent = $pdo->prepare(
            'SELECT created_at FROM password_recovery_codes WHERE user_id = ? ORDER BY id DESC LIMIT 1'
        );
        $recent->execute([$userId]);
        $lastCreated = $recent->fetchColumn();
        if ($lastCreated && strtotime((string) $lastCreated) > time() - 60) {
            json_response([
                'ok' => false,
                'error' => 'Esperá un minuto antes de solicitar otro código.',
            ], 429);
        }
        $hourly = $pdo->prepare(
            'SELECT COUNT(*) FROM password_recovery_codes
             WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)'
        );
        $hourly->execute([$userId]);
        if ((int) $hourly->fetchColumn() >= 5) {
            json_response([
                'ok' => false,
                'error' => 'Se alcanzó el límite de códigos. Intentá nuevamente dentro de una hora.',
            ], 429);
        }

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $expiresAt = date('Y-m-d H:i:s', time() + 15 * 60);
        $pdo->prepare(
            'INSERT INTO password_recovery_codes
             (user_id, code_hash, expires_at, requested_ip) VALUES (?, ?, ?, ?)'
        )->execute([$userId, password_hash($code, PASSWORD_DEFAULT), $expiresAt, client_ip()]);
        $recoveryId = (int) $pdo->lastInsertId();
        $destination = trim((string) ($config['admin_recovery_email'] ?? ''));
        if ($destination === '') {
            $pdo->prepare('DELETE FROM password_recovery_codes WHERE id = ?')->execute([$recoveryId]);
            audit($pdo, $userId, 'password_recovery_not_configured');
            json_response(['ok' => false, 'error' => 'La recuperación no está configurada'], 503);
        }
        $from = trim((string) ($config['recovery_from_email'] ?? ''));
        if ($from === '') {
            $pdo->prepare('DELETE FROM password_recovery_codes WHERE id = ?')->execute([$recoveryId]);
            audit($pdo, $userId, 'password_recovery_sender_not_configured');
            json_response(['ok' => false, 'error' => 'La recuperación no está configurada'], 503);
        }
        $subject = "Codigo de recuperacion - L'ARTISAN";
        $emailBody = "Se solicito recuperar el acceso de Administracion.\n\n"
            . "Codigo: {$code}\n\n"
            . "El codigo vence en 15 minutos y solo puede usarse una vez.\n"
            . "Si no solicitaste este cambio, ignora este correo.";
        $headers = [
            'From: Sistema LARTISAN <' . $from . '>',
            'Reply-To: ' . $destination,
            'Content-Type: text/plain; charset=UTF-8',
            'X-Mailer: PHP/' . PHP_VERSION,
        ];
        if (!mail($destination, $subject, $emailBody, implode("\r\n", $headers))) {
            $pdo->prepare('DELETE FROM password_recovery_codes WHERE id = ?')->execute([$recoveryId]);
            audit($pdo, $userId, 'password_recovery_email_failed');
            json_response([
                'ok' => false,
                'error' => 'No pudimos enviar el código. Intentá nuevamente en unos minutos.',
            ], 503);
        }
        audit($pdo, $userId, 'password_recovery_code_sent');
        json_response([
            'ok' => true,
            'delivery' => 'email_code',
            'message' => 'Enviamos un código de 6 dígitos al correo de Administración.',
        ]);
    }

    if ($resetUser) {
        $userId = (int) $resetUser['id'];
        $pending = $pdo->prepare(
            "SELECT id FROM password_reset_requests
             WHERE user_id = ? AND status = 'pendiente' AND requested_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)"
        );
        $pending->execute([$userId]);
        if (!$pending->fetchColumn()) {
            $pdo->prepare('INSERT INTO password_reset_requests (user_id) VALUES (?)')->execute([$userId]);
            audit($pdo, (int) $userId, 'password_reset_requested');
        }
    }
    json_response(['ok' => true, 'message' => 'Si el usuario existe, Administración recibirá la solicitud.']);
}

if ($method === 'POST' && $route === 'auth/confirm-reset-code') {
    $body = request_body();
    $username = mb_strtolower(trim((string) ($body['username'] ?? '')), 'UTF-8');
    $code = trim((string) ($body['code'] ?? ''));
    $newPassword = (string) ($body['newPassword'] ?? '');
    if (!preg_match('/^\d{6}$/', $code) || !valid_password($newPassword)) {
        json_response([
            'ok' => false,
            'error' => 'Revisá el código y usá una contraseña segura de al menos 8 caracteres.',
        ], 422);
    }
    $stmt = $pdo->prepare(
        "SELECT c.*, u.id AS account_id
         FROM password_recovery_codes c
         JOIN users u ON u.id = c.user_id
         WHERE u.username = ? AND u.role = 'administracion' AND u.active = 1
           AND c.used_at IS NULL AND c.expires_at > NOW() AND c.attempts < 5
         ORDER BY c.id DESC LIMIT 1"
    );
    $stmt->execute([$username]);
    $recovery = $stmt->fetch();
    if (!$recovery || !password_verify($code, $recovery['code_hash'])) {
        if ($recovery) {
            $pdo->prepare('UPDATE password_recovery_codes SET attempts = attempts + 1 WHERE id = ?')
                ->execute([$recovery['id']]);
            audit($pdo, (int) $recovery['account_id'], 'password_recovery_code_failed');
        } else {
            audit($pdo, null, 'password_recovery_code_failed', $username);
        }
        json_response(['ok' => false, 'error' => 'El código es incorrecto o venció.'], 422);
    }

    $userId = (int) $recovery['account_id'];
    $pdo->beginTransaction();
    try {
        $pdo->prepare(
            'UPDATE users SET password_hash = ?, must_change_password = 0,
             failed_attempts = 0, locked_until = NULL WHERE id = ?'
        )->execute([password_hash($newPassword, PASSWORD_DEFAULT), $userId]);
        $pdo->prepare('UPDATE password_recovery_codes SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL')
            ->execute([$userId]);
        $pdo->prepare('DELETE FROM user_sessions WHERE user_id = ?')->execute([$userId]);
        audit($pdo, $userId, 'password_recovered_by_email');
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    clear_session($pdo, $config);
    json_response(['ok' => true, 'message' => 'Contraseña actualizada. Ya podés ingresar.']);
}

if ($method === 'GET' && $route === 'operations/states') {
    $user = require_user($pdo);
    ensure_operations_schema($pdo);
    $allowedSites = array_values(array_filter(
        operational_sites(),
        static fn (string $site): bool => user_can_access_site($user, $site)
    ));
    // Central recibe además, de los locales que no opera, solo pedidos y ajustes pendientes.
    $centralSites = user_manages_central_orders($user)
        ? array_values(array_diff(operational_sites(), $allowedSites))
        : [];
    if (!$allowedSites) {
        json_response(['ok' => true, 'states' => []]);
    }
    foreach ($allowedSites as $site) {
        // Una falla de mantenimiento nunca impide leer las operaciones.
        try {
            compact_oversized_site_state($pdo, $config, $site);
        } catch (Throwable $error) {
            error_log('LARTISAN state compaction failed for ' . $site . ': ' . $error->getMessage());
        }
    }
    $readableSites = array_merge($allowedSites, $centralSites);
    $placeholders = implode(',', array_fill(0, count($readableSites), '?'));
    $stmt = $pdo->prepare(
        "SELECT site, state_json, revision, updated_at FROM operation_site_states WHERE site IN ($placeholders)"
    );
    $stmt->execute($readableSites);
    $states = [];
    foreach ($stmt->fetchAll() as $row) {
        $state = json_decode((string) $row['state_json'], true);
        if (is_array($state)) {
            $centralOnly = in_array($row['site'], $centralSites, true);
            $states[$row['site']] = [
                'state' => $centralOnly ? central_site_view($state) : operational_snapshot_for_user($user, $state, (string) $row['site']),
                'revision' => (int) $row['revision'],
                'updatedAt' => $row['updated_at'],
                'centralOnly' => $centralOnly,
            ];
        }
    }
    json_response(['ok' => true, 'states' => $states]);
}

// Algunos alojamientos compartidos bloquean por reglas propias los PUT y las
// rutas que contienen "operations" antes de que PHP pueda recibirlos. El
// cliente usa POST /sync para no dejar ventas, recepciones ni stock atrapados
// en la cola local. Se mantiene la ruta PUT anterior para compatibilidad.
$isLegacyOperationWrite = $method === 'PUT' && preg_match('#^operations/states/([^/]+)$#', $route, $matches);
$isSyncOperationWrite = $method === 'POST' && $route === 'sync';
if ($isLegacyOperationWrite || $isSyncOperationWrite) {
    $user = require_user($pdo);
    if (!empty($user['must_change_password'])) {
        json_response(['ok' => false, 'error' => 'Primero debés cambiar la contraseña temporal'], 403);
    }
    ensure_operations_schema($pdo);
    $body = request_body();
    $site = $isLegacyOperationWrite
        ? rawurldecode($matches[1])
        : trim((string) ($body['site'] ?? ''));
    if (!in_array($site, operational_sites(), true)) {
        json_response(['ok' => false, 'error' => 'Local operativo inválido'], 422);
    }
    $centralOnly = !user_can_access_site($user, $site)
        && in_array($site, operational_sites(), true)
        && user_manages_central_orders($user);
    if (!user_can_access_site($user, $site) && !$centralOnly) {
        json_response(['ok' => false, 'error' => 'No tenés acceso a este local'], 403);
    }
    $baseRevision = max(0, (int) ($body['baseRevision'] ?? 0));
    $requestId = trim((string) ($body['requestId'] ?? ''));
    $baseState = $body['baseState'] ?? null;
    $state = $body['state'] ?? null;
    $clientEvent = is_array($body['event'] ?? null) ? $body['event'] : [];
    if (!is_array($state) || !preg_match('/^[a-f0-9-]{36}$/i', $requestId)) {
        json_response(['ok' => false, 'error' => 'Datos operativos inválidos'], 422);
    }
    $syncStage = 'preparar';
    $pdo->beginTransaction();
    try {
        $requestLookup = $pdo->prepare('SELECT revision FROM operation_requests WHERE request_id = ? AND site = ? LIMIT 1');
        $requestLookup->execute([$requestId, $site]);
        $processedRevision = $requestLookup->fetchColumn();
        if ($processedRevision !== false) {
            $pdo->commit();
            json_response(['ok' => true, 'revision' => (int) $processedRevision, 'alreadyProcessed' => true]);
        }
        $revisionStatement = $pdo->prepare('SELECT revision, state_json FROM operation_site_states WHERE site = ? FOR UPDATE');
        $revisionStatement->execute([$site]);
        $currentRow = $revisionStatement->fetch();
        $currentRevision = $currentRow === false ? false : (int) $currentRow['revision'];
        $previousState = $currentRow === false ? [] : (json_decode((string) $currentRow['state_json'], true) ?: []);
        if ($centralOnly && $currentRow === false) {
            // Un local sin datos no tiene pedidos que Central pueda gestionar.
            $pdo->commit();
            json_response(['ok' => true, 'revision' => 0, 'merged' => false, 'state' => null]);
        }
        $syncStage = 'autorizar';
        $authorizedIncoming = $centralOnly
            ? authorize_central_changes($user, $previousState, is_array($baseState) ? $baseState : [], $state)
            : authorize_operational_snapshot($user, $previousState, $state);
        $merged = false;
        if ($centralOnly) {
            // Los cambios de Central ya se aplicaron sobre el estado vigente.
            $state = $authorizedIncoming;
        } elseif ($currentRow !== false && (int) $currentRevision !== $baseRevision) {
            if (!is_array($baseState)) {
                $pdo->rollBack();
                json_response(['ok' => false, 'error' => 'Otro equipo actualizó este local', 'currentRevision' => (int) $currentRevision], 409);
            }
            $state = merge_operational_snapshot($baseState, $previousState, $authorizedIncoming);
            $merged = true;
        } else {
            $state = $authorizedIncoming;
        }
        validate_test_operating_snapshot($pdo, $site, $previousState, $state, $clientEvent);
        // El registro del local está bloqueado con FOR UPDATE. Esta validación
        // convierte la política de una única caja/responsable en una garantía
        // del servidor y no en una mera condición de la pantalla.
        enforce_strict_cash_snapshot($previousState, $state, $user, $site);
        // El historial completo vive en las tablas normalizadas y en
        // operation_archive; el estado del local conserva solo lo reciente y lo
        // abierto para que cada envío no crezca sin límite.
        $syncStage = 'validar_comprobante';
        try {
            [$state, $invoiceFindings] = enforce_invoice_type_changes($pdo, $user, $previousState, $state);
        } catch (Throwable $invoiceValidationError) {
            // La protección fiscal debe ser conservadora sin bloquear el resto
            // de la operación. Ante una falla técnica se conservan los tipos de
            // comprobante previamente guardados y se permiten stock, caja,
            // pedidos y recepciones.
            error_log('LARTISAN invoice validation fallback: ' . $invoiceValidationError->getMessage());
            $previousSales = is_array($previousState['sales'] ?? null) ? $previousState['sales'] : [];
            $knownSales = operational_items_by_id($previousSales);
            foreach (is_array($state['sales'] ?? null) ? $state['sales'] : [] as $index => $sale) {
                if (!is_array($sale) || !isset($sale['id']) || !is_scalar($sale['id'])) continue;
                $before = $knownSales[(string) $sale['id']] ?? null;
                if (is_array($before)) $state['sales'][$index]['invoiceType'] = $before['invoiceType'] ?? null;
            }
            $invoiceFindings = [];
        }
        $untrimmedState = $state;
        $syncStage = 'recortar';
        [$state] = compact_operational_state($untrimmedState, $config);
        $syncStage = 'archivar_recorte';
        archive_removed_operational_items($pdo, $site, $previousState, $untrimmedState, $state);
        // Etapa de observación: se registran las diferencias de importes sin
        // rechazar la operación. Un error de control nunca impide guardar.
        try {
            record_sale_validation_findings($pdo, $site, (int) $user['id'], array_merge($invoiceFindings,
                validate_operational_sales($previousState, $untrimmedState, $site, catalog_price_lists($pdo))));
        } catch (Throwable $validationError) {
            error_log('LARTISAN sale validation failed: ' . $validationError->getMessage());
        }
        $changedKeys = array_values(array_filter(array_unique(array_merge(array_keys($previousState), array_keys($state))), static function ($key) use ($previousState, $state): bool {
            return ($previousState[$key] ?? null) !== ($state[$key] ?? null);
        }));
        $stateJson = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $eventJson = json_encode([
            'changedKeys' => $changedKeys,
            'recordedAt' => gmdate('c'),
            'requestId' => $requestId,
            'mergedConcurrentChanges' => $merged,
            'event' => [
                'action' => substr((string) ($clientEvent['action'] ?? 'Actualización operativa'), 0, 160),
                'detail' => substr((string) ($clientEvent['detail'] ?? ''), 0, 800),
                'testOperatingDate' => substr((string) ($clientEvent['testOperatingDate'] ?? ''), 0, 10),
                'testLabel' => substr((string) ($clientEvent['testLabel'] ?? ''), 0, 120),
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($stateJson === false || $eventJson === false || strlen($stateJson) > 4_000_000) {
            $pdo->rollBack();
            json_response(['ok' => false, 'error' => 'La operación supera el tamaño permitido'], 422);
        }
        $syncStage = 'guardar_estado';
        if ($currentRow === false) {
            if ($baseRevision !== 0) {
                $pdo->rollBack();
                json_response(['ok' => false, 'error' => 'La versión del local cambió', 'currentRevision' => 0], 409);
            }
            $pdo->prepare('INSERT INTO operation_site_states (site, state_json, revision, updated_by) VALUES (?, ?, 1, ?)')
                ->execute([$site, $stateJson, $user['id']]);
        } else {
            $pdo->prepare('UPDATE operation_site_states SET state_json = ?, revision = revision + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE site = ?')
                ->execute([$stateJson, $user['id'], $site]);
        }
        $syncStage = 'guardar_evento';
        $pdo->prepare(
            'INSERT INTO operation_events (site, user_id, event_type, event_json) VALUES (?, ?, ?, ?)'
        )->execute([$site, $user['id'], 'operacion_actualizada', $eventJson]);
        // El estado operativo es la fuente de verdad para caja, ventas y stock.
        // Las tablas normalizadas alimentan reportes; una estructura antigua o
        // una inconsistencia allí no puede dejar una operación comercial
        // atrapada en la cola del local.
        try {
            sync_normalized_operations($pdo, $site, $untrimmedState, (int) $user['id'], $currentRow === false ? null : $previousState);
        } catch (Throwable $normalizationError) {
            error_log('LARTISAN normalized operations sync failed for ' . $site . ': ' . $normalizationError->getMessage());
        }
        $syncStage = 'auditar';
        audit($pdo, (int) $user['id'], 'operational_state_updated', $site);
        $nextRevision = $currentRow === false ? 1 : ((int) $currentRevision + 1);
        $syncStage = 'confirmar_solicitud';
        $pdo->prepare('INSERT INTO operation_requests (request_id, site, user_id, revision) VALUES (?, ?, ?, ?)')
            ->execute([$requestId, $site, $user['id'], $nextRevision]);
        $syncStage = 'confirmar';
        // Las instalaciones que todavía completan una migración auxiliar en
        // la primera escritura pueden recibir un COMMIT implícito de MySQL.
        // Todo el estado, evento y requestId ya quedó escrito; volver a
        // invocar commit() arroja "There is no active transaction" y deja al
        // navegador reintentando una operación que en realidad sí persistió.
        // La comprobación conserva la transacción normal y evita ese falso
        // pendiente durante el primer arranque.
        if ($pdo->inTransaction()) $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $failureDetail = preg_replace('/[\r\n]+/', ' ', $error->getMessage()) ?: 'Sin detalle disponible.';
        $failureDetail = substr($syncStage . ': ' . $failureDetail, 0, 800);
        error_log('LARTISAN operation sync failed at ' . $syncStage . ' for ' . $site . ': ' . $failureDetail);
        // El intento fallido se audita fuera de la transacción revertida para
        // poder diagnosticar una cola pendiente sin exponer el detalle técnico
        // al equipo de ventas.
        try {
            audit($pdo, (int) $user['id'], 'operational_sync_failed', $site . ' · ' . $failureDetail);
        } catch (Throwable $auditError) {
            error_log('LARTISAN operation sync failure audit failed: ' . $auditError->getMessage());
        }
        json_response(['ok' => false, 'error' => 'No se pudo guardar la operación en la etapa ' . $syncStage . '.'], 500);
    }
    $revision = (int) $pdo->query("SELECT revision FROM operation_site_states WHERE site = " . $pdo->quote($site))->fetchColumn();
    json_response(['ok' => true, 'revision' => $revision, 'merged' => $merged ?? false, 'state' => ($merged ?? false) ? operational_snapshot_for_user($user, $state, $site) : null]);
}

if ($method === 'POST' && $route === 'monitoring/heartbeat') {
    require_user($pdo);
    $result = notify_monitoring_alerts($pdo, $config);
    json_response(['ok' => true, 'notification' => $result]);
}

if ($method === 'GET' && $route === 'admin/audit') {
    require_user($pdo, ['administracion']);
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? '')) ? (string) $_GET['from'] : date('Y-m-01');
    $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? '')) ? (string) $_GET['to'] : date('Y-m-d');
    $siteFilter = trim((string) ($_GET['site'] ?? ''));
    $userFilter = trim((string) ($_GET['user'] ?? ''));
    $actionFilter = trim((string) ($_GET['action'] ?? ''));
    $sql = "SELECT e.id, e.site, e.event_json, e.created_at, COALESCE(u.full_name, 'Sistema') AS user_name
            FROM operation_events e LEFT JOIN users u ON u.id = e.user_id
            WHERE e.created_at >= ? AND e.created_at < DATE_ADD(?, INTERVAL 1 DAY)";
    $params = [$from, $to];
    if ($siteFilter !== '' && in_array($siteFilter, operational_sites(), true)) { $sql .= ' AND e.site = ?'; $params[] = $siteFilter; }
    if ($userFilter !== '') { $sql .= ' AND COALESCE(u.full_name, ?) LIKE ?'; $params[] = 'Sistema'; $params[] = '%' . $userFilter . '%'; }
    if ($actionFilter !== '') { $sql .= ' AND e.event_json LIKE ?'; $params[] = '%' . $actionFilter . '%'; }
    $sql .= ' ORDER BY e.created_at DESC, e.id DESC LIMIT 1000';
    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $events = [];
    foreach ($statement->fetchAll() as $row) {
        $payload = json_decode((string) $row['event_json'], true) ?: [];
        $event = is_array($payload['event'] ?? null) ? $payload['event'] : [];
        $events[] = [
            'id' => 'operation-' . $row['id'], 'at' => $row['created_at'], 'site' => $row['site'],
            'userName' => $row['user_name'], 'action' => (string) ($event['action'] ?? $payload['eventType'] ?? 'Actualización operativa'),
            'detail' => (string) ($event['detail'] ?? implode(', ', $payload['changedKeys'] ?? [])),
        ];
    }
    if ($siteFilter === '') {
        $auditSql = "SELECT a.id, a.event_type, a.event_detail, a.created_at, COALESCE(u.full_name, 'Sistema') AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.created_at >= ? AND a.created_at < DATE_ADD(?, INTERVAL 1 DAY)";
        $auditParams = [$from, $to];
        if ($userFilter !== '') { $auditSql .= ' AND COALESCE(u.full_name, ?) LIKE ?'; $auditParams[] = 'Sistema'; $auditParams[] = '%' . $userFilter . '%'; }
        if ($actionFilter !== '') { $auditSql .= ' AND (a.event_type LIKE ? OR a.event_detail LIKE ?)'; $auditParams[] = '%' . $actionFilter . '%'; $auditParams[] = '%' . $actionFilter . '%'; }
        $auditSql .= ' ORDER BY a.created_at DESC LIMIT 1000';
        $auditStatement = $pdo->prepare($auditSql); $auditStatement->execute($auditParams);
        foreach ($auditStatement->fetchAll() as $row) $events[] = [
            'id' => 'security-' . $row['id'], 'at' => $row['created_at'], 'site' => 'General', 'userName' => $row['user_name'],
            'action' => str_replace('_', ' ', (string) $row['event_type']), 'detail' => (string) ($row['event_detail'] ?? ''),
        ];
        usort($events, static fn (array $left, array $right): int => strcmp((string) $right['at'], (string) $left['at']));
        $events = array_slice($events, 0, 1000);
    }
    json_response(['ok' => true, 'events' => $events]);
}

if ($method === 'GET' && $route === 'admin/cash-history') {
    require_user($pdo, ['administracion']);
    ensure_normalized_operations_schema($pdo);
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? '')) ? (string) $_GET['from'] : date('Y-m-01');
    $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? '')) ? (string) $_GET['to'] : date('Y-m-d');
    $siteFilter = trim((string) ($_GET['site'] ?? ''));
    $sql = 'SELECT id, site, opened_at, opened_by, initial_fund, closed_at, closed_by, expected_cash, counted_cash, difference_amount, envelope_amount FROM lartisan_cash_sessions WHERE opened_at >= ? AND opened_at < DATE_ADD(?, INTERVAL 1 DAY)';
    $params = [$from, $to];
    if ($siteFilter !== '' && in_array($siteFilter, operational_sites(), true)) { $sql .= ' AND site = ?'; $params[] = $siteFilter; }
    $sql .= ' ORDER BY opened_at DESC LIMIT 2000';
    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    json_response(['ok' => true, 'sessions' => array_map(static fn (array $row): array => [
        'id' => $row['id'], 'site' => $row['site'], 'openedAt' => $row['opened_at'], 'openedBy' => $row['opened_by'],
        'initialFund' => (float) $row['initial_fund'], 'closedAt' => $row['closed_at'], 'closedBy' => $row['closed_by'],
        'expectedCash' => $row['expected_cash'] === null ? null : (float) $row['expected_cash'],
        'countedCash' => $row['counted_cash'] === null ? null : (float) $row['counted_cash'],
        'differenceAmount' => $row['difference_amount'] === null ? null : (float) $row['difference_amount'],
        'envelopeAmount' => $row['envelope_amount'] === null ? null : (float) $row['envelope_amount'],
    ], $statement->fetchAll())]);
}

if ($method === 'GET' && $route === 'admin/report-sales') {
    require_user($pdo, ['administracion']);
    ensure_normalized_operations_schema($pdo);
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? '')) ? (string) $_GET['from'] : date('Y-m-01');
    $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? '')) ? (string) $_GET['to'] : date('Y-m-d');
    $siteFilter = trim((string) ($_GET['site'] ?? ''));
    $sql = 'SELECT * FROM lartisan_sales WHERE occurred_at >= ? AND occurred_at < DATE_ADD(?, INTERVAL 1 DAY)';
    $params = [$from, $to];
    if ($siteFilter !== '' && in_array($siteFilter, operational_sites(), true)) { $sql .= ' AND site = ?'; $params[] = $siteFilter; }
    $sql .= ' ORDER BY occurred_at DESC LIMIT 10000';
    $statement = $pdo->prepare($sql); $statement->execute($params); $saleRows = $statement->fetchAll();
    $ids = array_column($saleRows, 'id'); $itemsBySale = []; $paymentsBySale = [];
    if ($ids) {
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $itemStatement = $pdo->prepare("SELECT * FROM lartisan_sale_items WHERE sale_id IN ($placeholders) ORDER BY sale_id, line_number");
        $itemStatement->execute($ids);
        foreach ($itemStatement->fetchAll() as $item) $itemsBySale[$item['sale_id']][] = $item;
        $paymentStatement = $pdo->prepare("SELECT * FROM lartisan_sale_payments WHERE sale_id IN ($placeholders)");
        $paymentStatement->execute($ids);
        foreach ($paymentStatement->fetchAll() as $paymentRow) $paymentsBySale[$paymentRow['sale_id']][] = ['method' => $paymentRow['payment_method'], 'amount' => (float) $paymentRow['amount'], 'saleId' => $paymentRow['sale_id']];
    }
    $sales = [];
    foreach ($saleRows as $row) {
        $items = [];
        foreach ($itemsBySale[$row['id']] ?? [] as $item) for ($count = 0; $count < (int) $item['quantity']; $count++) $items[] = [
            'id' => (int) $item['product_id'], 'name' => $item['product_name'], 'detail' => $item['presentation'] ?? '', 'category' => 'Histórico', 'price' => (float) $item['unit_price'],
        ];
        $sales[] = [
            'id' => $row['id'], 'site' => $row['site'], 'createdAt' => $row['occurred_at'], 'createdAtISO' => str_replace(' ', 'T', (string) $row['occurred_at']),
            'items' => $items, 'gross' => (float) $row['gross_amount'], 'discount' => (float) $row['discount_amount'], 'net' => (float) $row['net_amount'],
            'method' => $row['payment_method'] ?: 'Sin informar', 'invoiceType' => $row['invoice_type'] ?: 'Remito interno', 'customer' => $row['customer_name'] ?: 'Consumidor final',
            'invitation' => (bool) $row['invitation'], 'channel' => $row['channel'] ?: 'Mostrador', 'status' => $row['status'] ?: 'activa',
        ];
    }
    json_response(['ok' => true, 'sales' => $sales, 'payments' => array_values(array_merge(...array_values($paymentsBySale ?: [[]]))), 'truncated' => count($sales) >= 10000]);
}

// Historial operativo para Ventas. A diferencia del reporte administrativo,
// esta ruta obliga a consultar únicamente un local habilitado para la sesión.
// Así una vendedora puede revisar su jornada sin obtener datos de otra sucursal.
if ($method === 'GET' && $route === 'sales/history') {
    $viewer = require_user($pdo, ['vendedora', 'supervisora', 'administracion']);
    ensure_normalized_operations_schema($pdo);
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? '')) ? (string) $_GET['from'] : date('Y-m-d');
    $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? '')) ? (string) $_GET['to'] : $from;
    if ($to < $from) json_response(['ok' => false, 'error' => 'El rango de fechas no es válido.'], 422);
    $start = new DateTimeImmutable($from);
    if ($start->diff(new DateTimeImmutable($to))->days > 366) {
        json_response(['ok' => false, 'error' => 'El rango máximo de consulta es de 366 días.'], 422);
    }
    $site = trim((string) ($_GET['site'] ?? ''));
    if ($site === '') $site = assigned_locations($viewer)[0] ?? '';
    if ($site === '' || !user_can_access_site($viewer, $site)) {
        json_response(['ok' => false, 'error' => 'No tenés acceso al historial de ese local.'], 403);
    }
    $statement = $pdo->prepare('SELECT * FROM lartisan_sales WHERE site = ? AND occurred_at >= ? AND occurred_at < DATE_ADD(?, INTERVAL 1 DAY) ORDER BY occurred_at DESC LIMIT 1000');
    $statement->execute([$site, $from, $to]);
    $saleRows = $statement->fetchAll();
    $ids = array_column($saleRows, 'id');
    $itemsBySale = [];
    if ($ids) {
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $itemStatement = $pdo->prepare("SELECT * FROM lartisan_sale_items WHERE sale_id IN ($placeholders) ORDER BY sale_id, line_number");
        $itemStatement->execute($ids);
        foreach ($itemStatement->fetchAll() as $item) $itemsBySale[$item['sale_id']][] = $item;
    }
    $sales = [];
    foreach ($saleRows as $row) {
        $items = [];
        foreach ($itemsBySale[$row['id']] ?? [] as $item) for ($count = 0; $count < (int) $item['quantity']; $count++) $items[] = [
            'id' => (int) $item['product_id'], 'name' => $item['product_name'], 'detail' => $item['presentation'] ?? '', 'category' => 'Histórico', 'price' => (float) $item['unit_price'],
        ];
        $sales[] = [
            'id' => $row['id'], 'site' => $row['site'], 'createdAt' => $row['occurred_at'], 'createdAtISO' => str_replace(' ', 'T', (string) $row['occurred_at']),
            'items' => $items, 'gross' => (float) $row['gross_amount'], 'discount' => (float) $row['discount_amount'], 'net' => (float) $row['net_amount'],
            'method' => $row['payment_method'] ?: 'Sin informar', 'invoiceType' => $row['invoice_type'] ?: 'Remito interno', 'customer' => $row['customer_name'] ?: 'Consumidor final',
            'invitation' => (bool) $row['invitation'], 'channel' => $row['channel'] ?: 'Mostrador', 'status' => $row['status'] ?: 'activa',
        ];
    }
    json_response(['ok' => true, 'site' => $site, 'sales' => $sales, 'truncated' => count($sales) >= 1000]);
}

if ($method === 'POST' && $route === 'admin/history/import') {
    $admin = require_user($pdo, ['administracion']);
    ensure_normalized_operations_schema($pdo);
    $body = request_body(); $kind = (string) ($body['kind'] ?? 'sales'); $rows = $body['rows'] ?? [];
    if (!in_array($kind, ['sales', 'cash'], true) || !is_array($rows) || !$rows || count($rows) > 5000) json_response(['ok' => false, 'error' => 'Archivo histórico inválido o demasiado grande'], 422);
    $batchHash = hash('sha256', json_encode([$kind, $rows], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $uuid = static function (string $seed): string { $hex = substr(hash('sha256', $seed), 0, 32); return substr($hex,0,8).'-'.substr($hex,8,4).'-4'.substr($hex,13,3).'-a'.substr($hex,17,3).'-'.substr($hex,20,12); };
    $imported = 0; $rejected = 0; $pdo->beginTransaction();
    try {
        if ($kind === 'sales') {
            $insert = $pdo->prepare("INSERT INTO lartisan_sales (id, site, occurred_at, gross_amount, discount_amount, net_amount, payment_method, invoice_type, customer_name, channel, status, invitation, synced_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?) ON DUPLICATE KEY UPDATE id=id");
            $paymentInsert = $pdo->prepare('INSERT INTO lartisan_sale_payments (sale_id, payment_method, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount=VALUES(amount)');
            foreach ($rows as $index => $row) {
                if (!is_array($row)) { $rejected++; continue; }
                $siteName = trim((string) ($row['local'] ?? '')); $at = historical_datetime($row['fecha'] ?? ''); $net = historical_number($row['neto'] ?? 0);
                if (!in_array($siteName, operational_sites(), true) || !$at || $net < 0) { $rejected++; continue; }
                $saleId = preg_match('/^[a-f0-9-]{36}$/i', (string) ($row['operacion'] ?? '')) ? (string) $row['operacion'] : $uuid($batchHash . '|' . $index);
                $gross = historical_number($row['bruto'] ?? $net); $discount = historical_number($row['descuento'] ?? max(0, $gross - $net)); $methodName = trim((string) ($row['medio_pago'] ?? 'Sin informar'));
                $insert->execute([$saleId, $siteName, $at, $gross, $discount, $net, $methodName, (string) ($row['comprobante'] ?? 'Remito interno'), (string) ($row['cliente'] ?? 'Consumidor final'), (string) ($row['canal'] ?? 'Mostrador'), (string) ($row['estado'] ?? 'activa'), $admin['id']]);
                $paymentInsert->execute([$saleId, $methodName, $net]); $imported++;
            }
        } else {
            $insert = $pdo->prepare("INSERT INTO lartisan_cash_sessions (id, site, opened_at, opened_by, initial_fund, closed_at, closed_by, expected_cash, counted_cash, difference_amount, envelope_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id=id");
            foreach ($rows as $index => $row) {
                if (!is_array($row)) { $rejected++; continue; }
                $siteName = trim((string) ($row['local'] ?? '')); $opened = historical_datetime($row['apertura'] ?? '');
                if (!in_array($siteName, operational_sites(), true) || !$opened) { $rejected++; continue; }
                $id = preg_match('/^[a-f0-9-]{36}$/i', (string) ($row['turno'] ?? '')) ? (string) $row['turno'] : $uuid($batchHash . '|cash|' . $index);
                $expectedValue = historical_number($row['esperado'] ?? 0); $countedValue = historical_number($row['contado'] ?? 0);
                $insert->execute([$id, $siteName, $opened, (string) ($row['abrió'] ?? $row['abrio'] ?? 'Histórico'), historical_number($row['fondo_inicial'] ?? 0), historical_datetime($row['cierre'] ?? ''), (string) ($row['cerró'] ?? $row['cerro'] ?? ''), $expectedValue, $countedValue, historical_number($row['diferencia'] ?? ($countedValue - $expectedValue)), historical_number($row['sobre'] ?? 0)]); $imported++;
            }
        }
        audit($pdo, (int) $admin['id'], 'historical_import', $kind . ': importados=' . $imported . ', rechazados=' . $rejected);
        $pdo->commit();
    } catch (Throwable $error) { $pdo->rollBack(); throw $error; }
    json_response(['ok' => true, 'imported' => $imported, 'rejected' => $rejected]);
}

if ($method === 'GET' && $route === 'admin/reset-requests') {
    require_user($pdo, ['administracion']);
    $rows = $pdo->query(
        "SELECT r.id, r.status, r.requested_at, r.resolved_at,
                u.id AS user_id, u.username, u.full_name, u.role, u.assigned_location
         FROM password_reset_requests r
         JOIN users u ON u.id = r.user_id
         ORDER BY (r.status = 'pendiente') DESC, r.requested_at DESC
         LIMIT 100"
    )->fetchAll();
    json_response(['ok' => true, 'requests' => $rows]);
}

if ($method === 'POST' && $route === 'admin/reset-password') {
    $admin = require_user($pdo, ['administracion']);
    $body = request_body();
    $requestId = (int) ($body['requestId'] ?? 0);
    $temporaryPassword = (string) ($body['temporaryPassword'] ?? '');
    if ($requestId < 1 || !valid_password($temporaryPassword)) {
        json_response(['ok' => false, 'error' => 'Solicitud o contraseña provisoria inválida'], 422);
    }
    $stmt = $pdo->prepare("SELECT user_id FROM password_reset_requests WHERE id = ? AND status = 'pendiente'");
    $stmt->execute([$requestId]);
    $userId = $stmt->fetchColumn();
    if (!$userId) {
        json_response(['ok' => false, 'error' => 'La solicitud ya no está pendiente'], 409);
    }
    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?')
            ->execute([password_hash($temporaryPassword, PASSWORD_DEFAULT), $userId]);
        $pdo->prepare("UPDATE password_reset_requests SET status = 'resuelta', resolved_at = NOW(), resolved_by = ? WHERE id = ?")
            ->execute([$admin['id'], $requestId]);
        $pdo->prepare('DELETE FROM user_sessions WHERE user_id = ?')->execute([$userId]);
        audit($pdo, (int) $admin['id'], 'temporary_password_generated', 'user_id=' . $userId);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    json_response(['ok' => true]);
}

if ($method === 'POST' && preg_match('#^admin/users/(\d+)/reset-password$#', $route, $matches)) {
    $admin = require_user($pdo, ['administracion']);
    $userId = (int) $matches[1];
    $stmt = $pdo->prepare('SELECT id, username, full_name FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $target = $stmt->fetch();
    if (!$target) {
        json_response(['ok' => false, 'error' => 'Usuario no encontrado'], 404);
    }
    if (is_primary_user($target, $config)) {
        json_response(['ok' => false, 'error' => 'La cuenta principal se recupera desde el acceso administrativo'], 422);
    }

    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    $randomPart = '';
    for ($index = 0; $index < 8; $index++) {
        $randomPart .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
    $temporaryPassword = 'Lar!' . $randomPart . '7a';

    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?')
            ->execute([password_hash($temporaryPassword, PASSWORD_DEFAULT), $userId]);
        $pdo->prepare("UPDATE password_reset_requests SET status = 'resuelta', resolved_at = NOW(), resolved_by = ? WHERE user_id = ? AND status = 'pendiente'")
            ->execute([$admin['id'], $userId]);
        $pdo->prepare('DELETE FROM user_sessions WHERE user_id = ?')->execute([$userId]);
        audit($pdo, (int) $admin['id'], 'password_reset_by_admin', 'user_id=' . $userId);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    json_response([
        'ok' => true,
        'username' => $target['username'],
        'temporaryPassword' => $temporaryPassword,
    ]);
}

if ($method === 'PATCH' && preg_match('#^admin/users/(\d+)$#', $route, $matches)) {
    $admin = require_user($pdo, ['administracion']);
    $userId = (int) $matches[1];
    $body = request_body();
    $stmt = $pdo->prepare('SELECT username, role, assigned_location, assigned_locations, access_all_locations, active, report_permissions, action_permissions, mfa_required FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $existing = $stmt->fetch();
    if (!$existing) {
        json_response(['ok' => false, 'error' => 'Usuario no encontrado'], 404);
    }
    $username = array_key_exists('username', $body)
        ? mb_strtolower(trim((string) $body['username']), 'UTF-8')
        : $existing['username'];
    $role = (string) ($body['role'] ?? $existing['role']);
    $location = array_key_exists('assignedLocation', $body)
        ? (trim((string) $body['assignedLocation']) ?: null)
        : $existing['assigned_location'];
    $allLocations = array_key_exists('accessAllLocations', $body)
        ? (!empty($body['accessAllLocations']) ? 1 : 0)
        : (int) $existing['access_all_locations'];
    $locations = array_key_exists('assignedLocations', $body)
        ? $body['assignedLocations']
        : assigned_locations($existing);
    if (!is_array($locations)) $locations = [];
    $locations = array_values(array_unique(array_filter($locations, static fn ($site): bool => is_string($site) && in_array($site, operational_sites(), true))));
    $active = array_key_exists('active', $body)
        ? (!empty($body['active']) ? 1 : 0)
        : (int) $existing['active'];
    $reportPermissions = array_key_exists('reportPermissions', $body) ? $body['reportPermissions'] : json_decode((string) ($existing['report_permissions'] ?? '[]'), true);
    $actionPermissions = array_key_exists('actionPermissions', $body) ? $body['actionPermissions'] : json_decode((string) ($existing['action_permissions'] ?? '[]'), true);
    if (!is_array($reportPermissions)) $reportPermissions = [];
    if (!is_array($actionPermissions)) $actionPermissions = [];
    $reportPermissions = array_values(array_unique(array_filter($reportPermissions, 'is_string')));
    $actionPermissions = array_values(array_unique(array_filter($actionPermissions, static fn ($permission): bool => is_string($permission) && in_array($permission, ['cobrar', 'anular', 'egresos', 'pedidos', 'incidencias', 'stock', 'gestionarStockIdeal', 'autoaprobarStockPropio', 'aprobarAjustesStock', 'transferirCaja', 'exportar', 'mrp', 'editarRecetas', 'comprasProduccion', 'stockMrp'], true))));
    // Si la edición no trae permisos, se conservan tal cual. NULL significa "los
    // del cargo": convertirlo en [] al bloquear o cambiar de local dejaba al
    // usuario sin ningún permiso (por ejemplo, sin poder cobrar).
    $reportPermissionsValue = array_key_exists('reportPermissions', $body) ? json_encode($reportPermissions, JSON_UNESCAPED_UNICODE) : $existing['report_permissions'];
    $actionPermissionsValue = array_key_exists('actionPermissions', $body) ? json_encode($actionPermissions, JSON_UNESCAPED_UNICODE) : $existing['action_permissions'];
    $mfaRequired = array_key_exists('mfaRequired', $body) ? (!empty($body['mfaRequired']) ? 1 : 0) : $existing['mfa_required'];
    if (!in_array($role, ['vendedora', 'supervisora', 'compras', 'administracion'], true)) {
        json_response(['ok' => false, 'error' => 'Cargo inválido'], 422);
    }
    if (array_intersect(['gestionarStockIdeal', 'autoaprobarStockPropio', 'aprobarAjustesStock'], $actionPermissions) && $role !== 'supervisora') {
        json_response(['ok' => false, 'error' => 'Los permisos especiales de stock solo pueden asignarse a una supervisora.'], 422);
    }
    if (!valid_username($username)) {
        json_response(['ok' => false, 'error' => 'Usuario o correo laboral inválido'], 422);
    }
    if (is_primary_user($existing, $config) && ($role !== 'administracion' || !$active)) {
        json_response(['ok' => false, 'error' => 'La cuenta principal no puede bloquearse ni cambiar de cargo'], 422);
    }
    if ($allLocations) {
        $locations = operational_sites();
    } elseif (!$locations) {
        json_response(['ok' => false, 'error' => 'Seleccioná al menos un local o Todos los locales'], 422);
    }
    $location = $locations[0] ?? $location;
    $pdo->prepare(
        'UPDATE users SET username = ?, role = ?, assigned_location = ?, assigned_locations = ?, access_all_locations = ?, active = ?, report_permissions = ?, action_permissions = ?, mfa_required = ? WHERE id = ?'
    )->execute([$username, $role, $location, json_encode($locations, JSON_UNESCAPED_UNICODE), $allLocations, $active, $reportPermissionsValue, $actionPermissionsValue, $mfaRequired, $userId]);
    audit($pdo, (int) $admin['id'], 'user_updated', 'user_id=' . $userId);
    json_response(['ok' => true]);
}

if ($method === 'GET' && $route === 'admin/users') {
    require_user($pdo, ['administracion']);
    $rows = $pdo->query(
        'SELECT id, username, full_name, role, assigned_location, assigned_locations, access_all_locations, active, must_change_password, report_permissions, action_permissions, mfa_required, created_at
         FROM users ORDER BY full_name'
    )->fetchAll();
    $users = array_map(static fn (array $row): array => public_user($row, $config) + [
        'active' => (bool) $row['active'],
        'created_at' => $row['created_at'],
    ], $rows);
    json_response(['ok' => true, 'users' => $users]);
}

if ($method === 'GET' && $route === 'admin/health') {
    require_user($pdo, ['administracion']);
    $totalUsers = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    $activeUsers = (int) $pdo->query('SELECT COUNT(*) FROM users WHERE active = 1')->fetchColumn();
    $freeBytes = function_exists('disk_free_space') ? @disk_free_space(__DIR__) : false;
    json_response([
        'ok' => true,
        'database' => 'Disponible',
        'users' => ['total' => $totalUsers, 'active' => $activeUsers],
        'space' => $freeBytes === false ? null : (int) $freeBytes,
        'checked_at' => gmdate('c'),
    ]);
}

if ($method === 'GET' && $route === 'admin/monitoring') {
    require_user($pdo, ['administracion']);
    ensure_pnl_sync_schema($pdo);
    ensure_expense_sync_schema($pdo);
    ensure_mrp_schema($pdo);

    $startedAt = microtime(true);
    $pdo->query('SELECT 1');
    $databaseLatencyMs = (int) round((microtime(true) - $startedAt) * 1000);
    $freeBytes = function_exists('disk_free_space') ? @disk_free_space(__DIR__) : false;
    $totalUsers = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    $activeUsers = (int) $pdo->query('SELECT COUNT(*) FROM users WHERE active = 1')->fetchColumn();
    $events24h = (int) $pdo->query("SELECT COUNT(*) FROM operation_events WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $failedPnl = (int) $pdo->query("SELECT COUNT(*) FROM pnl_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $failedExpenses = (int) $pdo->query("SELECT COUNT(*) FROM expense_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $failedMrp = (int) $pdo->query("SELECT COUNT(*) FROM mrp_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $lastPnl = $pdo->query("SELECT finished_at, status FROM pnl_sync_runs ORDER BY id DESC LIMIT 1")->fetch();
    $lastExpenses = $pdo->query("SELECT finished_at, status FROM expense_sync_runs ORDER BY id DESC LIMIT 1")->fetch();
    $lastMrp = $pdo->query("SELECT finished_at, status FROM mrp_sync_runs ORDER BY id DESC LIMIT 1")->fetch();
    $lastBackup = null;
    if (table_exists($pdo, 'backup_runs')) {
        $lastBackup = $pdo->query('SELECT finished_at, status FROM backup_runs ORDER BY id DESC LIMIT 1')->fetch();
    }

    $alerts = [];
    if (($failedPnl + $failedExpenses + $failedMrp) > 0) {
        $alerts[] = ['level' => 'atencion', 'message' => 'Hubo sincronizaciones que no se completaron en las últimas 24 horas.'];
    }
    if (!$lastBackup || ($lastBackup['status'] ?? '') !== 'verified') {
        $alerts[] = ['level' => 'atencion', 'message' => 'No hay un respaldo externo verificado recientemente.'];
    }
    if ($freeBytes !== false && $freeBytes < 512 * 1024 * 1024) {
        $alerts[] = ['level' => 'critico', 'message' => 'El espacio disponible del servidor está por debajo de 512 MB.'];
    }

    json_response([
        'ok' => true,
        'api' => 'Disponible',
        'database' => 'Disponible',
        'database_latency_ms' => $databaseLatencyMs,
        'users' => ['total' => $totalUsers, 'active' => $activeUsers],
        'space' => $freeBytes === false ? null : (int) $freeBytes,
        'events_24h' => $events24h,
        'failed_syncs_24h' => $failedPnl + $failedExpenses + $failedMrp,
        'drive_connected' => pnl_is_connected($pdo, $config),
        'last_pnl_sync' => $lastPnl ?: null,
        'last_expense_sync' => $lastExpenses ?: null,
        'last_mrp_sync' => $lastMrp ?: null,
        'last_backup' => $lastBackup ?: null,
        'alerts' => $alerts,
        'checked_at' => gmdate('c'),
    ]);
}

if ($method === 'GET' && $route === 'admin/backups/latest') {
    require_user($pdo, ['administracion']);
    $pdo->exec("CREATE TABLE IF NOT EXISTS backup_runs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, started_at DATETIME NOT NULL, finished_at DATETIME NULL,
        status VARCHAR(30) NOT NULL, filename VARCHAR(255) NOT NULL, size_bytes BIGINT UNSIGNED NULL,
        sha256 CHAR(64) NULL, drive_file_id VARCHAR(255) NULL, error_message VARCHAR(1000) NULL,
        INDEX idx_backup_runs_started (started_at), INDEX idx_backup_runs_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $latest = $pdo->query('SELECT started_at, finished_at, status, filename, size_bytes, error_message FROM backup_runs ORDER BY id DESC LIMIT 1')->fetch();
    json_response(['ok' => true, 'backup' => $latest ?: null]);
}

if ($method === 'POST' && $route === 'admin/backups/run') {
    $admin = require_user($pdo, ['administracion']);
    $pdo->exec("CREATE TABLE IF NOT EXISTS backup_runs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, started_at DATETIME NOT NULL, finished_at DATETIME NULL,
        status VARCHAR(30) NOT NULL, filename VARCHAR(255) NOT NULL, size_bytes BIGINT UNSIGNED NULL,
        sha256 CHAR(64) NULL, drive_file_id VARCHAR(255) NULL, error_message VARCHAR(1000) NULL,
        INDEX idx_backup_runs_started (started_at), INDEX idx_backup_runs_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $last = $pdo->query("SELECT started_at FROM backup_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE) ORDER BY id DESC LIMIT 1")->fetchColumn();
    if ($last) json_response(['ok' => false, 'error' => 'Ya hay un respaldo iniciado hace menos de cinco minutos.'], 429);
    if (!function_exists('exec') || !defined('PHP_BINARY') || PHP_BINARY === '') {
        json_response(['ok' => false, 'error' => 'El hosting no permite iniciar respaldos bajo demanda.'], 503);
    }
    $command = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/backup.php') . ' run 2>&1';
    $output = [];
    $exitCode = 1;
    exec($command, $output, $exitCode);
    audit($pdo, (int) $admin['id'], 'backup_before_update', 'resultado=' . $exitCode);
    if ($exitCode !== 0) json_response(['ok' => false, 'error' => 'El respaldo previo no se pudo verificar. No publiques una actualización.', 'detail' => implode("\n", array_slice($output, -3))], 500);
    json_response(['ok' => true, 'message' => 'Respaldo previo verificado y enviado a Drive.']);
}

if ($method === 'POST' && $route === 'admin/users') {
    $admin = require_user($pdo, ['administracion']);
    $body = request_body();
    $username = mb_strtolower(trim((string) ($body['username'] ?? '')), 'UTF-8');
    $fullName = trim((string) ($body['fullName'] ?? ''));
    $role = (string) ($body['role'] ?? '');
    $location = trim((string) ($body['assignedLocation'] ?? '')) ?: null;
    $allLocations = !empty($body['accessAllLocations']) ? 1 : 0;
    $locations = $body['assignedLocations'] ?? ($location ? [$location] : []);
    if (!is_array($locations)) $locations = [];
    $locations = array_values(array_unique(array_filter($locations, static fn ($site): bool => is_string($site) && in_array($site, operational_sites(), true))));
    if ($allLocations) $locations = operational_sites();
    $temporaryPassword = (string) ($body['temporaryPassword'] ?? '');
    $reportPermissions = is_array($body['reportPermissions'] ?? null) ? array_values(array_filter($body['reportPermissions'], 'is_string')) : null;
    $actionPermissions = is_array($body['actionPermissions'] ?? null) ? array_values(array_filter($body['actionPermissions'], 'is_string')) : null;
    $mfaRequired = array_key_exists('mfaRequired', $body) ? (!empty($body['mfaRequired']) ? 1 : 0) : null;
    $fieldErrors = [];
    if ($fullName === '') $fieldErrors['fullName'] = 'Ingresá nombre y apellido.';
    if (!valid_username($username)) $fieldErrors['username'] = 'Usá nombre.apellido o un correo @lartisantaller.com.';
    if (!in_array($role, ['vendedora', 'supervisora', 'compras', 'administracion'], true)) $fieldErrors['role'] = 'Seleccioná un cargo válido.';
    if (is_array($actionPermissions) && array_intersect(['gestionarStockIdeal', 'autoaprobarStockPropio', 'aprobarAjustesStock'], $actionPermissions) && $role !== 'supervisora') $fieldErrors['actionPermissions'] = 'Los permisos especiales de stock solo pueden asignarse a una supervisora.';
    if (!$locations) $fieldErrors['locations'] = 'Seleccioná al menos un local o Todos los locales.';
    if (!valid_password($temporaryPassword)) $fieldErrors['temporaryPassword'] = 'Debe tener 8 o más caracteres, mayúscula, minúscula, número y símbolo.';
    if ($fieldErrors) {
        json_response(['ok' => false, 'error' => 'Revisá los campos marcados.', 'fields' => $fieldErrors], 422);
    }
    $stmt = $pdo->prepare(
        'INSERT INTO users (username, full_name, password_hash, role, assigned_location, assigned_locations, access_all_locations, report_permissions, action_permissions, mfa_required)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    try {
        $stmt->execute([$username, $fullName, password_hash($temporaryPassword, PASSWORD_DEFAULT), $role, $locations[0], json_encode($locations, JSON_UNESCAPED_UNICODE), $allLocations, $reportPermissions === null ? null : json_encode($reportPermissions, JSON_UNESCAPED_UNICODE), $actionPermissions === null ? null : json_encode($actionPermissions, JSON_UNESCAPED_UNICODE), $mfaRequired]);
    } catch (PDOException $error) {
        if ((string) $error->getCode() === '23000') {
            json_response(['ok' => false, 'error' => 'Ese nombre de usuario ya existe', 'fields' => ['username' => 'Ese usuario ya está en uso.']], 409);
        }
        throw $error;
    }
    $newId = (int) $pdo->lastInsertId();
    audit($pdo, (int) $admin['id'], 'user_created', 'user_id=' . $newId);
    json_response(['ok' => true, 'id' => $newId], 201);
}

json_response(['ok' => false, 'error' => 'Ruta no encontrada'], 404);
