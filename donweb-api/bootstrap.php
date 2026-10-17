<?php

declare(strict_types=1);

const SESSION_COOKIE = 'lartisan_session';

// Producción usa config.local.php. Un entorno de pruebas puede indicar otro
// archivo con LARTISAN_CONFIG para no mezclar nunca su configuración con la real.
$configPath = getenv('LARTISAN_CONFIG') ?: __DIR__ . '/config.local.php';
if (!is_file($configPath)) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Servicio no configurado']);
    exit;
}

$config = require $configPath;

// El hosting todavía usa PHP 7.4. Estas funciones estándar se incorporaron en
// PHP 8; se definen de forma compatible para que el mismo código funcione en
// ambos entornos sin alterar datos operativos.
if (!function_exists('str_starts_with')) {
    function str_starts_with(string $haystack, string $needle): bool
    {
        return $needle === '' || strncmp($haystack, $needle, strlen($needle)) === 0;
    }
}
if (!function_exists('str_ends_with')) {
    function str_ends_with(string $haystack, string $needle): bool
    {
        return $needle === '' || substr($haystack, -strlen($needle)) === $needle;
    }
}
if (!function_exists('str_contains')) {
    function str_contains(string $haystack, string $needle): bool
    {
        return $needle === '' || strpos($haystack, $needle) !== false;
    }
}

// Una sola zona horaria para PHP y MySQL (ver db()). Antes PHP quedaba en la
// del servidor (UTC) y MySQL en la suya: sesiones y códigos de recuperación
// vencían horas más tarde y las ventas nocturnas caían en el día siguiente.
date_default_timezone_set((string) ($config['timezone'] ?? 'America/Argentina/Buenos_Aires'));

// Las credenciales de Google se mantienen fuera de public_html. El archivo
// privado ya se usa para los respaldos y comparte la conexión de solo lectura
// con los informes, sin exponer secretos desde la API.
$privateIntegrationPath = dirname(__DIR__, 2) . '/lartisan-backup-config.php';
if (is_file($privateIntegrationPath)) {
    $privateIntegrationConfig = require $privateIntegrationPath;
    if (is_array($privateIntegrationConfig)) {
        $config['backup'] = array_replace_recursive($config['backup'] ?? [], $privateIntegrationConfig);
    }
}

// La escritura de cierres en Google Sheets se configura por separado de los
// respaldos: así no es necesario abrir ni mezclar el archivo que contiene
// credenciales de Drive. El archivo vive fuera de public_html.
$privateCashSheetPath = dirname(__DIR__, 2) . '/lartisan-cash-sheet-config.php';
if (is_file($privateCashSheetPath)) {
    $privateCashSheetConfig = require $privateCashSheetPath;
    if (is_array($privateCashSheetConfig)) {
        $config['cash_sheet_sync'] = array_replace_recursive(
            $config['cash_sheet_sync'] ?? [],
            $privateCashSheetConfig
        );
    }
}

// La clave de OpenAI vive fuera de public_html y nunca se envía al navegador.
$privateAiPath = dirname(__DIR__, 2) . '/lartisan-ai-config.php';
if (is_file($privateAiPath)) {
    $privateAiConfig = require $privateAiPath;
    if (is_array($privateAiConfig)) {
        $config['openai'] = array_replace_recursive($config['openai'] ?? [], $privateAiConfig);
    }
}

// La integración fiscal se configura exclusivamente fuera de public_html.
// Este archivo puede contener únicamente rutas a certificado/clave y parámetros
// operativos; nunca se devuelve por la API ni queda versionado en el proyecto.
$privateArcaPath = dirname(__DIR__, 2) . '/lartisan-arca-config.php';
if (is_file($privateArcaPath)) {
    $privateArcaConfig = require $privateArcaPath;
    if (is_array($privateArcaConfig)) {
        $config['arca'] = array_replace_recursive($config['arca'] ?? [], $privateArcaConfig);
    }
}

// Villa Mitre (Tres Arroyos 1902) opera con el punto RECE Web Services 00006.
// Se incorpora como valor seguro por defecto sin reemplazar una eventual
// configuración específica guardada en el archivo privado del servidor.
if (is_array($config['arca'] ?? null)) {
    $config['arca']['points_of_sale'] ??= [];
    if (is_array($config['arca']['points_of_sale']) && !array_key_exists('Villa Mitre', $config['arca']['points_of_sale'])) {
        $config['arca']['points_of_sale']['Villa Mitre'] = 6;
    }
}

function json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// En la web, un error no controlado responde JSON genérico y queda en el log
// del servidor; nunca se muestran trazas, rutas ni SQL al navegador.
if (PHP_SAPI !== 'cli') {
    ini_set('display_errors', '0');
    set_exception_handler(static function (Throwable $error): void {
        error_log('LARTISAN API unhandled ' . get_class($error) . ': ' . $error->getMessage() . ' @ ' . $error->getFile() . ':' . $error->getLine());
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode(['ok' => false, 'error' => 'Error interno. Intentá nuevamente o avisá a Administración.'], JSON_UNESCAPED_UNICODE);
    });
}

function request_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        json_response(['ok' => false, 'error' => 'JSON inválido'], 400);
    }
    return $data;
}

function configure_cors(array $config): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && in_array($origin, $config['allowed_origins'], true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');
        header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, OPTIONS');
        header('Vary: Origin');
    }
    header('X-Content-Type-Options: nosniff');
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
}

