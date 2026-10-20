<?php
declare(strict_types=1);
require __DIR__ . '/../donweb-api/mrp_sync.php';
function check($condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function rejected(array $bundle): void {
    try { mrp_snapshot_from_import($bundle); } catch (InvalidArgumentException $error) { return; }
    throw new RuntimeException('Invalid source was accepted');
}
$bundle = json_decode(file_get_contents($argv[1]), true, 64, JSON_THROW_ON_ERROR);
$snapshot = mrp_snapshot_from_import($bundle);
check($snapshot['importCounts'] === ['inputs' => 223, 'recipes' => 111, 'components' => 640], 'Source counts changed: review migration');
check(count($snapshot['plan']) === 60, 'Plan count mismatch');
foreach ($snapshot['recipes'] as $recipe) foreach ($recipe['items'] as $item) {
    check(abs(($item['yield'] ? $item['quantity'] / $item['yield'] : $item['quantity']) - $item['perUnit']) < 0.0001, 'Quantity differs');
}
$bad = $bundle; $bad['ranges'][5][1][5] = 999; rejected($bad);
$bad = $bundle; $bad['ranges'][5][1][1] = ''; rejected($bad);
$bad = $bundle; $bad['ranges'][4][] = $bad['ranges'][4][1]; rejected($bad);
$bad = $bundle; $bad['ranges'][4][0] = []; rejected($bad);
$bad = $bundle; $bad['ranges'][5][1][4] = 0; rejected($bad);
$bad = $bundle; $bad['sourceSpreadsheetId'] = 'wrong-source'; rejected($bad);
$bad = $bundle; $bad['ranges'] = []; rejected($bad);
if (isset($argv[2])) file_put_contents($argv[2], json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
echo json_encode(['counts' => $snapshot['importCounts'], 'validation' => $snapshot['recipeValidation'], 'planValidation' => $snapshot['validation']], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
