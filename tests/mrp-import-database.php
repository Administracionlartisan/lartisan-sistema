<?php
// Run ONLY against the isolated disposable MySQL instance on loopback port 33317.
declare(strict_types=1);
require __DIR__ . '/../donweb-api/mrp_sync.php';
$pdo = new PDO('mysql:host=127.0.0.1;port=33317;charset=utf8mb4', 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE DATABASE mrp_migration_test');
$pdo->exec('USE mrp_migration_test');
$bundle = json_decode(file_get_contents($argv[1]), true, 64, JSON_THROW_ON_ERROR);
$failAudit = true;
function audit(PDO $pdo, int $userId, string $action, string $detail = ''): void {
    global $failAudit;
    if ($failAudit) throw new RuntimeException('Injected failure before commit');
}
function checkDb(bool $value, string $label): void { if (!$value) throw new RuntimeException($label); }
try { mrp_import_once($pdo, $bundle, 1); throw new LogicException('Expected failure'); }
catch (RuntimeException $error) { checkDb($error->getMessage() === 'Injected failure before commit', $error->getMessage()); }
foreach (['mrp_input_catalog', 'mrp_recipe_catalog', 'mrp_recipe_components', 'mrp_sync_runs'] as $table)
    checkDb((int) $pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn() === 0, 'Rollback failed: ' . $table);
$failAudit = false;
$first = mrp_import_once($pdo, $bundle, 1);
checkDb($first['alreadyImported'] === false, 'First import');
$second = mrp_import_once($pdo, $bundle, 1);
checkDb($second['alreadyImported'] === true, 'Idempotency');
checkDb((int) $pdo->query('SELECT COUNT(*) FROM mrp_sync_runs')->fetchColumn() === 1, 'Duplicate run');
$different = $bundle; $different['sourceSha256'] = str_repeat('a', 64);
try { mrp_import_once($pdo, $different, 1); throw new LogicException('Overwrite allowed'); }
catch (InvalidArgumentException $error) { /* expected: existing catalog is protected */ }
$row = $pdo->query("SELECT payload_json,payload_hash,status FROM mrp_sync_runs")->fetch(PDO::FETCH_ASSOC);
checkDb($row['status'] === 'verified' && hash('sha256', $row['payload_json']) === $row['payload_hash'], 'Payload integrity');
foreach (['inputs' => 'mrp_input_catalog', 'recipes' => 'mrp_recipe_catalog', 'components' => 'mrp_recipe_components'] as $key => $table)
    checkDb((int) $pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn() === $first['counts'][$key], 'Persisted count');
echo json_encode(['rollback' => 'passed', 'idempotency' => 'passed', 'overwriteProtection' => 'passed', 'payloadIntegrity' => 'passed', 'counts' => $first['counts']], JSON_PRETTY_PRINT);
