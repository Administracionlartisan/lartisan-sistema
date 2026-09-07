<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/bootstrap.php';

date_default_timezone_set('America/Argentina/Buenos_Aires');
$pdo = db($config);
$command = $argv[1] ?? 'run';
$backupDirectory = dirname(__DIR__, 2) . '/lartisan-backups';

if (!is_dir($backupDirectory) && !mkdir($backupDirectory, 0700, true) && !is_dir($backupDirectory)) {
    throw new RuntimeException('No se pudo crear el directorio privado de respaldos.');
}

ensure_backup_schema($pdo);

if ($command === 'verify') {
    $file = $argv[2] ?? latest_backup($backupDirectory);
    verify_backup($file);
    fwrite(STDOUT, "Respaldo verificado: $file\n");
    exit(0);
}

if ($command !== 'run') {
    fwrite(STDERR, "Uso: php backup.php [run|verify /ruta/archivo.sql.gz]\n");
    exit(2);
}

$startedAt = date('Y-m-d H:i:s');
$filename = 'lartisan-' . date('Ymd-His') . '.sql.gz';
$path = $backupDirectory . '/' . $filename;
$run = $pdo->prepare("INSERT INTO backup_runs (started_at, status, filename) VALUES (?, 'running', ?)");
$run->execute([$startedAt, $filename]);
$runId = (int) $pdo->lastInsertId();

try {
    create_sql_backup($pdo, $path);
    verify_backup($path);
    $hash = hash_file('sha256', $path);
    $driveFileId = upload_to_drive($config, $path);
    $pdo->prepare(
        "UPDATE backup_runs SET finished_at = NOW(), status = 'verified', size_bytes = ?, sha256 = ?, drive_file_id = ? WHERE id = ?"
    )->execute([filesize($path), $hash, $driveFileId, $runId]);
    remove_old_backups($backupDirectory, (int) ($config['backup']['local_retention_days'] ?? 30));
    fwrite(STDOUT, "Respaldo verificado y enviado a Drive: $filename\n");
} catch (Throwable $error) {
    $pdo->prepare(
        "UPDATE backup_runs SET finished_at = NOW(), status = 'failed', error_message = ? WHERE id = ?"
    )->execute([substr($error->getMessage(), 0, 1000), $runId]);
    fwrite(STDERR, 'Falló el respaldo: ' . $error->getMessage() . "\n");
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
            drive_file_id VARCHAR(255) NULL,
            error_message VARCHAR(1000) NULL,
            INDEX idx_backup_runs_started (started_at),
            INDEX idx_backup_runs_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function create_sql_backup(PDO $pdo, string $path): void
{
    $gzip = gzopen($path, 'wb9');
    if ($gzip === false) throw new RuntimeException('No se pudo crear el archivo de respaldo.');
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
    gzwrite($gzip, "COMMIT;\nSET FOREIGN_KEY_CHECKS=1;\n-- LARTISAN_BACKUP_COMPLETE\n");
    gzclose($gzip);
}

function verify_backup(string $path): void
{
    if (!is_file($path) || filesize($path) < 100) throw new RuntimeException('El respaldo no existe o está vacío.');
    $gzip = gzopen($path, 'rb');
    if ($gzip === false) throw new RuntimeException('El respaldo comprimido no puede abrirse.');
    $tail = '';
    while (!gzeof($gzip)) $tail = substr($tail . (string) gzread($gzip, 8192), -256);
    gzclose($gzip);
    if (!str_contains($tail, 'LARTISAN_BACKUP_COMPLETE')) throw new RuntimeException('El respaldo está incompleto.');
}

function upload_to_drive(array $config, string $path): string
{
    $drive = $config['backup']['drive'] ?? [];
    foreach (['client_id', 'client_secret', 'refresh_token', 'folder_id'] as $key) {
        if (empty($drive[$key])) throw new RuntimeException("Google Drive no está configurado: falta $key.");
    }
    if (!function_exists('curl_init')) throw new RuntimeException('La extensión cURL no está disponible.');
    $tokenRequest = curl_init('https://oauth2.googleapis.com/token');
    curl_setopt_array($tokenRequest, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POSTFIELDS => http_build_query([
            'client_id' => $drive['client_id'],
            'client_secret' => $drive['client_secret'],
            'refresh_token' => $drive['refresh_token'],
            'grant_type' => 'refresh_token',
        ]),
    ]);
    $tokenBody = curl_exec($tokenRequest);
    $tokenStatus = (int) curl_getinfo($tokenRequest, CURLINFO_RESPONSE_CODE);
    curl_close($tokenRequest);
    $tokenData = json_decode((string) $tokenBody, true);
    if ($tokenStatus !== 200 || empty($tokenData['access_token'])) throw new RuntimeException('Drive rechazó la autorización.');

    $metadata = json_encode(['name' => basename($path), 'parents' => [$drive['folder_id']]], JSON_UNESCAPED_SLASHES);
    $start = curl_init('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id');
    curl_setopt_array($start, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $tokenData['access_token'],
            'Content-Type: application/json; charset=UTF-8',
            'X-Upload-Content-Type: application/gzip',
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
        CURLOPT_HTTPHEADER => ['Content-Type: application/gzip'],
    ]);
    $uploadBody = curl_exec($upload);
    $uploadStatus = (int) curl_getinfo($upload, CURLINFO_RESPONSE_CODE);
    curl_close($upload);
    fclose($file);
    $uploaded = json_decode((string) $uploadBody, true);
    if (!in_array($uploadStatus, [200, 201], true) || empty($uploaded['id'])) throw new RuntimeException('Drive no confirmó la carga del respaldo.');
    return (string) $uploaded['id'];
}

function latest_backup(string $directory): string
{
    $files = glob($directory . '/lartisan-*.sql.gz') ?: [];
    usort($files, static fn (string $a, string $b): int => filemtime($b) <=> filemtime($a));
    if (!$files) throw new RuntimeException('No hay respaldos para verificar.');
    return $files[0];
}

function remove_old_backups(string $directory, int $days): void
{
    $limit = time() - max(1, $days) * 86400;
    foreach (glob($directory . '/lartisan-*.sql.gz') ?: [] as $file) {
        if (filemtime($file) < $limit) @unlink($file);
    }
}
