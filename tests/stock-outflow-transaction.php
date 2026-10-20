<?php
declare(strict_types=1);
// Exclusively the disposable local development database, never production.
$configPath = realpath(__DIR__ . '/../dev/config.dev.php');
putenv('LARTISAN_CONFIG=' . $configPath);
require __DIR__ . '/../donweb-api/bootstrap.php';
require __DIR__ . '/../donweb-api/stock_outflow.php';
$config = require $configPath;
if ($config['database']['name'] !== 'lartisan_dev' || $config['database']['host'] !== '127.0.0.1;port=3313') throw new RuntimeException('Refusing non-test database');
$pdo = db($config);
ensure_operations_schema($pdo);
ensure_stock_outflow_schema($pdo);
if (($argv[1] ?? '') === '--worker') {
    try { decide_stock_outflow($pdo, $argv[2], $argv[3], ['id' => (int) $argv[4], 'username' => 'Test'], 'approve'); echo 'approved'; }
    catch (DomainException $e) { echo 'already-decided'; }
    exit;
}
$actorId = (int) $pdo->query('SELECT id FROM users ORDER BY id LIMIT 1')->fetchColumn();
if (!$actorId) throw new RuntimeException('No test user in development database');
$site = 'TEST-OUTFLOW-' . bin2hex(random_bytes(8));
$id = sprintf('%s-%s-4%s-a%s-%s', bin2hex(random_bytes(4)), bin2hex(random_bytes(2)), substr(bin2hex(random_bytes(2)), 1), substr(bin2hex(random_bytes(2)), 1), bin2hex(random_bytes(6)));
$item = make_stock_outflow_request(['id' => $id, 'destination' => 'Test', 'carrier' => 'Test', 'reason' => 'Test', 'lines' => [['productId' => 987654, 'quantity' => 2]]], $site, 'Test', gmdate('c'));
$state = ['stock' => ['987654' => 5], 'stockMovements' => [], 'cashOpen' => true, 'cashSession' => ['id' => 'test-cash-intact']];
$pdo->prepare('INSERT INTO operation_site_states (site,state_json,revision,updated_by) VALUES (?,?,1,?)')->execute([$site, json_encode($state), $actorId]);
$pdo->prepare('INSERT INTO stock_outflow_requests (id,site,status,request_json,created_by) VALUES (?,?,?,?,?)')->execute([$id, $site, 'Pendiente', json_encode($item), $actorId]);
$extension = 'C:/laragon/bin/php/php-8.3.30-Win32-vs16-x64/ext/php_pdo_mysql.dll';
$command = [PHP_BINARY, '-d', 'extension=' . $extension, __FILE__, '--worker', $id, $site, (string) $actorId];
$pipes1 = $pipes2 = [];
$one = proc_open($command, [1 => ['pipe','w'], 2 => ['pipe','w']], $pipes1);
$two = proc_open($command, [1 => ['pipe','w'], 2 => ['pipe','w']], $pipes2);
if (!is_resource($one) || !is_resource($two)) throw new RuntimeException('Cannot launch concurrent workers');
$a = stream_get_contents($pipes1[1]); $ae = stream_get_contents($pipes1[2]); fclose($pipes1[1]); fclose($pipes1[2]); $ac = proc_close($one);
$b = stream_get_contents($pipes2[1]); $be = stream_get_contents($pipes2[2]); fclose($pipes2[1]); fclose($pipes2[2]); $bc = proc_close($two);
if ($ac !== 0 || $bc !== 0 || [$a, $b] !== ['approved', 'already-decided'] && [$b, $a] !== ['approved', 'already-decided']) throw new RuntimeException("Concurrent outcome: $a $b $ae $be");
$query = $pdo->prepare('SELECT state_json FROM operation_site_states WHERE site=?'); $query->execute([$site]); $after = json_decode((string)$query->fetchColumn(), true);
if (($after['stock']['987654'] ?? null) != 3 || count($after['stockMovements'] ?? []) !== 1 || ($after['cashSession'] ?? null) !== $state['cashSession']) throw new RuntimeException('Stock, movement or cash mismatch');
$query = $pdo->prepare('SELECT COUNT(*) FROM lartisan_stock_movements WHERE site=? AND source_reference=?'); $query->execute([$site,$id]);
if ((int)$query->fetchColumn() !== 1) throw new RuntimeException('Normalized movement missing or duplicated');
[$stale] = protect_stock_snapshot_integrity($after, $state);
if (($stale['stock']['987654'] ?? null) != 3 || count($stale['stockMovements'] ?? []) !== 1) throw new RuntimeException('Stale snapshot erased the approved movement');
$secondId = sprintf('%s-%s-4%s-a%s-%s', bin2hex(random_bytes(4)), bin2hex(random_bytes(2)), substr(bin2hex(random_bytes(2)), 1), substr(bin2hex(random_bytes(2)), 1), bin2hex(random_bytes(6)));
$insufficient = make_stock_outflow_request(['id' => $secondId, 'destination' => 'Test', 'carrier' => 'Test', 'reason' => 'Test', 'lines' => [['productId' => 987654, 'quantity' => 4]]], $site, 'Test', gmdate('c'));
$pdo->prepare('INSERT INTO stock_outflow_requests (id,site,status,request_json,created_by) VALUES (?,?,?,?,?)')->execute([$secondId, $site, 'Pendiente', json_encode($insufficient), $actorId]);
try { decide_stock_outflow($pdo, $secondId, $site, ['id' => $actorId, 'username' => 'Test'], 'approve'); throw new RuntimeException('Insufficient stock accepted'); } catch (DomainException $expected) {}
$query = $pdo->prepare('SELECT status FROM stock_outflow_requests WHERE id=?'); $query->execute([$secondId]);
if ($query->fetchColumn() !== 'Pendiente') throw new RuntimeException('Failed approval changed request');
$query = $pdo->prepare('SELECT state_json FROM operation_site_states WHERE site=?'); $query->execute([$site]);
if (json_decode((string)$query->fetchColumn(), true) !== $after) throw new RuntimeException('Failed approval changed state');
echo "Concurrent approvals: one commit, one rejection, one stock movement; unrelated cash unchanged.\n";
