<?php
declare(strict_types=1);
// Solo ejecutar con la base descartable de dev/config.dev.php.
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../donweb-api/bootstrap.php';
require_once __DIR__ . '/../donweb-api/arca_fiscal_queue.php';
$pdo = new PDO('mysql:host=127.0.0.1;port=3313;dbname=lartisan_dev;charset=utf8mb4', 'lartisan_dev', 'dev-local-only', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$old = ['id' => 'test-sale', 'invoiceType' => 'Ticket', 'customer' => 'Cliente de prueba'];
$new = $old + ['customerDocumentType' => 'CUIT', 'customerDocumentNumber' => '20123456789', 'customerTaxCondition' => 'Responsable Inscripto', 'customerAddress' => 'Calle ficticia 123'];
$new['invoiceType'] = 'Factura A';
[$rejected, $findings] = enforce_invoice_type_changes($pdo, ['role' => 'personal', 'action_permissions' => '[]'], ['sales' => [$old]], ['sales' => [$new]]);
if (($rejected['sales'][0]['invoiceType'] ?? '') !== 'Ticket' || ($rejected['sales'][0]['customerDocumentNumber'] ?? null) !== null || !$findings) throw new RuntimeException('La corrección sin permiso no fue revertida.');
[$accepted, $findings] = enforce_invoice_type_changes($pdo, ['role' => 'administracion'], ['sales' => [$old]], ['sales' => [$new]]);
if (($accepted['sales'][0]['customerDocumentNumber'] ?? '') !== '20123456789' || $findings) throw new RuntimeException('La corrección autorizada no fue conservada.');
$customer = arca_fiscal_customer(['customer_name' => 'Cliente de prueba SA', 'customer_document_type' => 'CUIT', 'customer_document_number' => '20123456789', 'customer_tax_condition' => 'Responsable Inscripto', 'customer_address' => 'Calle ficticia 123'], [], 1);
if ($customer['number'] !== '20123456789') throw new RuntimeException('Datos fiscales incorrectos.');
try { arca_fiscal_customer([], ['legalName' => 'Cliente de prueba SA', 'documentType' => 'CUIT', 'documentNumber' => '123', 'taxCondition' => 'Responsable Inscripto', 'address' => 'Calle ficticia 123'], 1); throw new RuntimeException('Se aceptó un CUIT incompleto.'); } catch (InvalidArgumentException $expected) {}
echo "OK: permisos, conservación de datos y validación fiscal A. No se emitió ningún comprobante.\n";