function db(array $config): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $database = $config['database'];
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $database['host'], $database['name']);
    $pdo = new PDO($dsn, $database['user'], $database['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    // NOW(), CURRENT_TIMESTAMP y las comparaciones de vencimiento usan la misma
    // hora que PHP. Se fija por diferencia (+/-HH:MM) porque el hosting puede no
    // tener cargadas las zonas horarias con nombre en MySQL.
    $pdo->exec("SET time_zone = '" . (new DateTimeImmutable())->format('P') . "'");
    return $pdo;
}

function client_ip(): string
{
    return substr($_SERVER['REMOTE_ADDR'] ?? '', 0, 45);
}

function audit(PDO $pdo, ?int $userId, string $type, ?string $detail = null): void
{
    $stmt = $pdo->prepare(
        'INSERT INTO audit_log (user_id, event_type, event_detail, ip_address) VALUES (?, ?, ?, ?)'
    );
    $stmt->execute([$userId, $type, $detail, client_ip()]);
}

function is_primary_user(array $user, array $config): bool
{
    $primary = mb_strtolower(trim((string) ($config['primary_admin_username'] ?? $config['admin_recovery_email'] ?? '')), 'UTF-8');
    return $primary !== '' && hash_equals($primary, mb_strtolower((string) ($user['username'] ?? ''), 'UTF-8'));
}

function public_user(array $user, array $config): array
{
    $result = [
        'id' => (int) $user['id'],
        'username' => $user['username'],
        'fullName' => $user['full_name'],
        'role' => $user['role'],
        'jobTitle' => $user['job_title'] ?? null,
        'assignedLocation' => $user['assigned_location'],
        'assignedLocations' => assigned_locations($user),
        'accessAllLocations' => (bool) $user['access_all_locations'],
        'mustChangePassword' => (bool) $user['must_change_password'],
        'primary' => is_primary_user($user, $config),
    ];
    if (($user['report_permissions'] ?? null) !== null) {
        $result['reportPermissions'] = json_decode((string) $user['report_permissions'], true) ?: [];
    }
    $result['actionPermissions'] = user_action_permissions($user);
    // Habilitación operativa acotada: las compras de producción se cargan
    // únicamente desde Villa Mitre por las dos responsables designadas.
    if (is_production_purchase_loader($user)) $result['actionPermissions'][] = 'comprasProduccion';
    $result['actionPermissions'] = array_values(array_unique($result['actionPermissions']));
    return $result;
}

function ensure_user_locations_schema(PDO $pdo): void
{
    // Algunas instalaciones iniciales definieron el cargo como ENUM sin el
    // perfil de Compras. MySQL lo convertía silenciosamente en un valor vacío,
    // que la interfaz mostraba como Vendedora. Se amplía el catálogo una vez
    // para que el perfil MRP se conserve correctamente.
    $roleColumn = $pdo->query("SHOW COLUMNS FROM users LIKE 'role'")->fetch();
    $roleType = strtolower((string) ($roleColumn['Type'] ?? ''));
    if (str_starts_with($roleType, 'enum(') && (!str_contains($roleType, "'compras'") || !str_contains($roleType, "'personal'"))) {
        $pdo->exec("ALTER TABLE users MODIFY role ENUM('vendedora','supervisora','compras','administracion','personal') NOT NULL DEFAULT 'vendedora'");
    }
    $column = $pdo->query("SHOW COLUMNS FROM users LIKE 'assigned_locations'")->fetch();
    if (!$column) {
        $pdo->exec('ALTER TABLE users ADD COLUMN assigned_locations TEXT NULL AFTER assigned_location');
    }
    foreach ([
        'report_permissions' => 'TEXT NULL',
        'action_permissions' => 'TEXT NULL',
        'mfa_required' => 'TINYINT(1) NULL',
        'job_title' => 'VARCHAR(80) NULL',
    ] as $name => $definition) {
        $existing = $pdo->query("SHOW COLUMNS FROM users LIKE " . $pdo->quote($name))->fetch();
        if (!$existing) $pdo->exec("ALTER TABLE users ADD COLUMN $name $definition");
    }
}

function table_exists(PDO $pdo, string $table): bool
{
    $statement = $pdo->query('SHOW TABLES LIKE ' . $pdo->quote($table));
    return (bool) $statement->fetchColumn();
}

function ensure_personnel_files_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS lartisan_personnel_files (
        id CHAR(36) NOT NULL PRIMARY KEY, employee_user_id BIGINT UNSIGNED NOT NULL,
        job_title VARCHAR(80) NULL, assigned_site VARCHAR(120) NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'activo', created_by BIGINT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_personnel_file_user (employee_user_id), KEY idx_personnel_file_site (assigned_site),
        CONSTRAINT fk_personnel_file_user FOREIGN KEY (employee_user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function assigned_locations(array $user): array
{
    $raw = $user['assigned_locations'] ?? null;
    $decoded = is_string($raw) ? json_decode($raw, true) : null;
    $locations = is_array($decoded) ? $decoded : [];
    $locations = array_values(array_filter($locations, static fn ($site): bool => is_string($site) && in_array($site, operational_sites(), true)));
    if (!$locations && !empty($user['assigned_location']) && in_array($user['assigned_location'], operational_sites(), true)) {
        $locations = [$user['assigned_location']];
    }
    return $locations;
}

function current_user(PDO $pdo): ?array
{
    global $config;

    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if (!is_string($token) || strlen($token) < 32) {
        return null;
    }
    $sessionId = hash('sha256', $token);
    // La expiración absoluta evita sesiones olvidadas durante días. El límite de
    // inactividad protege además los equipos compartidos de los locales.
    $idleMinutes = max(5, min(240, (int) ($config['session_idle_minutes'] ?? 30)));
    $stmt = $pdo->prepare(
        "SELECT u.* FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ?
           AND s.expires_at > NOW()
           AND s.last_seen_at > DATE_SUB(NOW(), INTERVAL $idleMinutes MINUTE)
           AND u.active = 1"
    );
    $stmt->execute([$sessionId]);
    $user = $stmt->fetch();
    if (!$user) {
        return null;
    }
    $pdo->prepare('UPDATE user_sessions SET last_seen_at = NOW() WHERE id = ?')->execute([$sessionId]);
    return $user;
}

function require_user(PDO $pdo, ?array $roles = null): array
{
    $user = current_user($pdo);
    if (!$user) {
        json_response(['ok' => false, 'error' => 'Sesión requerida'], 401);
    }
    if ($roles !== null && !in_array($user['role'], $roles, true)) {
        json_response(['ok' => false, 'error' => 'Acceso no autorizado'], 403);
    }
    return $user;
}

function set_session_cookie(string $token, array $config, int $expires): void
{
    setcookie(SESSION_COOKIE, $token, [
        'expires' => $expires,
        'path' => '/',
        'domain' => $config['cookie_domain'],
        // Producción conserva HTTPS obligatorio. El único caso HTTP admitido es
        // el entorno audiovisual local, que debe declararlo explícitamente en
        // su configuración aislada y nunca se publica.
        'secure' => (bool) ($config['cookie_secure'] ?? true),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function create_session(PDO $pdo, int $userId, array $config): void
{
    $token = bin2hex(random_bytes(32));
    $sessionId = hash('sha256', $token);
    $hours = max(1, min(48, (int) ($config['session_hours'] ?? 12)));
    $expiresAt = (new DateTimeImmutable())->modify('+' . $hours . ' hours');
    $stmt = $pdo->prepare('INSERT INTO user_sessions (id, user_id, expires_at, last_seen_at) VALUES (?, ?, ?, NOW())');
    $stmt->execute([$sessionId, $userId, $expiresAt->format('Y-m-d H:i:s')]);
    set_session_cookie($token, $config, $expiresAt->getTimestamp());
}

function clear_session(PDO $pdo, array $config): void
{
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if (is_string($token) && $token !== '') {
        $pdo->prepare('DELETE FROM user_sessions WHERE id = ?')->execute([hash('sha256', $token)]);
    }
    set_session_cookie('', $config, time() - 3600);
}

function valid_password(string $password): bool
{
    return strlen($password) >= 8
        && preg_match('/[a-z]/', $password)
        && preg_match('/[A-Z]/', $password)
        && preg_match('/\d/', $password)
        && preg_match('/[^a-zA-Z0-9]/', $password);
}

function valid_username(string $username): bool
{
    if (preg_match('/^[a-záéíóúüñ0-9]+(?:\.[a-záéíóúüñ0-9]+)+$/u', $username)) {
        return true;
    }
    if (!filter_var($username, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    return str_ends_with(mb_strtolower($username, 'UTF-8'), '@lartisantaller.com');
}

function default_operational_sites(): array
{
    return ['Recoleta', 'Villa Mitre', 'Congreso', 'Maure', 'Novo Pacheco'];
}

/**
 * The location catalogue is data, not a front-end constant.  Keeping the
 * legacy fallback means that a partially upgraded installation remains
 * available while the schema migration runs for the first time.
 */
function ensure_locations_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS lartisan_locations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        site VARCHAR(80) NOT NULL,
        site_code VARCHAR(48) NOT NULL,
        kind ENUM('Local propio','Franquicia') NOT NULL DEFAULT 'Local propio',
        address VARCHAR(220) NOT NULL DEFAULT '',
        city VARCHAR(100) NOT NULL DEFAULT '',
        province VARCHAR(100) NOT NULL DEFAULT '',
        contact_name VARCHAR(120) NULL,
        contact_phone VARCHAR(50) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_by BIGINT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by BIGINT UNSIGNED NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_lartisan_locations_site (site),
        UNIQUE KEY uq_lartisan_locations_code (site_code),
        KEY idx_lartisan_locations_active (active, site)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $insert = $pdo->prepare("INSERT IGNORE INTO lartisan_locations (site, site_code, kind, active) VALUES (?, ?, 'Local propio', 1)");
    foreach (default_operational_sites() as $site) {
        $code = strtolower(str_replace(' ', '-', $site));
        $insert->execute([$site, $code]);
    }
}

function operational_sites(bool $includeInactive = false): array
{
    global $pdo;
    static $cache = [];
    $key = $includeInactive ? 'all' : 'active';
    if (isset($cache[$key])) return $cache[$key];
    if (!isset($pdo) || !($pdo instanceof PDO)) return default_operational_sites();
    try {
        ensure_locations_schema($pdo);
        $sql = 'SELECT site FROM lartisan_locations' . ($includeInactive ? '' : ' WHERE active = 1') . ' ORDER BY site';
        $rows = $pdo->query($sql)->fetchAll(PDO::FETCH_COLUMN);
        return $cache[$key] = $rows ? array_values(array_map('strval', $rows)) : default_operational_sites();
    } catch (Throwable $error) {
        error_log('LARTISAN location catalogue unavailable: ' . $error->getMessage());
        return $cache[$key] = default_operational_sites();
    }
}

function user_can_access_site(array $user, string $site): bool
{
    if (!in_array($site, operational_sites(), true)) {
        return false;
    }
    return (bool) $user['access_all_locations']
        || in_array($site, assigned_locations($user), true);
}

function user_action_permissions(array $user): array
{
    if (($user['action_permissions'] ?? null) === null) {
        if ($user['role'] === 'compras') return ['mrp'];
        return $user['role'] === 'supervisora'
            ? ['cobrar', 'anular', 'egresos', 'pedidos', 'incidencias', 'stock', 'transferirCaja', 'exportar']
            : ['cobrar', 'anular', 'egresos', 'pedidos', 'incidencias', 'transferirCaja'];
    }
    $decoded = json_decode((string) ($user['action_permissions'] ?? '[]'), true);
    return is_array($decoded) ? array_values(array_filter($decoded, 'is_string')) : [];
}

function user_can_action(array $user, string $permission): bool
{
    // La anulación de una venta está disponible para quien la cobra en el
    // local. Nunca borra la venta: queda una auditoría con usuario y hora.
    if ($permission === 'anular' && $user['role'] === 'vendedora') return true;
    // El stock ideal es una configuración operativa acotada: no se concede por
    // cargo ni por el bypass administrativo. Administración asigna esta acción
    // explícitamente a las supervisoras responsables desde Usuarios.
    if (in_array($permission, ['gestionarStockIdeal', 'autoaprobarStockPropio', 'aprobarAjustesStock'], true)) {
        return $user['role'] === 'supervisora'
            && in_array($permission, user_action_permissions($user), true);
    }
    return $user['role'] === 'administracion' || in_array($permission, user_action_permissions($user), true);
}

function is_production_purchase_loader(array $user): bool
{
    $username = strtolower(trim((string) ($user['username'] ?? '')));
    // Antes dependía de dos nombres de usuario fijos en el código. Ahora lo
    // habilita Administración con el permiso «Cargar compras de producción».
    return $username !== ''
        && in_array('comprasProduccion', user_action_permissions($user), true)
        && user_can_access_site($user, 'Villa Mitre');
}

function user_can_report(array $user, string $report): bool
{
    if ($user['role'] === 'administracion') return true;
    $decoded = json_decode((string) ($user['report_permissions'] ?? '[]'), true);
    return is_array($decoded) && in_array($report, $decoded, true);
}

/**
 * A browser always sends a complete snapshot. The server accepts only the
 * portions authorized for the authenticated account and preserves everything
 * else, so a forged request cannot bypass a hidden/disabled control.
 */
function authorize_operational_snapshot(array $user, array $previous, array $incoming): array
{
    if ($user['role'] === 'administracion') {
        unset($incoming['audit']);
        $incoming['audit'] = $previous['audit'] ?? [];
        // Administración administra quién puede editar el ideal, pero no lo
        // modifica: evita que un snapshot administrativo pise los valores de
        // las supervisoras autorizadas.
        $incoming['minimumStock'] = $previous['minimumStock'] ?? [];
        return $incoming;
    }

    $rules = [
        'sales' => ['cobrar', 'anular'],
        'payments' => ['cobrar', 'anular'],
        'savedOrders' => ['cobrar'],
        'returnsLog' => ['anular'],
        'expensesLog' => ['egresos'],
        'cashAdjustments' => ['egresos'],
        'stockRequests' => ['pedidos'],
        'incidents' => ['incidencias'],
        'realStock' => ['stock'],
        'stockCountComments' => ['stock'],
        'minimumStock' => ['gestionarStockIdeal'],
        'cashTransfers' => ['transferirCaja'],
        'stock' => ['cobrar', 'anular', 'pedidos'],
        'stockMovements' => ['cobrar', 'anular', 'pedidos'],
        'cash' => ['cobrar', 'egresos', 'transferirCaja'],
        'cashOpen' => ['cobrar'],
        'activeShift' => ['cobrar'],
        'shiftLog' => ['cobrar'],
        'envelopeRecords' => ['cobrar'],
        'cashLedger' => ['cobrar', 'egresos', 'transferirCaja'],
        'attendanceRecords' => ['cobrar', 'pedidos', 'incidencias'],
        // La cartera pertenece al local y requiere una acción comercial; el
        // servidor la filtra igual que el resto del snapshot.
        'customers' => ['cobrar'],
    ];
    $serverOnly = ['prices', 'onlinePrices', 'limitsBySite', 'priceChanges', 'audit'];
    $result = $previous;
    foreach ($incoming as $key => $value) {
        if (!is_string($key) || in_array($key, $serverOnly, true)) continue;
        $required = $rules[$key] ?? [];
        if (!$required) continue;
        foreach ($required as $permission) {
            if (user_can_action($user, $permission)) {
                $result[$key] = $value;
                break;
            }
        }
    }
    if (array_key_exists('schedules', $incoming) && user_can_report($user, 'Personal')) {
        $result['schedules'] = $incoming['schedules'];
    }
    // Los ajustes nunca se aceptan como una lista libre desde el navegador.
    // Una supervisora autorizada puede autoaplicar únicamente sus propios
    // conteos; el resto queda pendiente para la supervisora revisora.
    if (array_key_exists('stockAdjustments', $incoming) && user_can_action($user, 'stock')) {
        $known = operational_items_by_id($previous['stockAdjustments'] ?? []);
        $accepted = is_array($result['stockAdjustments'] ?? null) ? $result['stockAdjustments'] : [];
        // Si una supervisora recibe la autoaprobación después de haber cargado
        // un conteo propio, regularizamos únicamente esos pendientes. Nunca se
        // toca un ajuste de otra persona ni se aplica dos veces: al aprobarse,
        // deja de cumplir la condición Pendiente.
        if (user_can_action($user, 'autoaprobarStockPropio')) {
            $currentName = (string) ($user['full_name'] ?? $user['username'] ?? '');
            foreach ($accepted as $index => $existing) {
                if (!is_array($existing) || ($existing['status'] ?? '') !== 'Pendiente' || ($existing['requestedBy'] ?? '') !== $currentName) continue;
                $productId = filter_var($existing['productId'] ?? null, FILTER_VALIDATE_INT);
                if ($productId === false || $productId < 1 || !is_numeric($existing['counted'] ?? null) || !is_numeric($existing['theoretical'] ?? null)) continue;
                $accepted[$index]['status'] = 'Aprobado';
                $result['stock'] = is_array($result['stock'] ?? null) ? $result['stock'] : [];
                $delta = (float) $existing['counted'] - (float) $existing['theoretical'];
                $result['stock'][$productId] = max(0, (float) ($result['stock'][$productId] ?? 0) + $delta);
                $result['stockMovements'] = is_array($result['stockMovements'] ?? null) ? $result['stockMovements'] : [];
                $now = new DateTimeImmutable('now');
                $hex = bin2hex(random_bytes(16));
                array_unshift($result['stockMovements'], [
                    'id' => substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-4' . substr($hex, 13, 3) . '-a' . substr($hex, 17, 3) . '-' . substr($hex, 20, 12),
                    'site' => $existing['site'] ?? '', 'productId' => $productId, 'kind' => 'Ajuste de inventario',
                    'quantity' => $delta, 'remito' => '', 'detail' => (string) ($existing['reason'] ?? ''), 'reference' => (string) ($existing['id'] ?? ''),
                    'at' => $now->format('j/n/Y, H:i:s'),
                    'atISO' => $now->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\\TH:i:s.v\\Z'),
                    'createdBy' => $currentName,
                ]);
            }
        }
        foreach (is_array($incoming['stockAdjustments']) ? $incoming['stockAdjustments'] : [] as $candidate) {
            if (!is_array($candidate) || empty($candidate['id']) || !is_scalar($candidate['id'])) continue;
            $id = (string) $candidate['id'];
            if (isset($known[$id])) continue;
            $productId = filter_var($candidate['productId'] ?? null, FILTER_VALIDATE_INT);
            if ($productId === false || $productId < 1 || !is_numeric($candidate['counted'] ?? null) || !is_numeric($candidate['theoretical'] ?? null)) continue;
            $counted = max(0, (float) $candidate['counted']);
            $theoretical = max(0, (float) $candidate['theoretical']);
            $reason = trim((string) ($candidate['reason'] ?? ''));
            if ($reason === '') continue;
            $automatic = user_can_action($user, 'autoaprobarStockPropio');
            $adjustment = [
                'id' => $id,
                'site' => (string) ($candidate['site'] ?? ''),
                'productId' => $productId,
                'counted' => $counted,
                'theoretical' => $theoretical,
                'reason' => mb_substr($reason, 0, 300, 'UTF-8'),
                'requestedAt' => (new DateTimeImmutable('now'))->format('j/n/Y, H:i:s'),
                'requestedBy' => (string) ($user['full_name'] ?? $user['username'] ?? 'Supervisión'),
                'status' => $automatic ? 'Aprobado' : 'Pendiente',
            ];
            $accepted[] = $adjustment;
            if (!$automatic) continue;
            $delta = $counted - $theoretical;
            $result['stock'] = is_array($result['stock'] ?? null) ? $result['stock'] : [];
            $result['stock'][$productId] = max(0, (float) ($result['stock'][$productId] ?? 0) + $delta);
            $result['stockMovements'] = is_array($result['stockMovements'] ?? null) ? $result['stockMovements'] : [];
            $hex = bin2hex(random_bytes(16));
            array_unshift($result['stockMovements'], [
                'id' => substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-4' . substr($hex, 13, 3) . '-a' . substr($hex, 17, 3) . '-' . substr($hex, 20, 12),
                'site' => $adjustment['site'], 'productId' => $productId, 'kind' => 'Ajuste de inventario',
                'quantity' => $delta, 'remito' => '', 'detail' => $adjustment['reason'], 'reference' => $id,
                'at' => (new DateTimeImmutable('now'))->format('j/n/Y, H:i:s'),
                'atISO' => (new DateTimeImmutable('now'))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\\TH:i:s.v\\Z'),
                'createdBy' => (string) ($user['full_name'] ?? $user['username'] ?? 'Supervisión'),
            ]);
        }
        $result['stockAdjustments'] = $accepted;
    }
    return $result;
}

/**
 * Central de pedidos (Villa Mitre, permiso «pedidos»): mismo criterio que la
 * interfaz. Ve y gestiona los pedidos de todos los locales sin poder operar en
 * los que no tiene asignados.
 */
function user_manages_central_orders(array $user): bool
{
    return user_can_action($user, 'pedidos') && user_can_access_site($user, 'Villa Mitre');
}

/** Lo único que Central recibe de un local que no opera. */
function central_site_view(array $state): array
{
    return [
        'stockRequests' => is_array($state['stockRequests'] ?? null) ? $state['stockRequests'] : [],
        'stockAdjustments' => array_values(array_filter(
            is_array($state['stockAdjustments'] ?? null) ? $state['stockAdjustments'] : [],
            static fn ($adjustment): bool => is_array($adjustment) && ($adjustment['status'] ?? '') === 'Pendiente'
        )),
    ];
}

/**
 * Cambios de Central sobre un local que no opera. Solo se aceptan:
 * - en pedidos existentes no entregados: estado de preparación/despacho,
 *   cantidades preparadas, motivo de faltante y artículos agregados al despacho;
 * - aprobar o rechazar ajustes pendientes (si su perfil puede aprobarlos). Al
 *   aprobar, el servidor aplica la diferencia del conteo sobre el stock vigente
 *   y registra el movimiento.
 * Todo lo demás que envíe el navegador se ignora.
 */
function authorize_central_changes(array $user, array $current, array $base, array $incoming): array
{
    $result = $current;
    $baseRequests = operational_items_by_id($base['stockRequests'] ?? []);
    $incomingRequests = operational_items_by_id($incoming['stockRequests'] ?? []);
    foreach (is_array($result['stockRequests'] ?? null) ? $result['stockRequests'] : [] as $index => $request) {
        if (!is_array($request) || empty($request['id']) || !is_scalar($request['id'])) continue;
        $id = (string) $request['id'];
        $next = $incomingRequests[$id] ?? null;
        if ($next === null || $next === ($baseRequests[$id] ?? null) || ($request['status'] ?? '') === 'Entregado') continue;
        $requested = [];
        foreach (is_array($request['lines'] ?? null) ? $request['lines'] : [] as $line) {
            if (is_array($line) && is_numeric($line['productId'] ?? null)) $requested[(int) $line['productId']] = (int) ($line['quantity'] ?? 0);
        }
        $lines = [];
        foreach (is_array($next['lines'] ?? null) ? $next['lines'] : [] as $line) {
            if (!is_array($line) || !is_numeric($line['productId'] ?? null)) continue;
            $productId = (int) $line['productId'];
            $clean = ['productId' => $productId, 'quantity' => $requested[$productId] ?? 0];
            if (is_numeric($line['preparedQuantity'] ?? null)) $clean['preparedQuantity'] = max(0, (int) $line['preparedQuantity']);
            if (is_string($line['missingReason'] ?? null)) $clean['missingReason'] = mb_substr($line['missingReason'], 0, 300, 'UTF-8');
            $lines[] = $clean;
        }
        $status = in_array($next['status'] ?? '', ['Pendiente', 'En preparación', 'Despachado', 'Despachado parcial'], true) ? $next['status'] : $request['status'];
        $result['stockRequests'][$index] = array_merge($request, ['status' => $status, 'lines' => $lines ?: ($request['lines'] ?? [])]);
    }

    $canApprove = user_can_action($user, 'aprobarAjustesStock');
    $baseAdjustments = operational_items_by_id($base['stockAdjustments'] ?? []);
    $incomingAdjustments = operational_items_by_id($incoming['stockAdjustments'] ?? []);
    foreach ($canApprove && is_array($result['stockAdjustments'] ?? null) ? $result['stockAdjustments'] : [] as $index => $adjustment) {
        if (!is_array($adjustment) || ($adjustment['status'] ?? '') !== 'Pendiente' || empty($adjustment['id'])) continue;
        $id = (string) $adjustment['id'];
        $decision = $incomingAdjustments[$id]['status'] ?? null;
        if (!in_array($decision, ['Aprobado', 'Rechazado'], true) || $decision === ($baseAdjustments[$id]['status'] ?? null)) continue;
        $result['stockAdjustments'][$index]['status'] = $decision;
        if ($decision !== 'Aprobado') continue;
        $productId = (int) ($adjustment['productId'] ?? 0);
        $delta = (float) ($adjustment['counted'] ?? 0) - (float) ($adjustment['theoretical'] ?? 0);
        $result['stock'] = is_array($result['stock'] ?? null) ? $result['stock'] : [];
        $result['stock'][$productId] = max(0, (float) ($result['stock'][$productId] ?? 0) + $delta);
        $now = new DateTimeImmutable('now');
        $hex = bin2hex(random_bytes(16));
        $result['stockMovements'] = is_array($result['stockMovements'] ?? null) ? $result['stockMovements'] : [];
        array_unshift($result['stockMovements'], [
            'id' => substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-4' . substr($hex, 13, 3) . '-a' . substr($hex, 17, 3) . '-' . substr($hex, 20, 12),
            'site' => $adjustment['site'] ?? '', 'productId' => $productId, 'kind' => 'Ajuste de inventario',
            'quantity' => $delta, 'remito' => '', 'detail' => (string) ($adjustment['reason'] ?? ''), 'reference' => $id,
            'at' => $now->format('j/n/Y, H:i:s'),
            'atISO' => $now->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z'),
            'createdBy' => (string) ($user['full_name'] ?? $user['username'] ?? 'Central'),
        ]);
    }
    return $result;
}

function operational_snapshot_for_user(array $user, array $state, string $site): array
{
    if ($user['role'] === 'administracion') return $state;
    // El local necesita sus propios límites (descuento, egreso, diferencia de
    // caja) para aplicarlos; los de otros locales no se exponen.
    $ownLimits = is_array($state['limitsBySite'][$site] ?? null) ? [$site => $state['limitsBySite'][$site]] : null;
    unset($state['audit'], $state['priceChanges'], $state['limitsBySite']);
    if ($ownLimits !== null) $state['limitsBySite'] = $ownLimits;
    if (!user_can_report($user, 'Personal')) unset($state['schedules']);
    if (!user_can_action($user, 'egresos')) unset($state['expensesLog'], $state['cashAdjustments']);
    if (!user_can_action($user, 'transferirCaja')) unset($state['cashTransfers']);
    if (!user_can_action($user, 'stock')) unset($state['realStock'], $state['stockCountComments'], $state['stockAdjustments']);
    if (!user_can_action($user, 'anular')) unset($state['returnsLog']);
    if (!user_can_action($user, 'incidencias')) unset($state['incidents']);
    return $state;
}

function ensure_operations_schema(PDO $pdo): void
{
    if (!table_exists($pdo, 'operation_site_states')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS operation_site_states (
            site VARCHAR(80) NOT NULL PRIMARY KEY,
            state_json LONGTEXT NOT NULL,
            revision INT UNSIGNED NOT NULL DEFAULT 1,
            updated_by BIGINT UNSIGNED NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_operation_states_updated (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    // Las primeras instalaciones ya tenían esta tabla, pero no guardaban
    // quién realizó el último cambio. Sin esta migración, un UPDATE posterior
    // falla con "Unknown column updated_by" y la cola del navegador queda
    // reintentando indefinidamente. CREATE TABLE IF NOT EXISTS no agrega
    // columnas a una tabla existente, por eso la verificación es explícita.
    ensure_column($pdo, 'operation_site_states', 'updated_by', 'BIGINT UNSIGNED NULL AFTER revision');
    ensure_column($pdo, 'operation_site_states', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER updated_by');
    if (!table_exists($pdo, 'operation_events')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS operation_events (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            user_id BIGINT UNSIGNED NULL,
            event_type VARCHAR(80) NOT NULL,
            event_json LONGTEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_operation_events_site_date (site, created_at),
            INDEX idx_operation_events_user_date (user_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    if (!table_exists($pdo, 'operation_requests')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS operation_requests (
            request_id CHAR(36) NOT NULL PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            user_id BIGINT UNSIGNED NULL,
            revision INT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_operation_requests_site_date (site, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    // Las tres tablas también existían en instalaciones anteriores. Completar
    // sus campos aditivos hace que una actualización de código no transforme
    // una cola local en un reintento infinito por una migración incompleta.
    ensure_column($pdo, 'operation_events', 'user_id', 'BIGINT UNSIGNED NULL AFTER site');
    ensure_column($pdo, 'operation_events', 'event_type', "VARCHAR(80) NOT NULL DEFAULT 'operacion_actualizada' AFTER user_id");
    ensure_column($pdo, 'operation_events', 'event_json', 'LONGTEXT NOT NULL AFTER event_type');
    ensure_column($pdo, 'operation_events', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER event_json');
    ensure_column($pdo, 'operation_requests', 'user_id', 'BIGINT UNSIGNED NULL AFTER site');
    ensure_column($pdo, 'operation_requests', 'revision', 'INT UNSIGNED NOT NULL DEFAULT 0 AFTER user_id');
    ensure_column($pdo, 'operation_requests', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER revision');
    ensure_normalized_operations_schema($pdo);
    ensure_operation_archive_schema($pdo);
    ensure_sale_validation_schema($pdo);
    // La sincronización de una venta consulta los precios del catálogo dentro
    // de su transacción. En una instalación nueva, crear catalog_documents en
    // ese punto haría que MySQL confirme implícitamente el DDL y el commit
    // posterior fallaría con "There is no active transaction". Preparar la
    // estructura antes de que /sync abra la transacción lo mantiene atómico.
    ensure_catalog_schema($pdo);
}

function ensure_sale_validation_schema(PDO $pdo): void
{
    if (!table_exists($pdo, 'sale_validation_findings')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS sale_validation_findings (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            sale_id VARCHAR(64) NOT NULL,
            user_id BIGINT UNSIGNED NULL,
            severity VARCHAR(20) NOT NULL,
            rule_code VARCHAR(60) NOT NULL,
            detail VARCHAR(500) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_sale_validation_site_date (site, created_at),
            INDEX idx_sale_validation_rule (rule_code, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
}

/** Precios vigentes del catálogo central: [productId => ['Mostrador' => x, 'Online' => y]]. */
function catalog_price_lists(PDO $pdo): array
{
    ensure_catalog_schema($pdo);
    $json = $pdo->query('SELECT document_json FROM catalog_documents WHERE id = 1')->fetchColumn();
    $catalog = is_string($json) ? json_decode($json, true) : null;
    $prices = [];
    foreach (is_array($catalog['products'] ?? null) ? $catalog['products'] : [] as $product) {
        if (!is_array($product) || !is_numeric($product['id'] ?? null) || !is_numeric($product['price'] ?? null)) continue;
        $counter = (float) $product['price'];
        $prices[(int) $product['id']] = [
            'Mostrador' => $counter,
            // Igual que la interfaz: sin precio online se usa el de mostrador.
            'Online' => is_numeric($product['onlinePrice'] ?? null) ? (float) $product['onlinePrice'] : $counter,
        ];
    }
    return $prices;
}

/**
 * Recalcula en el servidor cada venta nueva o modificada con las mismas
 * fórmulas de la interfaz (app/page.tsx: total, invitaciones, descuento, neto,
 * pagos). Devuelve hallazgos [saleId, severidad, regla, detalle]; no modifica
 * ni rechaza nada.
 *   inconsistencia: no puede ocurrir usando la interfaz normalmente.
 *   aviso: puede ser legítimo (p. ej. comanda guardada antes de un cambio de precio).
 *   modificacion: cambiaron importes o productos de una venta ya registrada.
 */
function validate_operational_sales(array $previous, array $state, string $site, array $catalogPrices): array
{
    $tolerance = 1.0;
    $findings = [];
    $previousSales = operational_items_by_id($previous['sales'] ?? []);
    $previousPayments = operational_payments_by_sale($previous['payments'] ?? []);
    $payments = operational_payments_by_sale($state['payments'] ?? []);
    $limits = $state['limitsBySite'][$site] ?? $previous['limitsBySite'][$site] ?? null;
    // La interfaz usa 10 % cuando Administración no configuró un límite.
    $maxDiscount = is_array($limits) && is_numeric($limits['maxDiscount'] ?? null) ? (float) $limits['maxDiscount'] : 10.0;
    $money = static fn (float $value): string => '$' . number_format($value, 2, ',', '.');

    foreach (operational_items_by_id($state['sales'] ?? []) as $saleId => $sale) {
        $before = $previousSales[$saleId] ?? null;
        $salePayments = $payments[$saleId] ?? [];
        if ($before === $sale && ($previousPayments[$saleId] ?? []) === $salePayments) continue;

        if ($before !== null) {
            $amountFields = ['items', 'gross', 'discount', 'net', 'invitedQuantities'];
            $changed = array_values(array_filter($amountFields, static fn (string $field): bool => ($before[$field] ?? null) != ($sale[$field] ?? null)));
            // Corregir el medio de pago (mismo total) y anular (se quitan los
            // pagos) son operaciones previstas de la interfaz, no modificaciones.
            $paidTotal = static fn (array $list): float => array_sum(array_map(static fn (array $p): float => (float) ($p['amount'] ?? 0), $list));
            if (($sale['status'] ?? '') !== 'anulada'
                && abs($paidTotal($previousPayments[$saleId] ?? []) - $paidTotal($salePayments)) > $tolerance) $changed[] = 'total de pagos';
            if ($changed) $findings[] = [$saleId, 'modificacion', 'venta_modificada', 'Cambiaron campos de una venta ya registrada: ' . implode(', ', $changed) . '.'];
            // Una anulación o un cambio de estado sobre una venta ya validada no se recalcula.
            if (!$changed) continue;
        }

        $items = array_values(array_filter(is_array($sale['items'] ?? null) ? $sale['items'] : [], 'is_array'));
        $gross = (float) ($sale['gross'] ?? 0);
        $net = (float) ($sale['net'] ?? 0);
        $sumItems = array_sum(array_map(static fn (array $item): float => (float) ($item['price'] ?? 0), $items));
        if (abs($sumItems - $gross) > $tolerance) {
            $findings[] = [$saleId, 'inconsistencia', 'bruto_distinto', "Bruto {$money($gross)} y suma de productos {$money($sumItems)}."];
        }

        $units = [];
        $unitPrice = [];
        foreach ($items as $item) {
            $productId = (int) ($item['id'] ?? 0);
            $units[$productId] = ($units[$productId] ?? 0) + 1;
            $unitPrice[$productId] ??= (float) ($item['price'] ?? 0);
        }
        $invitationTotal = 0.0;
        foreach (is_array($sale['invitedQuantities'] ?? null) ? $sale['invitedQuantities'] : [] as $productId => $invited) {
            $invited = (int) $invited;
            $sold = $units[(int) $productId] ?? 0;
            if ($invited > $sold) $findings[] = [$saleId, 'inconsistencia', 'invitacion_excede', "Producto {$productId}: {$invited} invitadas sobre {$sold} vendidas."];
            $invitationTotal += ($unitPrice[(int) $productId] ?? 0) * min(max($invited, 0), $sold);
        }

        $discountable = $gross - $invitationTotal;
        $discountAmount = $discountable - $net;
        if ($discountAmount < -$tolerance) {
            $findings[] = [$saleId, 'inconsistencia', 'neto_mayor', "Neto {$money($net)} mayor que el total a cobrar {$money($discountable)}."];
        } elseif ($discountAmount > round($discountable * $maxDiscount / 100) + $tolerance) {
            $percent = $discountable > 0 ? round($discountAmount * 100 / $discountable, 1) : 100;
            $findings[] = [$saleId, 'inconsistencia', 'descuento_excede', "Descuento {$percent} % ({$money($discountAmount)}) sobre un máximo de {$maxDiscount} %."];
        }
        if (abs((float) ($sale['discount'] ?? 0) - ($gross - $net)) > $tolerance) {
            $findings[] = [$saleId, 'inconsistencia', 'descuento_informado', 'El descuento informado no coincide con bruto menos neto.'];
        }

        $paid = array_sum(array_map(static fn (array $p): float => (float) ($p['amount'] ?? 0), $salePayments));
        if (($sale['status'] ?? '') !== 'anulada' && abs($paid - $net) > $tolerance) {
            $findings[] = [$saleId, 'inconsistencia', 'pagos_distintos', "Pagos {$money($paid)} y neto {$money($net)}."];
        }

        $channel = ($sale['channel'] ?? '') === 'Online' ? 'Online' : 'Mostrador';
        foreach ($unitPrice as $productId => $price) {
            if (!isset($catalogPrices[$productId])) {
                $findings[] = [$saleId, 'aviso', 'producto_desconocido', "Producto {$productId} no está en el catálogo central."];
            } elseif (abs($catalogPrices[$productId][$channel] - $price) > 0.009) {
                $findings[] = [$saleId, 'aviso', 'precio_distinto', "Producto {$productId} ({$channel}): cobrado {$money($price)}, catálogo {$money($catalogPrices[$productId][$channel])}."];
            }
        }
    }
    return $findings;
}

/**
 * El tipo de comprobante de una venta ya registrada solo puede cambiarlo quien
 * puede anular ventas, y nunca si la venta ya tiene un comprobante ARCA emitido
 * o en curso. Un cambio no permitido se descarta (se conserva el anterior) y se
 * informa como hallazgo. Devuelve [estado, hallazgos].
 */
function enforce_invoice_type_changes(PDO $pdo, array $user, array $previous, array $state): array
{
    $findings = [];
    if (!is_array($state['sales'] ?? null)) return [$state, $findings];
    $previousSales = operational_items_by_id($previous['sales'] ?? []);
    $canChange = ($user['role'] ?? '') === 'administracion' || user_can_action($user, 'anular');
    $fiscal = null;
    foreach ($state['sales'] as $index => $sale) {
        if (!is_array($sale) || empty($sale['id']) || !is_scalar($sale['id'])) continue;
        $before = $previousSales[(string) $sale['id']] ?? null;
        if ($before === null || ($before['invoiceType'] ?? null) === ($sale['invoiceType'] ?? null)) continue;
        $reason = null;
        if (!$canChange) {
            $reason = 'sin permiso para cambiar el comprobante';
        } else {
            // La comprobación fiscal no puede dejar ventas, caja, stock o
            // recepciones retenidos en la cola. Si la tabla aún se está
            // migrando o la consulta falla, se conserva el comprobante previo
            // (postura segura) y se permite guardar el resto de la operación.
            try {
                if (table_exists($pdo, 'arca_fiscal_documents')) {
                    if ($fiscal === null) {
                        $fiscal = $pdo->prepare("SELECT status FROM arca_fiscal_documents WHERE sale_reference = ? AND status IN ('authorized','issuing','requires_reconciliation') LIMIT 1");
                    }
                    $fiscal->execute([(string) $sale['id']]);
                    if ($fiscal->fetchColumn() !== false) $reason = 'la venta ya tiene un comprobante ARCA emitido o en curso';
                }
            } catch (Throwable $error) {
                error_log('LARTISAN fiscal invoice-change check deferred: ' . $error->getMessage());
                $reason = 'no se pudo validar el estado fiscal; se conservó el comprobante anterior';
            }
        }
        if ($reason === null) continue;
        $state['sales'][$index]['invoiceType'] = $before['invoiceType'] ?? null;
        $findings[] = [(string) $sale['id'], 'modificacion', 'comprobante_rechazado',
            'Se descartó el cambio de comprobante a ' . (string) ($sale['invoiceType'] ?? '') . ': ' . $reason . '.'];
    }
    return [$state, $findings];
}

function record_sale_validation_findings(PDO $pdo, string $site, int $userId, array $findings): void
{
    if (!$findings) return;
    $insert = $pdo->prepare('INSERT INTO sale_validation_findings (site, sale_id, user_id, severity, rule_code, detail) VALUES (?, ?, ?, ?, ?, ?)');
    foreach ($findings as [$saleId, $severity, $rule, $detail]) {
        $insert->execute([$site, substr((string) $saleId, 0, 64), $userId, $severity, $rule, mb_substr($detail, 0, 500)]);
        audit($pdo, $userId, 'venta_con_diferencias', mb_substr("{$site} · venta " . substr((string) $saleId, 0, 8) . " · {$severity}: {$detail}", 0, 500));
    }
}

const OPERATIONS_RETENTION_DEFAULT_DAYS = 60;
const OPERATIONS_RETENTION_MIN_DAYS = 7;
// El navegador envía el estado y su base: 2 MB de estado mantienen cada envío
// cerca de 4 MB, lejos de post_max_size (8 MB) y del límite de 4 MB por estado.
const OPERATIONS_TARGET_STATE_BYTES = 2_000_000;

function ensure_operation_archive_schema(PDO $pdo): void
{
    if (!table_exists($pdo, 'operation_archive')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS operation_archive (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            field VARCHAR(40) NOT NULL,
            item_key VARCHAR(190) NOT NULL,
            item_json LONGTEXT NOT NULL,
            archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_operation_archive_item (site, field, item_key),
            INDEX idx_operation_archive_site_date (site, archived_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    // Las primeras instalaciones podían tener una tabla de archivo creada por
    // una versión anterior. CREATE TABLE IF NOT EXISTS no completa esas
    // columnas, pero las operaciones actuales necesitan todas para archivar
    // historial sin bloquear la sincronización.
    ensure_column($pdo, 'operation_archive', 'site', "VARCHAR(80) NOT NULL DEFAULT '' AFTER id");
    ensure_column($pdo, 'operation_archive', 'field', "VARCHAR(40) NOT NULL DEFAULT '' AFTER site");
    ensure_column($pdo, 'operation_archive', 'item_key', "VARCHAR(190) NOT NULL DEFAULT '' AFTER field");
    ensure_column($pdo, 'operation_archive', 'item_json', 'LONGTEXT NOT NULL AFTER item_key');
    ensure_column($pdo, 'operation_archive', 'archived_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER item_json');
}

/**
 * Qué listas del estado se recortan por antigüedad. 'dates' se prueban en orden;
 * con 'closed', solo se recortan los registros en esos estados (lo abierto queda).
 * Un registro sin fecha reconocible nunca se recorta.
 */
function operational_retention_rules(): array
{
    return [
        'sales' => ['dates' => ['createdAtISO', 'createdAt']],
        'cashLedger' => ['dates' => ['atISO', 'at']],
        'stockMovements' => ['dates' => ['atISO', 'at']],
        'cashAdjustments' => ['dates' => ['atISO', 'at']],
        'shiftLog' => ['dates' => ['closedAtISO', 'closedAt']],
        'expensesLog' => ['dates' => ['createdAt']],
        'returnsLog' => ['dates' => ['createdAt']],
        'attendanceRecords' => ['dates' => ['atISO', 'at']],
        'envelopeRecords' => ['dates' => ['at'], 'closed' => ['Retirado por Oscar']],
        'stockRequests' => ['dates' => ['requestedAt'], 'closed' => ['Entregado']],
        'cashTransfers' => ['dates' => ['receivedAt', 'createdAt'], 'closed' => ['Recibida', 'Anulada']],
        'incidents' => ['dates' => ['createdAt'], 'closed' => ['Resuelta']],
        'stockAdjustments' => ['dates' => ['requestedAt'], 'closed' => ['Aprobado', 'Rechazado']],
    ];
}

/** Fecha de un registro: ISO o el formato es-AR "d/m/aaaa, hh:mm" que usa la interfaz. */
function operational_item_time(array $item, array $fields): ?int
{
    foreach ($fields as $field) {
        $value = $item[$field] ?? null;
        if (!is_string($value) || trim($value) === '') continue;
        if (preg_match('#^\s*(\d{1,2})/(\d{1,2})/(\d{4})#', $value, $parts)) {
            if (checkdate((int) $parts[2], (int) $parts[1], (int) $parts[3])) {
                return mktime(12, 0, 0, (int) $parts[2], (int) $parts[1], (int) $parts[3]);
            }
            continue;
        }
        $time = strtotime($value);
        if ($time !== false) return $time;
    }
    return null;
}

function trim_operational_state(array $state, int $cutoff): array
{
    $activeShiftId = is_array($state['activeShift'] ?? null) ? (string) ($state['activeShift']['id'] ?? '') : '';
    foreach (operational_retention_rules() as $field => $rule) {
        if (!is_array($state[$field] ?? null)) continue;
        $state[$field] = array_values(array_filter($state[$field], static function ($item) use ($field, $rule, $cutoff, $activeShiftId): bool {
            if (!is_array($item)) return true;
            if (isset($rule['closed']) && !in_array($item['status'] ?? null, $rule['closed'], true)) return true;
            // Los movimientos del turno abierto se necesitan para el cierre de caja.
            if ($field === 'cashLedger' && $activeShiftId !== '' && ($item['shiftId'] ?? null) === $activeShiftId) return true;
            $time = operational_item_time($item, $rule['dates']);
            return $time === null || $time >= $cutoff;
        }));
    }
    if (is_array($state['payments'] ?? null) && is_array($state['sales'] ?? null)) {
        $keptSales = [];
        foreach ($state['sales'] as $sale) {
            if (is_array($sale) && isset($sale['id']) && is_scalar($sale['id'])) $keptSales[(string) $sale['id']] = true;
        }
        $state['payments'] = array_values(array_filter($state['payments'], static function ($payment) use ($keptSales, $cutoff): bool {
            if (!is_array($payment)) return true;
            if (!empty($payment['saleId']) && is_scalar($payment['saleId'])) return isset($keptSales[(string) $payment['saleId']]);
            $time = operational_item_time($payment, ['createdAtISO']);
            return $time === null || $time >= $cutoff;
        }));
    }
    return $state;
}

/**
 * Recorta el estado a la retención configurada y, si aun así supera el tamaño
 * objetivo, acorta la ventana de a una semana hasta el mínimo. Devuelve
 * [estado recortado, días conservados].
 */
function compact_operational_state(array $state, array $config, ?int $now = null): array
{
    $now ??= time();
    $days = max(OPERATIONS_RETENTION_MIN_DAYS, min(365, (int) ($config['operations']['retention_days'] ?? OPERATIONS_RETENTION_DEFAULT_DAYS)));
    $trimmed = trim_operational_state($state, $now - $days * 86400);
    while ($days > OPERATIONS_RETENTION_MIN_DAYS
        && strlen((string) json_encode($trimmed, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) > OPERATIONS_TARGET_STATE_BYTES) {
        $days = max(OPERATIONS_RETENTION_MIN_DAYS, $days - 7);
        $trimmed = trim_operational_state($state, $now - $days * 86400);
    }
    return [$trimmed, $days];
}

function operational_archive_key(string $field, array $item, int $index): string
{
    $key = operational_item_key($field, $item, $index);
    if (str_starts_with($key, '__row_') || strlen($key) > 190) {
        return 'sha1:' . sha1((string) json_encode($item, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
    return $key;
}

/** @return array<string, array> clave => registro */
// El hosting actual ejecuta una versión anterior a PHP 8. El tipo `mixed`
// allí se interpreta como una clase y rechaza valores válidos (por ejemplo,
// arreglos de operaciones), así que estos helpers aceptan la entrada sin
// tipo estricto y la normalizan internamente.
function operational_list_by_key(string $field, $list): array
{
    $result = [];
    if (!is_array($list)) return $result;
    foreach (array_values($list) as $index => $item) {
        if (is_array($item)) $result[operational_archive_key($field, $item, $index)] = $item;
    }
    return $result;
}

/**
 * Nada que salga del estado se pierde: se guarda en operation_archive todo
 * registro que el servidor tenía y ya no queda, y todo registro recibido que
 * se recortó sin haber estado antes en el servidor (si no estaba archivado).
 */
function archive_removed_operational_items(PDO $pdo, string $site, array $previous, array $untrimmed, array $final): int
{
    $upsert = $pdo->prepare('INSERT INTO operation_archive (site, field, item_key, item_json) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE item_json = VALUES(item_json), archived_at = CURRENT_TIMESTAMP');
    $archived = 0;
    foreach (array_merge(array_keys(operational_retention_rules()), ['payments']) as $field) {
        $finalItems = operational_list_by_key($field, $final[$field] ?? null);
        $previousItems = operational_list_by_key($field, $previous[$field] ?? null);
        foreach ($previousItems as $key => $item) {
            if (isset($finalItems[$key])) continue;
            $upsert->execute([$site, $field, $key, json_encode($item, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
            $archived++;
        }
        $incomingOnly = array_diff_key(operational_list_by_key($field, $untrimmed[$field] ?? null), $finalItems, $previousItems);
        foreach (array_chunk(array_keys($incomingOnly), 500) as $keys) {
            $existing = $pdo->prepare('SELECT item_key FROM operation_archive WHERE site = ? AND field = ? AND item_key IN (' . implode(',', array_fill(0, count($keys), '?')) . ')');
            $existing->execute(array_merge([$site, $field], $keys));
            $known = array_flip($existing->fetchAll(PDO::FETCH_COLUMN));
            foreach ($keys as $key) {
                if (isset($known[$key])) continue;
                $upsert->execute([$site, $field, $key, json_encode($incomingOnly[$key], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
                $archived++;
            }
        }
    }
    return $archived;
}

/**
 * Compacta en el servidor el estado de un local que supera el tamaño objetivo,
 * sin esperar a que un navegador lo envíe (un estado demasiado grande puede no
 * llegar a guardarse nunca). Lo recortado queda en operation_archive; las
 * tablas normalizadas ya lo contienen porque cada guardado anterior lo copió.
 */
function compact_oversized_site_state(PDO $pdo, array $config, string $site): bool
{
    $size = $pdo->prepare('SELECT LENGTH(state_json) FROM operation_site_states WHERE site = ?');
    $size->execute([$site]);
    if ((int) $size->fetchColumn() <= OPERATIONS_TARGET_STATE_BYTES) return false;
    $pdo->beginTransaction();
    try {
        $lookup = $pdo->prepare('SELECT state_json FROM operation_site_states WHERE site = ? FOR UPDATE');
        $lookup->execute([$site]);
        $json = (string) $lookup->fetchColumn();
        $previous = json_decode($json, true);
        if (strlen($json) <= OPERATIONS_TARGET_STATE_BYTES || !is_array($previous)) {
            $pdo->commit();
            return false;
        }
        [$compacted, $days] = compact_operational_state($previous, $config);
        if ($compacted === $previous) {
            $pdo->commit();
            return false;
        }
        $archived = archive_removed_operational_items($pdo, $site, $previous, $previous, $compacted);
        $pdo->prepare('UPDATE operation_site_states SET state_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE site = ?')
            ->execute([json_encode($compacted, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $site]);
        $pdo->prepare('INSERT INTO operation_events (site, user_id, event_type, event_json) VALUES (?, NULL, ?, ?)')->execute([
            $site, 'estado_compactado', json_encode([
                'recordedAt' => gmdate('c'),
                'event' => ['action' => 'Compactación automática', 'detail' => "Se conservan {$days} días; {$archived} registros pasaron al archivo."],
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
        $pdo->commit();
        return true;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

function ensure_catalog_schema(PDO $pdo): void
{
    if (!table_exists($pdo, 'catalog_documents')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS catalog_documents (
            id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
            revision INT UNSIGNED NOT NULL,
            document_json LONGTEXT NOT NULL,
            updated_by BIGINT UNSIGNED NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
}

function operational_item_key(string $field, array $item, int $index): string
{
    if ($field === 'payments') {
        return (string) ($item['saleId'] ?? '') . '|' . (string) ($item['method'] ?? '') . '|' . (string) ($item['amount'] ?? '');
    }
    return isset($item['id']) && is_scalar($item['id']) ? (string) $item['id'] : '__row_' . $index;
}

/** Three-way list merge: apply only this browser's changes over the latest server list. */
function merge_operational_list(string $field, array $base, array $current, array $incoming): array
{
    $map = [];
    $order = [];
    foreach ($current as $index => $item) {
        if (!is_array($item)) continue;
        $key = operational_item_key($field, $item, (int) $index);
        $map[$key] = $item;
        $order[] = $key;
    }
    $baseMap = [];
    foreach ($base as $index => $item) {
        if (!is_array($item)) continue;
        $baseMap[operational_item_key($field, $item, (int) $index)] = $item;
    }
    $incomingMap = [];
    foreach ($incoming as $index => $item) {
        if (!is_array($item)) continue;
        $key = operational_item_key($field, $item, (int) $index);
        $incomingMap[$key] = $item;
        if (!array_key_exists($key, $baseMap) || $baseMap[$key] !== $item) {
            $map[$key] = $item;
            if (!in_array($key, $order, true)) array_unshift($order, $key);
        }
    }
    foreach ($baseMap as $key => $item) {
        if (!array_key_exists($key, $incomingMap) && array_key_exists($key, $map) && $map[$key] === $item) {
            unset($map[$key]);
        }
    }
    $result = [];
    foreach (array_values(array_unique($order)) as $key) if (array_key_exists($key, $map)) $result[] = $map[$key];
    return $result;
}

function merge_operational_snapshot(array $base, array $current, array $incoming): array
{
    $result = $current;
    $listFields = ['sales', 'payments', 'stockRequests', 'savedOrders', 'cashAdjustments', 'cashLedger', 'shiftLog', 'envelopeRecords', 'stockMovements', 'expensesLog', 'returnsLog', 'cashTransfers', 'attendanceRecords', 'incidents', 'stockAdjustments', 'schedules', 'priceChanges'];
    foreach ($incoming as $field => $value) {
        if (!is_string($field)) continue;
        $baseValue = $base[$field] ?? null;
        if ($value === $baseValue) continue;
        if (in_array($field, $listFields, true) && is_array($value)) {
            $result[$field] = merge_operational_list($field, is_array($baseValue) ? $baseValue : [], is_array($current[$field] ?? null) ? $current[$field] : [], $value);
            continue;
        }
        if ($field === 'stock' && is_array($value)) {
            $stock = is_array($current[$field] ?? null) ? $current[$field] : [];
            $baseStock = is_array($baseValue) ? $baseValue : [];
            foreach ($value as $productId => $quantity) {
                $baseQuantity = (float) ($baseStock[$productId] ?? 0);
                if ((float) $quantity === $baseQuantity) continue;
                $stock[$productId] = max(0, (float) ($stock[$productId] ?? 0) + ((float) $quantity - $baseQuantity));
            }
            $result[$field] = $stock;
            continue;
        }
        $result[$field] = $value;
    }
    return $result;
}

function ensure_monitoring_notification_schema(PDO $pdo): void
{
    if (!table_exists($pdo, 'monitoring_notifications')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS monitoring_notifications (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            alert_hash CHAR(64) NOT NULL,
            status VARCHAR(30) NOT NULL,
            recipient VARCHAR(190) NULL,
            error_message VARCHAR(500) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_monitoring_notifications_hash_date (alert_hash, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
}

/** Campos agregados sin interrumpir instalaciones que ya tenían backup_runs. */
function ensure_backup_monitoring_schema(PDO $pdo): void
{
    if (!table_exists($pdo, 'backup_runs')) return;
    $columns = $pdo->query('SHOW COLUMNS FROM backup_runs')->fetchAll(PDO::FETCH_COLUMN);
    foreach ([
        'encryption' => "VARCHAR(40) NULL AFTER sha256",
        'validation_status' => "VARCHAR(40) NULL AFTER encryption",
        'backup_class' => "VARCHAR(16) NULL AFTER filename",
        'manifest_sha256' => "CHAR(64) NULL AFTER validation_status",
    ] as $name => $definition) {
        if (!in_array($name, $columns, true)) $pdo->exec("ALTER TABLE backup_runs ADD COLUMN $name $definition");
    }
}

function active_monitoring_alerts(PDO $pdo): array
{
    ensure_pnl_sync_schema($pdo);
    ensure_expense_sync_schema($pdo);
    ensure_mrp_schema($pdo);
    $failedPnl = (int) $pdo->query("SELECT COUNT(*) FROM pnl_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $failedExpenses = (int) $pdo->query("SELECT COUNT(*) FROM expense_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    $failedMrp = (int) $pdo->query("SELECT COUNT(*) FROM mrp_sync_runs WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)")->fetchColumn();
    ensure_backup_monitoring_schema($pdo);
    $lastBackup = table_exists($pdo, 'backup_runs') ? $pdo->query('SELECT finished_at, status, encryption, validation_status, error_message FROM backup_runs ORDER BY id DESC LIMIT 1')->fetch() : null;
    $freeBytes = function_exists('disk_free_space') ? @disk_free_space(__DIR__) : false;
    $alerts = [];
    if (($failedPnl + $failedExpenses + $failedMrp) > 0) $alerts[] = 'Hubo sincronizaciones fallidas en las últimas 24 horas.';
    if (!$lastBackup || ($lastBackup['status'] ?? '') !== 'verified') {
        $alerts[] = 'El último respaldo externo no quedó verificado. Revisar la ejecución y reintentar.';
    } elseif (($lastBackup['encryption'] ?? '') !== 'aes-256-gcm' || ($lastBackup['validation_status'] ?? '') !== 'restore_ready') {
        $alerts[] = 'El último respaldo externo no cumple el cifrado o la validación de recuperación exigidos.';
    } else {
        $age = $pdo->query("SELECT TIMESTAMPDIFF(HOUR, finished_at, NOW()) FROM backup_runs WHERE status = 'verified' ORDER BY id DESC LIMIT 1")->fetchColumn();
        if ($age === false || (int) $age > 26) $alerts[] = 'Pasaron más de 26 horas sin un respaldo externo diario verificado.';
    }
    if (!table_exists($pdo, 'backup_asset_runs')) {
        $alerts[] = 'No existe un respaldo separado de archivos y configuración crítica.';
    } else {
        $lastAssets = $pdo->query("SELECT status, finished_at, validation_status FROM backup_asset_runs ORDER BY id DESC LIMIT 1")->fetch();
        if (!$lastAssets || ($lastAssets['status'] ?? '') !== 'verified' || ($lastAssets['validation_status'] ?? '') !== 'restore_ready') {
            $alerts[] = 'El último respaldo de archivos y configuración no quedó verificado.';
        } else {
            $assetAge = $pdo->query("SELECT TIMESTAMPDIFF(HOUR, finished_at, NOW()) FROM backup_asset_runs WHERE status = 'verified' ORDER BY id DESC LIMIT 1")->fetchColumn();
            if ($assetAge === false || (int) $assetAge > 26) $alerts[] = 'Pasaron más de 26 horas sin un respaldo verificado de archivos y configuración.';
        }
    }
    if (!table_exists($pdo, 'backup_restore_tests')) {
        $alerts[] = 'No existe una prueba mensual registrada de restauración aislada.';
    } else {
        $lastRestoreTest = $pdo->query("SELECT status, finished_at FROM backup_restore_tests ORDER BY id DESC LIMIT 1")->fetch();
        if (!$lastRestoreTest || ($lastRestoreTest['status'] ?? '') !== 'verified') {
            $alerts[] = 'La última prueba de restauración aislada no quedó verificada.';
        } else {
            $restoreAge = $pdo->query("SELECT TIMESTAMPDIFF(DAY, finished_at, NOW()) FROM backup_restore_tests WHERE status = 'verified' ORDER BY id DESC LIMIT 1")->fetchColumn();
            if ($restoreAge === false || (int) $restoreAge > 31) $alerts[] = 'Pasaron más de 31 días sin una prueba de restauración aislada verificada.';
        }
    }
    if ($freeBytes !== false && $freeBytes < 512 * 1024 * 1024) $alerts[] = 'El servidor tiene menos de 512 MB libres.';
    return $alerts;
}

function notify_monitoring_alerts(PDO $pdo, array $config): array
{
    ensure_monitoring_notification_schema($pdo);
    $alerts = active_monitoring_alerts($pdo);
    if (!$alerts) return ['status' => 'unchanged', 'sentAt' => null];
    $recipient = trim((string) ($config['monitoring']['alert_email'] ?? $config['admin_recovery_email'] ?? ''));
    if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) return ['status' => 'disabled', 'sentAt' => null];
    sort($alerts);
    $hash = hash('sha256', implode('|', $alerts));
    $cooldownHours = max(1, min(24, (int) ($config['monitoring']['cooldown_hours'] ?? 6)));
    $recent = $pdo->prepare("SELECT created_at FROM monitoring_notifications WHERE alert_hash = ? AND status = 'sent' AND created_at >= DATE_SUB(NOW(), INTERVAL $cooldownHours HOUR) ORDER BY id DESC LIMIT 1");
    $recent->execute([$hash]);
    $sentAt = $recent->fetchColumn();
    if ($sentAt) return ['status' => 'unchanged', 'sentAt' => $sentAt];
    $subject = "L'ARTISAN - alerta del sistema";
    $body = "El monitoreo detectó condiciones que requieren revisión:\n\n- " . implode("\n- ", $alerts) . "\n\nIngresá a Administración > Protección de datos para revisar el detalle.";
    $from = trim((string) ($config['recovery_from_email'] ?? ''));
    $headers = $from !== '' ? ['From: ' . $from, 'Content-Type: text/plain; charset=UTF-8'] : ['Content-Type: text/plain; charset=UTF-8'];
    $sent = @mail($recipient, $subject, $body, implode("\r\n", $headers));
    $statement = $pdo->prepare('INSERT INTO monitoring_notifications (alert_hash, status, recipient, error_message) VALUES (?, ?, ?, ?)');
    $statement->execute([$hash, $sent ? 'sent' : 'failed', $recipient, $sent ? null : 'El servidor de correo rechazó el envío.']);
    return ['status' => $sent ? 'sent' : 'failed', 'sentAt' => $sent ? date('Y-m-d H:i:s') : null];
}

function ensure_normalized_operations_schema(PDO $pdo): void
{
    if (!table_exists($pdo, 'lartisan_sales')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS lartisan_sales (
            id CHAR(36) NOT NULL PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            occurred_at DATETIME NULL,
            gross_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
            discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
            net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
            payment_method VARCHAR(120) NULL,
            invoice_type VARCHAR(80) NULL,
            customer_name VARCHAR(180) NULL,
            channel VARCHAR(40) NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'activa',
            invitation TINYINT(1) NOT NULL DEFAULT 0,
            synced_by BIGINT UNSIGNED NULL,
            synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_lartisan_sales_site_date (site, occurred_at),
            INDEX idx_lartisan_sales_status (site, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    if (!table_exists($pdo, 'lartisan_sale_items')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS lartisan_sale_items (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            sale_id CHAR(36) NOT NULL,
            line_number SMALLINT UNSIGNED NOT NULL,
            product_id INT UNSIGNED NOT NULL,
            product_name VARCHAR(190) NOT NULL,
            presentation VARCHAR(190) NULL,
            quantity INT UNSIGNED NOT NULL,
            invited_quantity INT UNSIGNED NOT NULL DEFAULT 0,
            unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
            UNIQUE KEY uq_lartisan_sale_item_line (sale_id, line_number),
            INDEX idx_lartisan_sale_items_product (product_id),
            CONSTRAINT fk_lartisan_sale_items_sale FOREIGN KEY (sale_id) REFERENCES lartisan_sales(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    // Datos de identificación fiscal. Se mantienen junto a la venta para que
    // una futura factura no dependa de datos que puedan cambiar luego en la UI.
    ensure_column($pdo, 'lartisan_sales', 'customer_document_type', 'VARCHAR(30) NULL AFTER customer_name');
    ensure_column($pdo, 'lartisan_sales', 'customer_document_number', 'VARCHAR(30) NULL AFTER customer_document_type');
    ensure_column($pdo, 'lartisan_sales', 'customer_tax_condition', 'VARCHAR(80) NULL AFTER customer_document_number');
    ensure_column($pdo, 'lartisan_sales', 'customer_address', 'VARCHAR(220) NULL AFTER customer_tax_condition');
    if (!table_exists($pdo, 'lartisan_sale_payments')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS lartisan_sale_payments (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            sale_id CHAR(36) NOT NULL,
            payment_method VARCHAR(120) NOT NULL,
            amount DECIMAL(14,2) NOT NULL,
            corrected_at DATETIME NULL,
            UNIQUE KEY uq_lartisan_sale_payment_method (sale_id, payment_method),
            CONSTRAINT fk_lartisan_sale_payments_sale FOREIGN KEY (sale_id) REFERENCES lartisan_sales(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    if (!table_exists($pdo, 'lartisan_cash_sessions')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS lartisan_cash_sessions (
            id CHAR(36) NOT NULL PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            opened_at DATETIME NULL,
            opened_by VARCHAR(190) NULL,
            initial_fund DECIMAL(14,2) NOT NULL DEFAULT 0,
            closed_at DATETIME NULL,
            closed_by VARCHAR(190) NULL,
            expected_cash DECIMAL(14,2) NULL,
            counted_cash DECIMAL(14,2) NULL,
            difference_amount DECIMAL(14,2) NULL,
            envelope_amount DECIMAL(14,2) NULL,
            synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_lartisan_cash_sessions_site_opened (site, opened_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    ensure_column($pdo, 'lartisan_cash_sessions', 'expected_cash', 'DECIMAL(14,2) NULL AFTER closed_by');
    ensure_column($pdo, 'lartisan_cash_sessions', 'counted_cash', 'DECIMAL(14,2) NULL AFTER expected_cash');
    ensure_column($pdo, 'lartisan_cash_sessions', 'difference_amount', 'DECIMAL(14,2) NULL AFTER counted_cash');
    ensure_column($pdo, 'lartisan_cash_sessions', 'envelope_amount', 'DECIMAL(14,2) NULL AFTER difference_amount');
    if (!table_exists($pdo, 'lartisan_cash_movements')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS lartisan_cash_movements (
            id CHAR(36) NOT NULL PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            session_id CHAR(36) NULL,
            occurred_at DATETIME NULL,
            kind VARCHAR(120) NOT NULL,
            direction VARCHAR(20) NOT NULL,
            amount DECIMAL(14,2) NOT NULL DEFAULT 0,
            cash_impact DECIMAL(14,2) NOT NULL DEFAULT 0,
            payment_method VARCHAR(120) NULL,
            reference_id CHAR(36) NULL,
            detail VARCHAR(500) NULL,
            created_by VARCHAR(190) NULL,
            INDEX idx_lartisan_cash_movements_site_date (site, occurred_at),
            INDEX idx_lartisan_cash_movements_session (session_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    if (!table_exists($pdo, 'lartisan_stock_movements')) {
        $pdo->exec(
        "CREATE TABLE IF NOT EXISTS lartisan_stock_movements (
            id CHAR(36) NOT NULL PRIMARY KEY,
            site VARCHAR(80) NOT NULL,
            product_id INT UNSIGNED NOT NULL,
            movement_type VARCHAR(40) NOT NULL,
            quantity INT NOT NULL,
            remito VARCHAR(180) NULL,
            source_reference CHAR(36) NULL,
            detail VARCHAR(500) NULL,
            occurred_at DATETIME NULL,
            created_by VARCHAR(190) NULL,
            INDEX idx_lartisan_stock_movements_site_product_date (site, product_id, occurred_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }
    ensure_column($pdo, 'lartisan_stock_movements', 'source_reference', 'CHAR(36) NULL AFTER remito');
}

function ensure_column(PDO $pdo, string $table, string $column, string $definition): void
{
    $statement = $pdo->query("SHOW COLUMNS FROM `$table` LIKE " . $pdo->quote($column));
    if (!$statement->fetch()) {
        $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$column` $definition");
    }
}

function iso_datetime(?string $value): ?string
{
    if (!$value) return null;
    try {
        // El navegador envía ISO en UTC ("...Z"): se guarda en hora local para que
        // los filtros por día y los reportes coincidan con el día del local.
        return (new DateTimeImmutable($value))->setTimezone(new DateTimeZone(date_default_timezone_get()))->format('Y-m-d H:i:s');
    } catch (Throwable $error) {
        return null;
    }
}

function historical_datetime($value): ?string
{
    $text = trim((string) $value);
    if ($text === '') return null;
    foreach (['d/m/Y H:i:s', 'd/m/Y H:i', 'd/m/Y', 'Y-m-d H:i:s', 'Y-m-d H:i', 'Y-m-d'] as $format) {
        $date = DateTimeImmutable::createFromFormat('!' . $format, $text);
        if ($date !== false && $date->format($format) === $text) return $date->format('Y-m-d H:i:s');
    }
    return iso_datetime($text);
}

function historical_number($value): float
{
    if (is_int($value) || is_float($value)) return (float) $value;
    $text = preg_replace('/[^0-9,.-]/u', '', trim((string) $value)) ?? '';
    if ($text === '') return 0.0;
    $comma = strrpos($text, ',');
    $dot = strrpos($text, '.');
    if ($comma !== false && $dot !== false) {
        $decimal = $comma > $dot ? ',' : '.';
        $thousands = $decimal === ',' ? '.' : ',';
        $text = str_replace($thousands, '', $text);
        $text = str_replace($decimal, '.', $text);
    } elseif ($comma !== false) {
        $text = preg_match('/,\d{1,2}$/', $text) ? str_replace(',', '.', $text) : str_replace(',', '', $text);
    } elseif ($dot !== false && preg_match('/^-?\d{1,3}(\.\d{3})+$/', $text)) {
        $text = str_replace('.', '', $text);
    }
    return is_numeric($text) ? (float) $text : 0.0;
}

/** @return array<string, array> pagos agrupados por venta */
function operational_payments_by_sale($payments): array
{
    $grouped = [];
    foreach (is_array($payments) ? $payments : [] as $payment) {
        if (is_array($payment) && isset($payment['saleId']) && is_scalar($payment['saleId'])) $grouped[(string) $payment['saleId']][] = $payment;
    }
    return $grouped;
}

/** @return array<string, array> registros por id */
function operational_items_by_id($items): array
{
    $result = [];
    foreach (is_array($items) ? $items : [] as $item) {
        if (is_array($item) && !empty($item['id']) && is_scalar($item['id'])) $result[(string) $item['id']] = $item;
    }
    return $result;
}

/**
 * Copia el estado a las tablas normalizadas. Con $previous (el estado que el
 * servidor ya tenía y que ya fue copiado) solo procesa lo nuevo o modificado;
 * sin él, copia todo.
 */
function sync_normalized_operations(PDO $pdo, string $site, array $state, int $userId, ?array $previous = null): void
{
    $paymentsBySale = operational_payments_by_sale($state['payments'] ?? []);
    $previousSales = $previous === null ? [] : operational_items_by_id($previous['sales'] ?? []);
    $previousPaymentsBySale = $previous === null ? [] : operational_payments_by_sale($previous['payments'] ?? []);
    $previousLedger = $previous === null ? [] : operational_items_by_id($previous['cashLedger'] ?? []);
    $previousMovements = $previous === null ? [] : operational_items_by_id($previous['stockMovements'] ?? []);
    $previousSessions = $previous === null ? [] : operational_items_by_id(array_merge(
        is_array($previous['shiftLog'] ?? null) ? $previous['shiftLog'] : [],
        is_array($previous['activeShift'] ?? null) ? [$previous['activeShift']] : []
    ));
    $saleStatement = $pdo->prepare(
        "INSERT INTO lartisan_sales
        (id, site, occurred_at, gross_amount, discount_amount, net_amount, payment_method, invoice_type, customer_name, customer_document_type, customer_document_number, customer_tax_condition, customer_address, channel, status, invitation, synced_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE site=VALUES(site), occurred_at=VALUES(occurred_at), gross_amount=VALUES(gross_amount),
        discount_amount=VALUES(discount_amount), net_amount=VALUES(net_amount), payment_method=VALUES(payment_method),
        invoice_type=VALUES(invoice_type), customer_name=VALUES(customer_name),
        customer_document_type=COALESCE(VALUES(customer_document_type), customer_document_type),
        customer_document_number=COALESCE(VALUES(customer_document_number), customer_document_number),
        customer_tax_condition=COALESCE(VALUES(customer_tax_condition), customer_tax_condition),
        customer_address=COALESCE(VALUES(customer_address), customer_address), channel=VALUES(channel), status=VALUES(status),
        invitation=VALUES(invitation), synced_by=VALUES(synced_by)"
    );
    $deleteItems = $pdo->prepare('DELETE FROM lartisan_sale_items WHERE sale_id = ?');
    $insertItem = $pdo->prepare(
        'INSERT INTO lartisan_sale_items (sale_id, line_number, product_id, product_name, presentation, quantity, invited_quantity, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $deletePayments = $pdo->prepare('DELETE FROM lartisan_sale_payments WHERE sale_id = ?');
    $insertPayment = $pdo->prepare('INSERT INTO lartisan_sale_payments (sale_id, payment_method, amount) VALUES (?, ?, ?)');

    foreach (($state['sales'] ?? []) as $sale) {
        if (!is_array($sale) || empty($sale['id'])) continue;
        $saleKey = (string) $sale['id'];
        if (($previousSales[$saleKey] ?? null) === $sale
            && ($previousPaymentsBySale[$saleKey] ?? []) === ($paymentsBySale[$saleKey] ?? [])) continue;
        $saleStatement->execute([
            (string) $sale['id'], $site, iso_datetime($sale['createdAtISO'] ?? null), (float) ($sale['gross'] ?? 0),
            (float) ($sale['discount'] ?? 0), (float) ($sale['net'] ?? 0), (string) ($sale['method'] ?? ''),
            (string) ($sale['invoiceType'] ?? ''), (string) ($sale['customer'] ?? ''),
            trim((string) ($sale['customerDocumentType'] ?? '')) ?: null,
            trim((string) ($sale['customerDocumentNumber'] ?? '')) ?: null,
            trim((string) ($sale['customerTaxCondition'] ?? '')) ?: null,
            trim((string) ($sale['customerAddress'] ?? '')) ?: null,
            (string) ($sale['channel'] ?? ''),
            (string) ($sale['status'] ?? 'activa'), !empty($sale['invitation']) ? 1 : 0, $userId,
        ]);
        $deleteItems->execute([(string) $sale['id']]);
        $lines = [];
        foreach (($sale['items'] ?? []) as $item) {
            if (!is_array($item) || !isset($item['id'])) continue;
            $productId = (int) $item['id'];
            if (!isset($lines[$productId])) $lines[$productId] = ['item' => $item, 'quantity' => 0];
            $lines[$productId]['quantity']++;
        }
        $lineNumber = 1;
        foreach ($lines as $productId => $line) {
            $item = $line['item'];
            $invited = min((int) $line['quantity'], (int) (($sale['invitedQuantities'] ?? [])[$productId] ?? 0));
            $insertItem->execute([
                (string) $sale['id'], $lineNumber++, $productId, (string) ($item['name'] ?? ''),
                (string) ($item['detail'] ?? ''), (int) $line['quantity'], $invited, (float) ($item['price'] ?? 0),
            ]);
        }
        $deletePayments->execute([(string) $sale['id']]);
        foreach ($paymentsBySale[$saleKey] ?? [] as $payment) {
            $insertPayment->execute([(string) $sale['id'], (string) ($payment['method'] ?? ''), (float) ($payment['amount'] ?? 0)]);
        }
    }

    $sessionStatement = $pdo->prepare(
        "INSERT INTO lartisan_cash_sessions (id, site, opened_at, opened_by, initial_fund, closed_at, closed_by, expected_cash, counted_cash, difference_amount, envelope_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE opened_at=VALUES(opened_at), opened_by=VALUES(opened_by), initial_fund=VALUES(initial_fund),
        closed_at=VALUES(closed_at), closed_by=VALUES(closed_by), expected_cash=VALUES(expected_cash), counted_cash=VALUES(counted_cash),
        difference_amount=VALUES(difference_amount), envelope_amount=VALUES(envelope_amount)"
    );
    $sessions = [];
    foreach (($state['shiftLog'] ?? []) as $session) if (is_array($session) && !empty($session['id'])) $sessions[$session['id']] = $session;
    // El turno activo no reemplaza su versión ya cerrada del historial.
    $activeId = is_array($state['activeShift'] ?? null) ? (string) ($state['activeShift']['id'] ?? '') : '';
    if ($activeId !== '' && empty($sessions[$activeId]['closedAtISO']) && empty($sessions[$activeId]['closedAt'])) $sessions[$activeId] = $state['activeShift'];
    foreach ($sessions as $session) {
        if (($previousSessions[(string) $session['id']] ?? null) === $session) continue;
        $sessionStatement->execute([
            // openedAt es texto es-AR ("30/9/2026, 08:57:09") que no se interpreta como fecha.
            (string) $session['id'], $site, iso_datetime($session['openedAtISO'] ?? null) ?? historical_datetime($session['openedAt'] ?? ''), (string) ($session['openedBy'] ?? ''),
            (float) ($session['initialFund'] ?? 0), iso_datetime($session['closedAtISO'] ?? $session['closedAt'] ?? null), (string) ($session['closedBy'] ?? ''),
            isset($session['expectedCash']) ? (float) $session['expectedCash'] : null,
            isset($session['countedCash']) ? (float) $session['countedCash'] : null,
            isset($session['differenceAmount']) ? (float) $session['differenceAmount'] : null,
            isset($session['envelopeAmount']) ? (float) $session['envelopeAmount'] : null,
        ]);
    }

    $cashStatement = $pdo->prepare(
        "INSERT INTO lartisan_cash_movements
        (id, site, session_id, occurred_at, kind, direction, amount, cash_impact, payment_method, reference_id, detail, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE session_id=VALUES(session_id), occurred_at=VALUES(occurred_at), kind=VALUES(kind),
        direction=VALUES(direction), amount=VALUES(amount), cash_impact=VALUES(cash_impact), payment_method=VALUES(payment_method),
        reference_id=VALUES(reference_id), detail=VALUES(detail), created_by=VALUES(created_by)"
    );
    foreach (($state['cashLedger'] ?? []) as $movement) {
        if (!is_array($movement) || empty($movement['id'])) continue;
        if (($previousLedger[(string) $movement['id']] ?? null) === $movement) continue;
        $cashStatement->execute([
            (string) $movement['id'], $site, $movement['shiftId'] ?? null, iso_datetime($movement['atISO'] ?? null),
            (string) ($movement['kind'] ?? ''), (string) ($movement['direction'] ?? 'Informativo'),
            (float) ($movement['amount'] ?? 0), (float) ($movement['cashImpact'] ?? 0),
            $movement['paymentMethod'] ?? null, $movement['reference'] ?? null, (string) ($movement['detail'] ?? ''),
            (string) ($movement['createdBy'] ?? ''),
        ]);
    }

    $stockStatement = $pdo->prepare(
        "INSERT INTO lartisan_stock_movements (id, site, product_id, movement_type, quantity, remito, source_reference, detail, occurred_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE movement_type=VALUES(movement_type), quantity=VALUES(quantity), remito=VALUES(remito),
        source_reference=VALUES(source_reference), detail=VALUES(detail), occurred_at=VALUES(occurred_at), created_by=VALUES(created_by)"
    );
    foreach (($state['stockMovements'] ?? []) as $movement) {
        if (!is_array($movement) || empty($movement['id'])) continue;
        if (($previousMovements[(string) $movement['id']] ?? null) === $movement) continue;
        $stockStatement->execute([
            (string) $movement['id'], $site, (int) ($movement['productId'] ?? 0), (string) ($movement['kind'] ?? ''),
            (int) ($movement['quantity'] ?? 0), (string) ($movement['remito'] ?? ''), $movement['reference'] ?? null,
            (string) ($movement['detail'] ?? ''), iso_datetime($movement['atISO'] ?? null), (string) ($movement['createdBy'] ?? ''),
        ]);
    }
}
