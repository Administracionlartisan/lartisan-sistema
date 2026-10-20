<?php
require __DIR__ . '/../donweb-api/internal_chat.php';
function expect_chat($condition, $message) { if (!$condition) { fwrite(STDERR, $message . "\n"); exit(1); } }
$vendedora = ['id'=>1,'role'=>'vendedora'];
$supervisora = ['id'=>2,'role'=>'supervisora','active'=>1];
$administracion = ['id'=>3,'role'=>'administracion','active'=>1];
$otraVendedora = ['id'=>4,'role'=>'vendedora','active'=>1];
expect_chat(chat_can_contact($vendedora, $supervisora), 'vendedora-supervision debe estar permitida');
expect_chat(chat_can_contact($vendedora, $administracion), 'vendedora-administracion debe estar permitida');
expect_chat(!chat_can_contact($vendedora, $otraVendedora), 'vendedora-vendedora debe estar restringida');
expect_chat(!chat_can_contact($vendedora, ['id'=>5,'role'=>'supervisora','active'=>0]), 'usuarios inactivos deben estar restringidos');
$png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9AAAAAElFTkSuQmCC', true);
$file = chat_attachment_payload(['name'=>'prueba.png','mime'=>'image/png','data'=>'data:image/png;base64,' . base64_encode($png)]);
expect_chat($file['mime'] === 'image/png', 'png válido debe aceptarse');
try { chat_attachment_payload(['name'=>'camuflado.png','mime'=>'image/png','data'=>'data:image/png;base64,' . base64_encode('%PDF-')]); fwrite(STDERR, "archivo camuflado aceptado\n"); exit(1); } catch (InvalidArgumentException $ignored) {}
try { chat_attachment_payload(['name'=>'malicioso.exe','mime'=>'application/octet-stream','data'=>'data:application/octet-stream;base64,' . base64_encode('x')]); fwrite(STDERR, "tipo no permitido aceptado\n"); exit(1); } catch (InvalidArgumentException $ignored) {}
echo "chat isolated unit checks passed\n";
