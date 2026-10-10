<?php

declare(strict_types=1);

/** Capacitación versionada: el contenido es independiente de las operaciones. */
function ensure_training_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS training_chapters (
        id VARCHAR(64) PRIMARY KEY, title VARCHAR(160) NOT NULL, description TEXT NOT NULL,
        role_targets TEXT NOT NULL, version_label VARCHAR(40) NOT NULL, duration_seconds INT NOT NULL DEFAULT 0,
        script_text MEDIUMTEXT NOT NULL, video_url VARCHAR(500) NULL, captions_vtt MEDIUMTEXT NULL,
        sort_order INT NOT NULL, published TINYINT(1) NOT NULL DEFAULT 0, mandatory TINYINT(1) NOT NULL DEFAULT 0,
        created_by INT NULL, updated_by INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_training_published (published, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS training_chapter_versions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, chapter_id VARCHAR(64) NOT NULL, version_label VARCHAR(40) NOT NULL,
        snapshot_json MEDIUMTEXT NOT NULL, changed_by INT NULL, change_kind VARCHAR(30) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_training_versions (chapter_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS training_progress (
        user_id INT NOT NULL, chapter_id VARCHAR(64) NOT NULL, watched_seconds INT NOT NULL DEFAULT 0,
        completed_at DATETIME NULL, last_viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, chapter_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $count = (int) $pdo->query('SELECT COUNT(*) FROM training_chapters')->fetchColumn();
    if ($count > 0) return;
    $chapters = [
        ['introduccion-navegacion','Introducción y navegación','Ingreso seguro, menú, local asignado y secciones principales.',300],
        ['apertura-caja','Apertura y gestión de caja','Responsable, fondo inicial, turno y restricciones.',360],
        ['ventas-medios-pago','Ventas, productos y medios de pago','Productos, stock, cliente, cobro, descuentos y comprobantes.',480],
        ['clientes','Clientes','Búsqueda, alta, edición, asociación e historial.',300],
        ['stock-pedidos-devoluciones','Stock, pedidos, recepción y devoluciones','Movimientos, pedidos, transferencias, recepción y devoluciones.',420],
        ['egresos-incidencias','Egresos e incidencias','Registro, permisos, evidencia y trazabilidad.',270],
        ['fichaje','Fichaje','Entrada, salida, geocerca y solicitudes de excepción.',300],
        ['chat-interno','Chat Interno','Conversaciones autorizadas, grupos, adjuntos y avisos.',240],
        ['cierre-sincronizacion','Cierre de caja y situaciones especiales','Arqueo, sincronización, pendientes, anulaciones y qué no hacer.',480],
    ];
    $insert = $pdo->prepare('INSERT INTO training_chapters (id,title,description,role_targets,version_label,duration_seconds,script_text,sort_order,published,mandatory) VALUES (?,?,?,?,?,?,?,?,1,1)');
    foreach ($chapters as $index => $chapter) {
        $script = "Capacitación L’ARTISAN — {$chapter[1]}. Esta demostración utiliza exclusivamente datos de prueba. Seguí los pasos indicados en pantalla y, ante una diferencia o error, no repitas la operación: avisá a Supervisión o Administración.";
        $insert->execute([$chapter[0],$chapter[1],$chapter[2],json_encode(['vendedora','supervisora','administracion'],JSON_UNESCAPED_UNICODE),'1.0',$chapter[3],$script,$index + 1]);
    }
}

function training_roles(array $raw): array {
    $valid = ['vendedora','supervisora','compras','administracion'];
    return array_values(array_unique(array_filter($raw, static fn($role): bool => is_string($role) && in_array($role,$valid,true))));
}
function training_chapter_payload(array $row, ?array $progress = null): array {
    return ['id'=>$row['id'],'title'=>$row['title'],'description'=>$row['description'], 'roles'=>json_decode((string)$row['role_targets'],true) ?: [], 'version'=>$row['version_label'], 'durationSeconds'=>(int)$row['duration_seconds'], 'script'=>$row['script_text'], 'videoUrl'=>$row['video_url'], 'captionsVtt'=>$row['captions_vtt'], 'order'=>(int)$row['sort_order'], 'published'=>(bool)$row['published'], 'mandatory'=>(bool)$row['mandatory'], 'updatedAt'=>$row['updated_at'], 'progress'=>$progress ? ['watchedSeconds'=>(int)$progress['watched_seconds'],'completedAt'=>$progress['completed_at']] : null];
}
function training_audit(PDO $pdo, int $userId, string $event, string $chapter): void { audit($pdo,$userId,'training_'.$event,'chapter='.$chapter); }
