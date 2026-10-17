<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$privateBackupConfigPath = dirname(__DIR__, 2) . '/lartisan-backup-config.php';
if (is_file($privateBackupConfigPath)) {
    $privateBackupConfig = require $privateBackupConfigPath;
    if (!is_array($privateBackupConfig)) {
        throw new RuntimeException('La configuracion privada de respaldos no es valida.');
    }
    $config['backup'] = array_replace_recursive($config['backup'] ?? [], $privateBackupConfig);
}

// La clave de cifrado se separa de la integración Drive para poder rotarla sin
// abrir ni reescribir credenciales existentes. Vive fuera de public_html.
$privateEncryptionConfigPath = dirname(__DIR__, 2) . '/lartisan-backup-encryption.php';
if (is_file($privateEncryptionConfigPath)) {
    $privateEncryptionConfig = require $privateEncryptionConfigPath;
    if (!is_array($privateEncryptionConfig)) {
        throw new RuntimeException('La configuración privada de cifrado no es válida.');
    }
    $config['backup'] = array_replace_recursive($config['backup'] ?? [], $privateEncryptionConfig);
}

if (PHP_SAPI !== 'cli') {
    $providedKey = (string) ($_SERVER['HTTP_X_BACKUP_KEY'] ?? '');
    $expectedKey = (string) ($config['backup']['trigger_key'] ?? '');
    if ($expectedKey === '' || !hash_equals($expectedKey, $providedKey)) {
        http_response_code(404);
        exit;
    }
    header('Content-Type: text/plain; charset=UTF-8');
}

date_default_timezone_set('America/Argentina/Buenos_Aires');
$pdo = db($config);
$command = $argv[1] ?? 'run';
$backupDirectory = dirname(__DIR__, 2) . '/lartisan-backups';
$accountRoot = dirname(__DIR__, 2);

if (!is_dir($backupDirectory) && !mkdir($backupDirectory, 0700, true) && !is_dir($backupDirectory)) {
    throw new RuntimeException('No se pudo crear el directorio privado de respaldos.');
}

ensure_backup_schema($pdo);
ensure_backup_monitoring_schema($pdo);

if ($command === 'verify') {
    $file = $argv[2] ?? latest_backup($backupDirectory);
    verify_encrypted_backup($file, backup_encryption_key($config));
    fwrite(STDOUT, "Respaldo verificado: $file\n");
    exit(0);
}

if ($command !== 'run') {
    fwrite(STDERR, "Uso: php backup.php [run|verify /ruta/archivo.sql.gz]\n");
    exit(2);
}

$startedAt = date('Y-m-d H:i:s');
$backupClass = backup_class(new DateTimeImmutable('now'));
$filename = 'lartisan-' . date('Ymd-His') . '-' . $backupClass . '.sql.gz.enc';
$path = $backupDirectory . '/' . $filename;
$run = $pdo->prepare("INSERT INTO backup_runs (started_at, status, filename, backup_class) VALUES (?, 'running', ?, ?)");
$run->execute([$startedAt, $filename, $backupClass]);
$runId = (int) $pdo->lastInsertId();

try {
    $plainPath = $path . '.work';
    create_sql_backup($pdo, $plainPath);
    verify_backup($plainPath);
    encrypt_backup($plainPath, $path, backup_encryption_key($config));
    @unlink($plainPath);
    verify_encrypted_backup($path, backup_encryption_key($config));
    $hash = hash_file('sha256', $path);
    $driveFileId = upload_to_drive($config, $path);
    $pdo->prepare(
        "UPDATE backup_runs SET finished_at = NOW(), status = 'verified', size_bytes = ?, sha256 = ?, drive_file_id = ?, encryption = 'aes-256-gcm', validation_status = 'restore_ready', manifest_sha256 = ? WHERE id = ?"
    )->execute([filesize($path), $hash, $driveFileId, hash('sha256', backup_manifest($filename, $backupClass, $hash)), $runId]);
    $assetRun = create_assets_backup($config, $pdo, $accountRoot, $backupDirectory, $backupClass);
    prune_drive_backups($config);
    remove_old_backups($backupDirectory, (int) ($config['backup']['local_retention_days'] ?? 30));
    $message = "Respaldo verificado y enviado a Drive: $filename; archivos: " . $assetRun['filename'] . "\n";
    if (PHP_SAPI === 'cli') fwrite(STDOUT, $message); else echo $message;
} catch (Throwable $error) {
    $pdo->prepare(
        "UPDATE backup_runs SET finished_at = NOW(), status = 'failed', error_message = ? WHERE id = ?"
    )->execute([substr($error->getMessage(), 0, 1000), $runId]);
    $message = 'Falló el respaldo: ' . $error->getMessage() . "\n";
    if (PHP_SAPI === 'cli') fwrite(STDERR, $message); else echo $message;
    if (PHP_SAPI !== 'cli') http_response_code(500);
    exit(1);
}

