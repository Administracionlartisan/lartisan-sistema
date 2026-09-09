# Organización del Panel central — 09/09/2026

Se reemplazó la lista plana de 28 botones por seis áreas, manteniendo todos los IDs, permisos, filtros, exportaciones y contenido de los informes. La reorganización no completa los informes que estaban pendientes ni corrige los cálculos históricos señalados en AUDITORIA_ORIENTADOR_REPORTES.md.

| Área | Informes |
| --- | --- |
| Dirección | Resumen ejecutivo, Gerencia, P&L consolidado, Evolución, Objetivos |
| Ventas | Ventas, Detalle de ventas, Productos, Rentabilidad, Horarios de venta, Promociones |
| Caja y cobros | Medios de pago, Vendido vs. cobrado, Cajas, Caja Mayor, Control bancario, Egresos |
| Stock y pedidos | Stock, Reposición, Pedidos a Central |
| Personas y clientes | Personal, Clientes |
| Control | Alertas operativas, Descuentos y anulaciones, Calidad de datos, Auditoría, Incidencias, Fiscal |

## Comportamiento

- Cambiar de área abre su primer informe autorizado. Al elegir otro informe, se destaca la selección y se conserva el contenido original.
- El área se obtiene del informe actual, sin guardar un estado paralelo. Por eso un enlace desde Ayuda abre automáticamente el área correspondiente.
- La lista de áreas, sus cantidades y sus tarjetas incluyen únicamente los informes entregados por el filtro existente de permisos. No se conceden accesos ni se modifica la autorización del servidor.
- Se mantienen las explicaciones al pasar el puntero y también se muestra una descripción visible. Los informes pendientes indican “En desarrollo”.
- En celular se selecciona el área con un desplegable y se muestran los informes en una columna. La navegación no aparece en la impresión.
- Las rutas de la guía incorporan el área entre “Panel central” y el nombre del reporte. El mapa de la auditoría del 08/09 era anterior a esta organización.
- No se agregan buscador, favoritos, almacenamiento, consultas de datos ni funciones operativas.

## Fuentes y comprobación

- Agrupación y rutas: app/data/reportGuide.ts.
- Menú: app/components/ReportNavigation.tsx; integración en app/page.tsx; estilos acotados en app/globals.css.
- Pruebas: tests/report-navigation.test.mjs. Comprueban cobertura completa, destinos, permisos, cambio desde Ayuda, selector móvil y estados vacíos; renderizado programático sin operaciones reales.
- Ejecutar junto con las pruebas de ayuda e íconos. No se realizó prueba visual en un dispositivo físico.
