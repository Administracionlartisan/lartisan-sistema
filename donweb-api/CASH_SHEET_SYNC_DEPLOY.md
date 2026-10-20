# Sincronización de cierres diarios con Google Apps Script

Al cerrar una caja, el sistema conserva primero el cierre comercial y después envía el resumen a la fila ya existente de la planilla diaria del local. Apps Script corre con la cuenta propietaria de las planillas, por lo que no requiere permisos de Google Cloud ni crear un cliente OAuth.

## Instalación única (la hace el dueño de las planillas)

1. Abrir [script.google.com](https://script.google.com/) con la cuenta propietaria de las cuatro planillas.
2. Crear un proyecto nuevo y pegar el contenido de `google-apps-script/LArtisanCashCloseSync.gs`.
3. En **Configuración del proyecto → Propiedades del script**, crear `LARTISAN_SYNC_SECRET` con una clave aleatoria de al menos 32 caracteres.
4. Elegir **Implementar → Nueva implementación → Aplicación web**. Configurar **Ejecutar como: Yo** y **Quién tiene acceso: Cualquier persona**. Autorizar el acceso a las planillas al publicar.
5. Copiar la URL final que termina en `/exec` y entregarla, junto con la clave creada, únicamente al administrador del servidor.
6. En el archivo privado `lartisan-cash-sheet-config.php` de Ferozo (fuera de `public_html`) completar `apps_script_url` y `apps_script_secret` con esos dos valores exactos.

Novo Pacheco permanece excluido: no se habilita ninguna escritura para ese local.

## Protecciones

- Firma HMAC SHA-256: la URL sola no permite generar cierres válidos.
- Idempotencia por `closeId`: reintentar no duplica la escritura.
- No agrega filas; exige una fila existente para la fecha.
- No reemplaza fórmulas ni valores distintos ya cargados.
- Los medios de pago se validan contra el encabezado específico de cada local.

## Prueba de aceptación

Con una caja de prueba, cerrar con importes pequeños y verificar que el cierre quede guardado en el sistema, que se actualice sólo la fila del día correcto y que un segundo intento responda que ya está sincronizado.