function ensure_backup_schema(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS backup_runs (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            started_at DATETIME NOT NULL,
            finished_at DATETIME NULL,
            status VARCHAR(30) NOT NULL,
            filename VARCHAR(255) NOT NULL,
            size_bytes BIGINT UNSIGNED NULL,
            sha256 CHAR(64) NULL,
            encryption VARCHAR(40) NULL,
            validation_status VARCHAR(40) NULL,
            manifest_sha256 CHAR(64) NULL,
            backup_class VARCHAR(16) NULL,
            drive_file_id VARCHAR(255) NULL,
            error_message VARCHAR(1000) NULL,
            INDEX idx_backup_runs_started (started_at),
            INDEX idx_backup_runs_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function ensure_backup_asset_schema(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS backup_asset_runs (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            started_at DATETIME NOT NULL,
            finished_at DATETIME NULL,
            status VARCHAR(30) NOT NULL,
            filename VARCHAR(255) NOT NULL,
            backup_class VARCHAR(16) NULL,
            size_bytes BIGINT UNSIGNED NULL,
            sha256 CHAR(64) NULL,
            drive_file_id VARCHAR(255) NULL,
            validation_status VARCHAR(40) NULL,
            error_message VARCHAR(1000) NULL,
            INDEX idx_backup_asset_runs_started (started_at),
            INDEX idx_backup_asset_runs_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function backup_class(DateTimeImmutable $now): string
{
    if ($now->format('d') === '01') return 'monthly';
    if ($now->format('N') === '7') return 'weekly';
    return 'daily';
}

function backup_encryption_key(array $config): string
{
    $encoded = (string) ($config['backup']['encryption_key_base64'] ?? '');
    $key = $encoded === '' ? false : base64_decode($encoded, true);
    if (!is_string($key) || strlen($key) !== 32) throw new RuntimeException('No hay una clave válida de cifrado de respaldos en la configuración privada.');
    if (!function_exists('openssl_encrypt')) throw new RuntimeException('El servidor no dispone de OpenSSL para cifrar respaldos.');
    return $key;
}

function encrypt_backup(string $plainPath, string $encryptedPath, string $key): void
{
    $plain = file_get_contents($plainPath);
    if ($plain === false) throw new RuntimeException('No se pudo leer el respaldo para cifrarlo.');
    $iv = random_bytes(12); $tag = '';
    $cipher = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    if ($cipher === false || strlen($tag) !== 16) throw new RuntimeException('Falló el cifrado autenticado del respaldo.');
    $written = file_put_contents($encryptedPath, "LARTISANENC1" . $iv . $tag . $cipher, LOCK_EX);
    if ($written === false) throw new RuntimeException('No se pudo guardar el respaldo cifrado.');
    @chmod($encryptedPath, 0600);
}

function decrypt_backup(string $encryptedPath, string $key): string
{
    $raw = file_get_contents($encryptedPath);
    if ($raw === false || substr($raw, 0, 11) !== 'LARTISANENC1' || strlen($raw) < 39) throw new RuntimeException('El respaldo cifrado está incompleto o no es válido.');
    $plain = openssl_decrypt(substr($raw, 39), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr($raw, 11, 12), substr($raw, 23, 16));
    if ($plain === false) throw new RuntimeException('No se pudo validar la autenticidad del respaldo cifrado.');
    return $plain;
}

function verify_encrypted_backup(string $path, string $key): void
{
    $plain = decrypt_backup($path, $key);
    $tmp = tempnam(sys_get_temp_dir(), 'lartisan-restore-check-');
    if ($tmp === false) throw new RuntimeException('No se pudo crear el entorno temporal de validación.');
    try { file_put_contents($tmp, $plain, LOCK_EX); verify_backup($tmp); }
    finally { @unlink($tmp); }
}

function backup_manifest(string $filename, string $class, string $hash): string
{
    return json_encode(['filename' => $filename, 'class' => $class, 'sha256' => $hash, 'environment' => 'production', 'format' => 'sql.gz.aes-256-gcm'], JSON_UNESCAPED_SLASHES);
}

function create_sql_backup(PDO $pdo, string $path): void
{
    $gzip = gzopen($path, 'wb9');
    if ($gzip === false) throw new RuntimeException('No se pudo crear el archivo de respaldo.');
    try {
        $pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        $pdo->beginTransaction();
        gzwrite($gzip, "-- L'ARTISAN database backup\nSET FOREIGN_KEY_CHECKS=0;\nSTART TRANSACTION;\n");
        $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
        foreach ($tables as $table) {
            $safeTable = str_replace('`', '``', (string) $table);
            $create = $pdo->query("SHOW CREATE TABLE `$safeTable`")->fetch(PDO::FETCH_NUM);
            if (!$create || !isset($create[1])) throw new RuntimeException("No se pudo leer la tabla $table.");
            gzwrite($gzip, "\nDROP TABLE IF EXISTS `$safeTable`;\n" . $create[1] . ";\n");
            $rows = $pdo->query("SELECT * FROM `$safeTable`");
            while ($row = $rows->fetch(PDO::FETCH_ASSOC)) {
                $columns = array_map(static fn (string $column): string => '`' . str_replace('`', '``', $column) . '`', array_keys($row));
                $values = array_map(static fn ($value): string => $value === null ? 'NULL' : $pdo->quote((string) $value), array_values($row));
                gzwrite($gzip, "INSERT INTO `$safeTable` (" . implode(',', $columns) . ') VALUES (' . implode(',', $values) . ");\n");
            }
        }
        $pdo->commit();
        gzwrite($gzip, "COMMIT;\nSET FOREIGN_KEY_CHECKS=1;\n-- LARTISAN_BACKUP_COMPLETE\n");
        gzclose($gzip);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        gzclose($gzip);
        @unlink($path);
        throw $error;
    }
}

function verify_backup(string $path): void
{
    if (!is_file($path) || filesize($path) < 100) throw new RuntimeException('El respaldo no existe o está vacío.');
    $gzip = gzopen($path, 'rb');
    if ($gzip === false) throw new RuntimeException('El respaldo comprimido no puede abrirse.');
    $tail = '';
    $scan = '';
    $hasUsers = false;
    $hasOperations = false;
    while (!gzeof($gzip)) {
        $chunk = (string) gzread($gzip, 8192);
        $tail = substr($tail . $chunk, -256);
        $scan = substr($scan . $chunk, -32768);
        $hasUsers = $hasUsers || str_contains($scan, 'CREATE TABLE `users`');
        $hasOperations = $hasOperations || str_contains($scan, 'CREATE TABLE `operation_site_states`');
    }
    gzclose($gzip);
    if (strpos($tail, 'LARTISAN_BACKUP_COMPLETE') === false) throw new RuntimeException('El respaldo está incompleto.');
    if (!$hasUsers || !$hasOperations) throw new RuntimeException('El respaldo no contiene las tablas esenciales del sistema.');
}

function upload_to_drive(array $config, string $path): string
{
    $drive = $config['backup']['drive'] ?? [];
    $accessToken = google_drive_access_token($drive);
    if (empty($drive['folder_id'])) throw new RuntimeException('Google Drive no está configurado: falta folder_id.');
    if (!function_exists('curl_init')) throw new RuntimeException('La extensión cURL no está disponible.');
    $metadata = json_encode(['name' => basename($path), 'parents' => [$drive['folder_id']]], JSON_UNESCAPED_SLASHES);
    $start = curl_init('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id');
    curl_setopt_array($start, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $accessToken,
            'Content-Type: application/json; charset=UTF-8',
            'X-Upload-Content-Type: application/octet-stream',
            'X-Upload-Content-Length: ' . filesize($path),
        ],
        CURLOPT_POSTFIELDS => $metadata,
    ]);
    $startBody = (string) curl_exec($start);
    $startStatus = (int) curl_getinfo($start, CURLINFO_RESPONSE_CODE);
    $headerSize = (int) curl_getinfo($start, CURLINFO_HEADER_SIZE);
    curl_close($start);
    if ($startStatus !== 200) throw new RuntimeException('Drive no inició la carga del respaldo.');
    $headers = substr($startBody, 0, $headerSize);
    if (!preg_match('/^Location:\s*(.+)$/mi', $headers, $match)) throw new RuntimeException('Drive no devolvió una dirección de carga.');

    $file = fopen($path, 'rb');
    if ($file === false) throw new RuntimeException('No se pudo abrir el respaldo para enviarlo.');
    $upload = curl_init(trim($match[1]));
    curl_setopt_array($upload, [
        CURLOPT_CUSTOMREQUEST => 'PUT',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_UPLOAD => true,
        CURLOPT_INFILE => $file,
        CURLOPT_INFILESIZE => filesize($path),
        CURLOPT_HTTPHEADER => ['Content-Type: application/octet-stream'],
    ]);
    $uploadBody = curl_exec($upload);
    $uploadStatus = (int) curl_getinfo($upload, CURLINFO_RESPONSE_CODE);
    curl_close($upload);
    fclose($file);
    $uploaded = json_decode((string) $uploadBody, true);
    if (!in_array($uploadStatus, [200, 201], true) || empty($uploaded['id'])) throw new RuntimeException('Drive no confirmó la carga del respaldo.');
    return (string) $uploaded['id'];
}

function google_drive_access_token(array $drive): string
{
    foreach (['client_id', 'client_secret', 'refresh_token'] as $key) if (empty($drive[$key])) throw new RuntimeException("Google Drive no está configurado: falta $key.");
    if (!function_exists('curl_init')) throw new RuntimeException('La extensión cURL no está disponible.');
    $request = curl_init('https://oauth2.googleapis.com/token');
    curl_setopt_array($request, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POSTFIELDS => http_build_query(['client_id' => $drive['client_id'], 'client_secret' => $drive['client_secret'], 'refresh_token' => $drive['refresh_token'], 'grant_type' => 'refresh_token']),
    ]);
    $body = curl_exec($request); $status = (int) curl_getinfo($request, CURLINFO_RESPONSE_CODE); curl_close($request);
    $data = json_decode((string) $body, true);
    if ($status !== 200 || empty($data['access_token'])) throw new RuntimeException('Drive rechazó la autorización.');
    return (string) $data['access_token'];
}

/** Respaldos separados de adjuntos y configuraciones: se cifran antes de salir del servidor. */
function create_assets_backup(array $config, PDO $pdo, string $root, string $directory, string $class): array
{
    ensure_backup_asset_schema($pdo);
    if (!class_exists('ZipArchive')) throw new RuntimeException('La extensión ZIP es necesaria para respaldar archivos y configuración.');
    $filename = 'lartisan-assets-' . date('Ymd-His') . '-' . $class . '.zip.enc';
    $path = $directory . '/' . $filename;
    $plainPath = $path . '.work';
    $startedAt = date('Y-m-d H:i:s');
    $insert = $pdo->prepare("INSERT INTO backup_asset_runs (started_at, status, filename, backup_class) VALUES (?, 'running', ?, ?)");
    $insert->execute([$startedAt, $filename, $class]);
    $runId = (int) $pdo->lastInsertId();
    try {
        $archive = new ZipArchive();
        if ($archive->open($plainPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) throw new RuntimeException('No se pudo crear el respaldo de archivos.');
        $paths = $config['backup']['asset_paths'] ?? [
            'public_html/documents', 'public_html/images', 'public_html/carga', 'public_html/capacitacion-media',
            'lartisan-backup-config.php', 'lartisan-arca-config.php', 'lartisan-cash-sheet-config.php',
        ];
        foreach ($paths as $relative) add_backup_path($archive, $root, (string) $relative);
        $archive->addFromString('manifest.json', json_encode(['created_at' => date(DATE_ATOM), 'environment' => 'production', 'class' => $class], JSON_UNESCAPED_SLASHES));
        $archive->close();
        if (!is_file($plainPath) || filesize($plainPath) < 22) throw new RuntimeException('El respaldo de archivos está incompleto.');
        encrypt_backup($plainPath, $path, backup_encryption_key($config));
        @unlink($plainPath);
        verify_encrypted_assets_backup($path, backup_encryption_key($config));
        $hash = hash_file('sha256', $path);
        $driveFileId = upload_to_drive($config, $path);
        $pdo->prepare("UPDATE backup_asset_runs SET finished_at = NOW(), status = 'verified', size_bytes = ?, sha256 = ?, drive_file_id = ?, validation_status = 'restore_ready' WHERE id = ?")
            ->execute([filesize($path), $hash, $driveFileId, $runId]);
        return ['filename' => $filename, 'sha256' => $hash];
    } catch (Throwable $error) {
        @unlink($plainPath);
        $pdo->prepare("UPDATE backup_asset_runs SET finished_at = NOW(), status = 'failed', error_message = ? WHERE id = ?")
            ->execute([substr($error->getMessage(), 0, 1000), $runId]);
        throw $error;
    }
}

function add_backup_path(ZipArchive $archive, string $root, string $relative): void
{
    $relative = ltrim(str_replace('\\', '/', $relative), '/');
    if ($relative === '' || strpos($relative, '..') !== false || $relative === 'lartisan-backup-encryption.php') return;
    $path = $root . '/' . $relative;
    if (is_file($path)) { $archive->addFile($path, $relative); return; }
    if (!is_dir($path)) return;
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if (!$file->isFile() || $file->isLink()) continue;
        $absolute = $file->getPathname();
        $archive->addFile($absolute, $relative . '/' . substr(str_replace('\\', '/', $absolute), strlen(str_replace('\\', '/', $path)) + 1));
    }
}

function verify_encrypted_assets_backup(string $path, string $key): void
{
    $plain = decrypt_backup($path, $key);
    $tmp = tempnam(sys_get_temp_dir(), 'lartisan-assets-check-');
    if ($tmp === false) throw new RuntimeException('No se pudo validar el respaldo de archivos.');
    try {
        file_put_contents($tmp, $plain, LOCK_EX);
        $archive = new ZipArchive();
        if ($archive->open($tmp) !== true || $archive->locateName('manifest.json') === false) throw new RuntimeException('El respaldo de archivos no se puede restaurar.');
        $archive->close();
    } finally { @unlink($tmp); }
}

function prune_drive_backups(array $config): void
{
    $drive = $config['backup']['drive'] ?? [];
    if (empty($drive['folder_id'])) throw new RuntimeException('No se puede aplicar retención externa: falta folder_id de Drive.');
    $token = google_drive_access_token($drive);
    $query = "'" . str_replace("'", "\\'", (string) $drive['folder_id']) . "' in parents and trashed = false";
    $url = 'https://www.googleapis.com/drive/v3/files?' . http_build_query(['q' => $query, 'fields' => 'nextPageToken,files(id,name,createdTime)', 'pageSize' => 1000]);
    $files = [];
    do {
        $request = curl_init($url);
        curl_setopt_array($request, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token]]);
        $body = curl_exec($request); $status = (int) curl_getinfo($request, CURLINFO_RESPONSE_CODE); curl_close($request);
        $data = json_decode((string) $body, true);
        if ($status !== 200 || !is_array($data)) throw new RuntimeException('Drive no permitió consultar la retención de respaldos.');
        $files = array_merge($files, is_array($data['files'] ?? null) ? $data['files'] : []);
        $url = empty($data['nextPageToken']) ? '' : 'https://www.googleapis.com/drive/v3/files?' . http_build_query(['q' => $query, 'fields' => 'nextPageToken,files(id,name,createdTime)', 'pageSize' => 1000, 'pageToken' => $data['nextPageToken']]);
    } while ($url !== '');
    $limits = ['daily' => 30, 'weekly' => 92, 'monthly' => 366];
    foreach ($files as $file) {
        $name = (string) ($file['name'] ?? '');
        if (!preg_match('/^lartisan(?:-assets)?-\\d{8}-\\d{6}-(daily|weekly|monthly)\\.(?:sql\\.gz|zip)\\.enc$/', $name, $match)) continue;
        $created = strtotime((string) ($file['createdTime'] ?? ''));
        if ($created === false || $created >= time() - $limits[$match[1]] * 86400) continue;
        $delete = curl_init('https://www.googleapis.com/drive/v3/files/' . rawurlencode((string) $file['id']));
        curl_setopt_array($delete, [CURLOPT_CUSTOMREQUEST => 'DELETE', CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token]]);
        $status = (int) curl_getinfo($delete, CURLINFO_RESPONSE_CODE); curl_close($delete);
        if (!in_array($status, [204, 404], true)) throw new RuntimeException('Drive no confirmó la retención externa de respaldos.');
    }
}

function latest_backup(string $directory): string
{
    $files = glob($directory . '/lartisan-*.sql.gz.enc') ?: [];
    usort($files, static fn (string $a, string $b): int => filemtime($b) <=> filemtime($a));
    if (!$files) throw new RuntimeException('No hay respaldos para verificar.');
    return $files[0];
}

function remove_old_backups(string $directory, int $days): void
{
    $limit = time() - max(1, $days) * 86400;
    $files = array_merge(glob($directory . '/lartisan-*.sql.gz.enc') ?: [], glob($directory . '/lartisan-assets-*.zip.enc') ?: []);
    foreach ($files as $file) {
        if (filemtime($file) < $limit) @unlink($file);
    }
}
