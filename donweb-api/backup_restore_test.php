<?php

declare(strict_types=1);

/*
 * Preflight mensual de recuperación. No importa ni modifica Producción: valida
 * hash, autenticidad, SQL y adjuntos de una copia reciente. La restauración
 * completa exige una base aislada configurada por Administración.
 */
require __DIR__ . '/bootstrap.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

date_default_timezone_set('America/Argentina/Buenos_Aires');
$root = dirname(__DIR__, 2);
$privateBackupConfig = $root . '/lartisan-backup-config.php';
$privateEncryptionConfig = $root . '/lartisan-backup-encryption.php';
foreach ([$privateBackupConfig, $privateEncryptionConfig] as $file) {
    if (!is_file($file)) throw new RuntimeException('Falta una configuración privada de respaldo.');
    $loaded = require $file;
    if (!is_array($loaded)) throw new RuntimeException('La configuración privada de respaldo no es válida.');
    $config['backup'] = array_replace_recursive($config['backup'] ?? [], $loaded);
}

$pdo = db($config);
ensure_restore_test_schema($pdo);
$runId = record_restore_test($pdo, 'running', null, null, null);

try {
    $database = $pdo->query("SELECT filename, sha256 FROM backup_runs WHERE status = 'verified' AND validation_status = 'restore_ready' ORDER BY id DESC LIMIT 1")->fetch();
    $assets = $pdo->query("SELECT filename, sha256 FROM backup_asset_runs WHERE status = 'verified' AND validation_status = 'restore_ready' ORDER BY id DESC LIMIT 1")->fetch();
    if (!$database || !$assets) throw new RuntimeException('No hay una copia completa verificada para probar.');
    $backupDirectory = $root . '/lartisan-backups';
    $databasePath = $backupDirectory . '/' . basename((string) $database['filename']);
    $assetsPath = $backupDirectory . '/' . basename((string) $assets['filename']);
    verify_hash($databasePath, (string) $database['sha256']);
    verify_hash($assetsPath, (string) $assets['sha256']);
    $key = restore_encryption_key($config);
    verify_database_payload($databasePath, $key);
    verify_assets_payload($assetsPath, $key);
    $pdo->prepare("UPDATE backup_restore_tests SET finished_at = NOW(), status = 'verified', database_filename = ?, assets_filename = ?, validation_status = 'preflight_verified' WHERE id = ?")
        ->execute([$database['filename'], $assets['filename'], $runId]);
    fwrite(STDOUT, "Preflight de recuperación verificado sin tocar Producción.\n");
} catch (Throwable $error) {
    $pdo->prepare("UPDATE backup_restore_tests SET finished_at = NOW(), status = 'failed', error_message = ? WHERE id = ?")
        ->execute([substr($error->getMessage(), 0, 1000), $runId]);
    fwrite(STDERR, "Falló el preflight de recuperación.\n");
    exit(1);
}

function ensure_restore_test_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS backup_restore_tests (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        started_at DATETIME NOT NULL,
        finished_at DATETIME NULL,
        status VARCHAR(30) NOT NULL,
        database_filename VARCHAR(255) NULL,
        assets_filename VARCHAR(255) NULL,
        validation_status VARCHAR(40) NULL,
        error_message VARCHAR(1000) NULL,
        INDEX idx_backup_restore_tests_started (started_at),
        INDEX idx_backup_restore_tests_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function record_restore_test(PDO $pdo, string $status, ?string $databaseFilename, ?string $assetsFilename, ?string $validationStatus): int
{
    $statement = $pdo->prepare('INSERT INTO backup_restore_tests (started_at, status, database_filename, assets_filename, validation_status) VALUES (NOW(), ?, ?, ?, ?)');
    $statement->execute([$status, $databaseFilename, $assetsFilename, $validationStatus]);
    return (int) $pdo->lastInsertId();
}

function restore_encryption_key(array $config): string
{
    $encoded = (string) ($config['backup']['encryption_key_base64'] ?? '');
    $key = $encoded === '' ? false : base64_decode($encoded, true);
    if (!is_string($key) || strlen($key) !== 32 || !function_exists('openssl_decrypt')) throw new RuntimeException('No se puede validar el cifrado del respaldo.');
    return $key;
}

function verify_hash(string $path, string $expected): void
{
    if (!is_file($path) || $expected === '' || !hash_equals($expected, hash_file('sha256', $path))) throw new RuntimeException('El hash de un respaldo no coincide.');
}

function decrypt_restore_payload(string $path, string $key): string
{
    $raw = file_get_contents($path);
    if ($raw === false || substr($raw, 0, 11) !== 'LARTISANENC1' || strlen($raw) < 39) throw new RuntimeException('El contenedor cifrado no es válido.');
    $plain = openssl_decrypt(substr($raw, 39), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr($raw, 11, 12), substr($raw, 23, 16));
    if ($plain === false) throw new RuntimeException('No se pudo autenticar un respaldo cifrado.');
    return $plain;
}

function verify_database_payload(string $path, string $key): void
{
    $tmp = tempnam(sys_get_temp_dir(), 'lartisan-restore-db-');
    if ($tmp === false) throw new RuntimeException('No se pudo preparar la validación de base.');
    try {
        file_put_contents($tmp, decrypt_restore_payload($path, $key), LOCK_EX);
        $gzip = gzopen($tmp, 'rb');
        if ($gzip === false) throw new RuntimeException('La base restaurable no se puede abrir.');
        $content = '';
        while (!gzeof($gzip) && strlen($content) < 4_000_000) $content .= (string) gzread($gzip, 65536);
        gzclose($gzip);
        foreach (['CREATE TABLE `users`', 'CREATE TABLE `operation_site_states`', 'CREATE TABLE `lartisan_sales`'] as $required) if (strpos($content, $required) === false) throw new RuntimeException('Falta estructura esencial en la base restaurable.');
    } finally { @unlink($tmp); }
}

function verify_assets_payload(string $path, string $key): void
{
    if (!class_exists('ZipArchive')) throw new RuntimeException('No se puede validar el archivo restaurable.');
    $tmp = tempnam(sys_get_temp_dir(), 'lartisan-restore-assets-');
    if ($tmp === false) throw new RuntimeException('No se pudo preparar la validación de archivos.');
    try {
        file_put_contents($tmp, decrypt_restore_payload($path, $key), LOCK_EX);
        $zip = new ZipArchive();
        if ($zip->open($tmp) !== true || $zip->locateName('manifest.json') === false) throw new RuntimeException('El respaldo de archivos no se puede restaurar.');
        $zip->close();
    } finally { @unlink($tmp); }
}
