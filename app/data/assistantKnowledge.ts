export type AssistantRole = "vendedora" | "supervisora" | "administracion";
export type AssistantTopic = { id: string; category: string; question: string; keywords: string[]; roles: AssistantRole[]; answers: [string, string, string] };

const ALL: AssistantRole[] = ["vendedora", "supervisora", "administracion"];
const MANAGEMENT: AssistantRole[] = ["supervisora", "administracion"];
const ADMIN: AssistantRole[] = ["administracion"];

export const assistantTopics: AssistantTopic[] = [
  { id:"first-login", category:"Acceso", question:"¿Cómo ingreso por primera vez?", keywords:["primer ingreso","primera vez","contraseña temporal","clave provisoria"], roles:ALL, answers:[
    "Ingresá con tu usuario y la contraseña temporal entregada por Administración. El sistema te pedirá crear una contraseña personal antes de continuar.",
    "Para el primer acceso usá el usuario asignado y la clave provisoria. Después elegí una contraseña nueva que solo vos conozcas.",
    "Tu primer inicio se hace con la clave temporal de Administración. Al entrar, reemplazala por tu contraseña definitiva y no la compartas."
  ]},
  { id:"forgot-password", category:"Acceso", question:"¿Qué hago si olvidé mi contraseña?", keywords:["olvide contraseña","olvidé clave","recuperar contraseña","no puedo ingresar"], roles:ALL, answers:[
    "En el acceso tocá “Olvidé mi contraseña”. La solicitud llegará a Administración para que genere una clave temporal.",
    "Pedí la recuperación desde el mismo acceso. Administración verá la alerta y te entregará una contraseña provisoria por un canal validado.",
    "No hace falta avisar por WhatsApp: usá “Olvidé mi contraseña”. Cuando Administración la restablezca, ingresá y cambiala."
  ]},
  { id:"location", category:"Acceso", question:"¿Cómo elijo el local donde voy a trabajar?", keywords:["elegir local","cambiar local","seleccionar sucursal","vender otro local"], roles:ALL, answers:[
    "Si tenés más de un local asignado, usá el selector del encabezado antes de operar. Ventas, caja y stock quedarán vinculados al local elegido.",
    "Abrí el selector superior y elegí la sucursal correcta antes de vender. Si no aparece, Administración debe agregarla a tus locales asignados.",
    "Confirmá siempre el local activo antes de abrir caja o registrar una venta para no cargarla en otra sucursal."
  ]},
  { id:"cash-overview", category:"Caja", question:"¿Cómo funciona la caja?", keywords:["como hago caja","cómo hago caja","usar caja","como uso caja","cómo uso caja","funciona caja","manejar caja"], roles:ALL, answers:[
    "El circuito es: elegí el local correcto, entrá en Caja, registrá el fondo inicial y abrila. Después podés cobrar ventas y cargar movimientos. Al terminar, hacé el cierre de turno o el cierre diario y contá el efectivo real.",
    "Para trabajar con Caja primero abrila con el dinero inicial. Durante el turno, las ventas en efectivo y los movimientos quedan registrados. Al finalizar, contá el efectivo, informá el sobre si corresponde y confirmá el cierre.",
    "Caja se usa en tres pasos: apertura con fondo inicial, operación de ventas y movimientos, y cierre con arqueo. Revisá siempre que el local activo y la responsable sean correctos antes de confirmar."
  ]},
  { id:"open-cash", category:"Caja", question:"¿Cómo hago la apertura de caja?", keywords:["abrir caja","abro caja","como abro caja","cómo abro caja","como abrir la caja","apertura caja","fondo inicial","arqueo inicial"], roles:ALL, answers:[
    "Entrá en Caja, elegí “Abrir caja”, declarás el fondo inicial contado y confirmás. Queda asociado a tu usuario, local y horario.",
    "Para comenzar el turno registrá la apertura con el efectivo inicial real. Revisá local y responsable antes de confirmar.",
    "La caja se inicia desde Apertura: cargá cuánto dinero físico recibís como fondo. Ese importe será la base del cierre."
  ]},
  { id:"close-shift", category:"Caja", question:"¿Cómo cierro mi turno?", keywords:["cerrar turno","cierre turno","cambio vendedora","terminar turno"], roles:ALL, answers:[
    "En Caja elegí “Cerrar turno”, contá el efectivo y registrá el sobre si corresponde. Deja la caja lista para el cambio de responsable sin cerrar todo el día.",
    "Cuando cambia la vendedora, hacé un cierre de turno: verificá cobros, efectivo contado y sobre. La siguiente responsable podrá iniciar con trazabilidad.",
    "Usá Cierre de turno al terminar tu horario. No es el cierre diario: identifica qué operó cada responsable durante el día."
  ]},
  { id:"cash-difference", category:"Caja", question:"¿Cómo se calcula la diferencia de caja?", keywords:["diferencia caja","efectivo esperado","efectivo contado","sobre efectivo"], roles:ALL, answers:[
    "La diferencia es efectivo contado menos esperado. Si esperabas $67.000, contaste $67.100 y separaste $60.000, la diferencia es $100 y quedan $7.100 en caja.",
    "Primero se compara contado contra esperado; después el sobre distribuye ese contado entre dinero entregado y saldo. El sobre no se suma dos veces.",
    "Fórmula: diferencia = contado − esperado. Saldo que queda = contado − sobre. Con $67.100, $67.000 y $60.000: diferencia $100 y saldo $7.100."
  ]},
  { id:"cash-movement", category:"Caja", question:"¿Cómo registro un egreso o ajuste de caja?", keywords:["egreso caja","ajuste caja","movimiento caja","retirar dinero","gasto caja"], roles:ALL, answers:[
    "Desde Caja agregá un movimiento, elegí el tipo correcto, ingresá importe y motivo y adjuntá comprobante cuando corresponda.",
    "Todo dinero que entra o sale fuera de una venta se registra como movimiento de caja, con concepto, monto y respaldo.",
    "Usá “Movimiento de caja” para egresos, ingresos o ajustes. El sistema conservará quién lo cargó, cuándo y por qué."
  ]},
  { id:"sale", category:"Ventas", question:"¿Cómo registro una venta?", keywords:["hacer venta","registrar venta","cobrar producto","nueva venta"], roles:ALL, answers:[
    "Elegí el local, verificá que la caja esté abierta, agregá productos y cantidades, seleccioná el medio de pago y confirmá el total.",
    "En Ventas seleccioná productos, controlá cantidades, descuento, cobro y cliente. Al confirmar se registra y descuenta el stock.",
    "Armá la venta desde el catálogo, elegí cómo se cobra y comprobá el resumen. La confirmación impacta en venta, caja y existencias."
  ]},
  { id:"cannot-charge", category:"Ventas", question:"¿Por qué no puedo cobrar una venta?", keywords:["no puedo cobrar","no me deja cobrar","no puedo hacer el cobro","boton cobrar bloqueado","botón cobrar bloqueado","abrir caja para cobrar","problema al cobrar","error al cobrar"], roles:ALL, answers:[
    "Primero revisá si la caja del local está abierta: cuando está cerrada, el botón dice “Abrí caja para cobrar”. Si ya está abierta, agregá al menos un producto y confirmá que el medio de pago complete exactamente el total.",
    "El cobro puede bloquearse por cuatro motivos: caja cerrada, venta sin productos, pago dividido que no suma el total o falta de permiso para cobrar. Revisá el mensaje que aparece en pantalla; indica cuál de esos puntos corregir.",
    "Verificá el local activo y abrí su caja. Luego controlá que haya productos en la venta, que el descuento no supere el límite y que los medios de pago coincidan con el total. Si sigue bloqueado, usá “Revisar qué está fallando”."
  ]},
  { id:"invitation", category:"Ventas", question:"¿Cómo envío solo una unidad de invitación?", keywords:["invitacion producto","invitación","producto gratis","una unidad gratis","precio cero"], roles:ALL, answers:[
    "En el producto indicá cuántas unidades serán invitación. Si cargaste 5 raviolones y marcás 1, se cobran 4 y las 5 salen del stock.",
    "La invitación se aplica por producto y cantidad, no a toda la venta. Seleccioná la línea, marcá 1 unidad y revisá el resumen.",
    "Cargá la cantidad total y luego la cantidad invitada de ese producto. La unidad gratis vale $0, pero igualmente descuenta inventario."
  ]},
  { id:"discount", category:"Ventas", question:"¿Cómo aplico un descuento?", keywords:["aplicar descuento","porcentaje descuento","descontar venta","limite descuento"], roles:ALL, answers:[
    "Ingresá el porcentaje en Descuento y revisá bruto, descuento y total. Si supera el límite del local requerirá autorización.",
    "El descuento general se calcula sobre los productos cobrados. Para regalar una unidad usá Invitación, no 100% sobre toda la venta.",
    "Usá Descuento (%) y comprobá el total final. Los límites configurados evitan superar lo autorizado para cada local."
  ]},
  { id:"payment", category:"Ventas", question:"¿Cómo elijo el medio de pago?", keywords:["medio de pago","efectivo tarjeta","mercado pago","forma de cobro"], roles:ALL, answers:[
    "Antes de confirmar elegí el medio de pago real. El sistema aplicará la tarifa correspondiente y enviará el cobro al control correcto.",
    "Seleccioná cómo pagó el cliente. No uses Efectivo si el dinero entró por banco, tarjeta o billetera.",
    "Revisá el medio de pago porque afecta conciliación, caja y reportes de vendido versus cobrado."
  ]},
  { id:"split-payment", category:"Ventas", question:"¿Puedo cobrar una venta con dos medios de pago?", keywords:["dos medios","pago dividido","pago mixto","parte efectivo","multiples pagos"], roles:ALL, answers:[
    "Sí. Elegí pago dividido, agregá cada medio y su importe, y verificá que la suma coincida con el total.",
    "Para un cobro mixto cargá una parte en cada medio. La suma debe completar exactamente la venta.",
    "Usá múltiples medios cuando el cliente combina, por ejemplo, efectivo y transferencia. Cada parte quedará separada para conciliación."
  ]},
  { id:"cancel-sale", category:"Ventas", question:"¿Cómo anulo una venta equivocada?", keywords:["anular venta","cancelar venta","venta equivocada","corregir venta"], roles:ALL, answers:[
    "Buscá la venta y usá Anular si tu rol lo permite. Indicá el motivo para revertir stock y cobro dejando auditoría.",
    "No borres una operación: anulala con motivo para que queden registrados tanto la venta como su reversión.",
    "La corrección se hace con anulación autorizada. Así se recupera stock, se ajusta el cobro y queda trazabilidad."
  ]},
  { id:"offline", category:"Contingencia", question:"¿Qué hago si se corta Internet?", keywords:["sin internet","se corta internet","offline","modo contingencia","sin conexion"], roles:ALL, answers:[
    "Si aparece Modo contingencia, podés registrar ventas en ese dispositivo. No cierres sesión ni borres el navegador; al volver Internet revisá la sincronización.",
    "Continuá solo si la aplicación quedó disponible sin conexión. Las operaciones se guardan localmente y se envían al recuperar Internet.",
    "Durante el corte usá el mismo equipo y conservá la pestaña. Al volver la conexión esperá la confirmación antes de cambiar de dispositivo."
  ]},
  { id:"mobile-products", category:"Productos", question:"¿Por qué no veo todos los productos en el celular?", keywords:["no veo productos","faltan productos celular","productos movil","filtro categoria"], roles:ALL, answers:[
    "Tocá “Todos” y revisá Mostrador/Online. Una categoría seleccionada muestra solo sus productos; también podés buscar.",
    "En el celular, confirmá canal y quitá el filtro de categoría. Si falta un producto, informá local y nombre a Administración.",
    "Volvé a “Todos”, confirmá local y canal; si no aparece, puede estar inactivo o sin precio para esa sucursal."
  ]},
  { id:"low-stock", category:"Stock", question:"¿Dónde veo los productos con stock bajo?", keywords:["stock bajo","poco stock","stock minimo","alerta stock"], roles:ALL, answers:[
    "Entrá en Stock o Alertas operativas. Se marca como bajo cuando la existencia llega al mínimo configurado para ese producto y local.",
    "La alerta aparece al alcanzar el stock mínimo. Desde allí podés revisar existencias y preparar el pedido sugerido.",
    "Stock bajo compara disponible con mínimo por sucursal. Si el mínimo es incorrecto, avisá a Supervisión o Administración."
  ]},
  { id:"suggested-order", category:"Pedidos", question:"¿Cómo funciona el pedido sugerido?", keywords:["pedido sugerido","sugerencia pedido","hacer pedido","reponer stock"], roles:ALL, answers:[
    "Compara stock actual, mínimo y deseado para proponer cantidades. Revisalas antes de enviar porque podés ajustarlas.",
    "La sugerencia calcula lo necesario para recuperar el nivel objetivo. Es una ayuda: el local valida antes de confirmar.",
    "Al preparar el pedido se muestran cantidades según existencias y mínimos. Corregí lo necesario y envialo a Central."
  ]},
  { id:"tasks", category:"Tareas", question:"¿Dónde veo lo que tengo pendiente?", keywords:["mis tareas","pendientes","bandeja tareas","que tengo que hacer","alertas operativas"], roles:ALL, answers:[
    "Abrí Tareas. Reúne lo que requiere tu rol: cerrar caja, recibir pedidos, aprobar ajustes, cargar comprobantes o atender recuperaciones.",
    "La bandeja ordena las acciones pendientes según tu usuario y local. Entrá a cada tarjeta para resolver el caso.",
    "Consultá Tareas al comenzar y terminar el turno. Solo verás pendientes relacionados con tus permisos y sucursales."
  ]},
  { id:"receive-order", category:"Pedidos", question:"¿Cómo gestiono un pedido que llegó a Central?", keywords:["recibir pedido","pedido central","confirmar pedido","pedido local"], roles:MANAGEMENT, answers:[
    "En Central de pedidos abrí la solicitud, revisá cantidades y disponibilidad, y confirmá la preparación. Podés marcar faltantes por producto.",
    "Seleccioná el pedido, verificá cada línea y registrá lo que Central puede entregar. Los faltantes deben informarse, no eliminarse.",
    "Desde Pedidos a Central tomá la solicitud, confirmá lo preparado y detallá faltantes o cambios para que el local vea el estado."
  ]},
  { id:"order-shortage", category:"Pedidos", question:"¿Cómo indico que falta un producto del pedido?", keywords:["faltante pedido","falta producto pedido","entrega parcial","sin disponibilidad"], roles:MANAGEMENT, answers:[
    "Dentro del pedido editá la cantidad entregable o marcá el producto como faltante, agregá una observación y confirmá la entrega parcial.",
    "Registrá el faltante en la línea antes de confirmar. El local verá qué recibió, qué quedó pendiente y quién lo informó.",
    "No borres lo solicitado: marcá la diferencia como faltante y explicá el motivo. El historial conservará pedido y entrega real."
  ]},
  { id:"stock-adjustment", category:"Stock", question:"¿Cómo apruebo un ajuste de stock?", keywords:["aprobar ajuste","ajuste stock","diferencia inventario","corregir stock"], roles:MANAGEMENT, answers:[
    "Revisá producto, local, cantidad, motivo y responsable. Al aprobar se crea un movimiento independiente en el historial.",
    "Compará conteo físico con sistema y verificá evidencia. El ajuste agrega una corrección auditable, no reemplaza movimientos.",
    "Aprobalo desde la tarea pendiente o Stock. Confirmá motivo y cantidad porque quedarán asociados a tu usuario."
  ]},
  { id:"supervisor-reports", category:"Reportes", question:"¿Qué reportes puede ver Supervisión?", keywords:["reportes supervisora","informes supervisor","ver ventas locales","reporte locales"], roles:MANAGEMENT, answers:[
    "Supervisión consulta ventas, cajas, stock, pedidos, incidencias y personal de sus locales, sin modificar configuración administrativa.",
    "Los informes permiten comparar locales asignados y detectar cierres, faltantes, pedidos o alertas pendientes.",
    "Desde Reportes, Supervisión ve el seguimiento de las sucursales habilitadas. El alcance depende de sus locales asignados."
  ]},
  { id:"attendance", category:"Personal", question:"¿Dónde reviso entradas y salidas del personal?", keywords:["asistencia","entrada salida","horarios personal","fichada"], roles:MANAGEMENT, answers:[
    "Entrá en Personal o Asistencia y filtrá por fecha, usuario y local. Verás entradas, salidas y registros incompletos.",
    "El control horario está en Asistencia. Podés revisar quién inició o terminó su jornada y detectar pendientes.",
    "Usá el reporte de Personal para consultar fichadas por sucursal y período. Las correcciones deben quedar justificadas."
  ]},
  { id:"create-user", category:"Usuarios", question:"¿Cómo creo un usuario y su clave temporal?", keywords:["crear usuario","nuevo usuario","clave temporal","contraseña provisoria"], roles:ADMIN, answers:[
    "En Usuarios elegí Nuevo usuario, completá nombre, acceso, rol y locales. Al guardar se muestra una contraseña temporal para copiar.",
    "Creá la persona en Administración > Usuarios y asignale solo permisos y locales necesarios. Copiá la clave provisoria al generarla.",
    "Cargá datos, rol y alcance. El sistema genera una clave temporal de 8 caracteres que se muestra para copiar una sola vez."
  ]},
  { id:"assign-locations", category:"Usuarios", question:"¿Cómo asigno uno, varios o todos los locales?", keywords:["asignar locales","varios locales","todos los locales","local asignado"], roles:ADMIN, answers:[
    "Al editar el usuario, seleccioná una o varias sucursales, o usá Todos. Guardá y pedile que vuelva a ingresar.",
    "Usuarios permite definir un local, una selección múltiple o todos. Elegí siempre el menor alcance necesario.",
    "Abrí el usuario y marcá las sucursales habilitadas. Supervisión puede tener varias; una vendedora normalmente solo la suya."
  ]},
  { id:"roles", category:"Usuarios", question:"¿Qué diferencia hay entre Vendedora, Supervisión y Administración?", keywords:["roles permisos","diferencia usuarios","vendedora supervisora administracion","accesos"], roles:ADMIN, answers:[
    "Vendedora opera su local; Supervisión controla locales asignados y puede vender; Administración/Gerencia configura y consulta toda la organización.",
    "Operación trabaja la sucursal, Supervisión coordina varias y Administración gestiona usuarios, límites, integraciones y reportes completos.",
    "Los permisos aumentan por responsabilidad: venta local, supervisión multi-local y administración global. Conviene habilitar solo lo necesario."
  ]},
  { id:"reset-request", category:"Usuarios", question:"¿Dónde llegan las solicitudes de recuperación?", keywords:["solicitud contraseña","notificacion recuperar","recuperacion pendiente","restablecer usuario"], roles:ADMIN, answers:[
    "Llegan a Administración > Tareas, en Recuperación de contraseñas. Desde allí generás la clave temporal y se muestra para copiar.",
    "La alerta aparece en Tareas administrativas. Abrí la solicitud, restablecé la clave y entregala por un canal validado.",
    "Revisá Tareas > Recuperación. Al generar la contraseña provisoria, copiala en ese momento y entregala de forma segura."
  ]},
  { id:"limits", category:"Configuración", question:"¿Cómo configuro los límites de cada local?", keywords:["configurar limites","maximo descuento","maximo egreso","diferencia caja permitida"], roles:ADMIN, answers:[
    "En Límites elegí el local y definí descuento máximo, egreso máximo y diferencia de caja permitida.",
    "Los topes se administran por sucursal desde Límites. Establecé valores razonables y revisalos cuando cambie la operación.",
    "Configurá cada máximo en Administración > Límites. Si se supera, se bloquea o deriva a aprobación según el circuito."
  ]},
  { id:"prices", category:"Configuración", question:"¿Cómo actualizo precios?", keywords:["cambiar precio","actualizar precios","lista precios","precio mostrador online"], roles:ADMIN, answers:[
    "En Precios buscá el producto, editá el valor del canal correspondiente y guardá. Verificá Mostrador y Online.",
    "Los precios se administran por producto y canal. Revisá valor anterior y nuevo; el cambio queda auditado.",
    "Abrí Administración > Precios, filtrá el artículo y modificá la lista necesaria. Confirmá luego en Ventas."
  ]},
  { id:"pnl", category:"Reportes", question:"¿Cómo sincronizo el P&L con Google Drive?", keywords:["sincronizar pnl","actualizar pnl","google sheets","drive consolidado","p&l"], roles:ADMIN, answers:[
    "En P&L consolidado usá Sincronizar con Drive. El sistema lee la hoja autorizada, actualiza datos y muestra la última sincronización.",
    "Abrí el P&L y ejecutá la sincronización. Si Google solicita permiso, usá la cuenta autorizada y aceptá lectura de la hoja.",
    "La actualización se inicia desde el reporte. Al terminar verificá período y totales; si falla, revisá Integraciones o Salud."
  ]},
  { id:"backups", category:"Protección", question:"¿Cómo funcionan los respaldos?", keywords:["backup","respaldo","copia drive","recuperar datos","dos veces semana"], roles:ADMIN, answers:[
    "Los respaldos están previstos dos veces por semana a las 21:00, con copia fuera del hosting en Drive. Revisá su estado en Protección de datos.",
    "Deben incluir base y archivos necesarios, guardarse también fuera de DonWeb y probarse periódicamente con una restauración controlada.",
    "Confirmá fecha, destino y resultado del último backup. Una copia es segura cuando puede restaurarse y no está solo en el mismo servidor."
  ]},
  { id:"health", category:"Protección", question:"¿Dónde reviso la salud del sistema?", keywords:["salud sistema","health check","chequeo tecnico","base no responde","espacio disponible"], roles:ADMIN, answers:[
    "Ejecutá Chequeo de salud en Integraciones o Protección. Revisa base, usuarios, backups, Drive, correo y espacio disponible.",
    "El chequeo reúne los componentes principales. Si algo aparece en rojo, abrí el detalle antes de tareas sensibles.",
    "Salud del sistema indica qué está bien, qué requiere atención y cuándo se hizo la última prueba."
  ]},
  { id:"audit", category:"Protección", question:"¿Dónde veo quién hizo un cambio?", keywords:["auditoria","quien cambio","historial cambios","registro inalterable"], roles:ADMIN, answers:[
    "En Auditoría filtrá por usuario, fecha, local y acción. Muestra qué se hizo y conserva el registro original.",
    "La trazabilidad está en Auditoría: podés seguir cambios de ventas, caja, stock, usuarios y configuración.",
    "Consultá Auditoría para identificar responsable, momento y detalle. Las correcciones generan nuevos eventos."
  ]},
  { id:"reports", category:"Reportes", question:"¿Qué información puedo obtener de los reportes?", keywords:["que reportes","informes disponibles","panel central","exportar reporte"], roles:ADMIN, answers:[
    "El Panel central reúne ventas, rentabilidad, productos, cobros, cajas, bancos, egresos, stock, pedidos, personal, auditoría y P&L.",
    "Cada botón explica su contenido al pasar el cursor. Filtrá por período y local para controlar operación y resultados.",
    "Los informes cubren gestión comercial, financiera, inventario y personal. Usá filtros para comparar sucursales."
  ]},
  { id:"google", category:"Integraciones", question:"¿Cómo reviso la conexión con Google?", keywords:["conexion google","drive desconectado","autorizar google","integraciones"], roles:ADMIN, answers:[
    "En Integraciones revisá Google. Si requiere autorización, conectá la cuenta administrativa y aceptá solo los permisos necesarios.",
    "La conexión de Drive se controla desde Integraciones. Podés verificarla o autorizarla otra vez si venció.",
    "Abrí Integraciones > Google. Si falla una sincronización, renová autorización y ejecutá el chequeo de salud."
  ]},
  { id:"upcoming", category:"Próximamente", question:"¿Qué significan MRP, Recetas y Legajos (Próximamente)?", keywords:["mrp","recetas proximamente","legajos proximamente","proximamente"], roles:ADMIN, answers:[
    "Son módulos futuros y aún no deben usarse operativamente. MRP planificará producción; Recetas, costos; y Legajos, personal.",
    "Próximamente indica que la sección es una maqueta sin circuito activo. No guarda procesos reales.",
    "MRP, Recetas y Legajos están reservados para próximas fases. Al entrar solo muestran el aviso y no modifican datos."
  ]},
  { id:"fiscal", category:"Integraciones", question:"¿Ya está activa la facturación electrónica con ARCA?", keywords:["arca","afip","facturacion electronica","cae","circuito fiscal"], roles:ADMIN, answers:[
    "El circuito fiscal quedó para la última etapa. Hasta configurar y validar ARCA, el sistema no emite comprobantes fiscales reales.",
    "La integración todavía requiere certificados y pruebas. Los comprobantes internos actuales no reemplazan un CAE validado.",
    "Se activará al final, después de probar ventas y cajas. Antes se verificarán emisor, punto de venta, certificados y notas de crédito."
  ]},
  { id:"free-help", category:"Ayuda", question:"¿Esta ayuda consume tokens o tiene costo?", keywords:["consume tokens","costo ia","ayuda gratis","usa api","inteligencia artificial"], roles:ALL, answers:[
    "No. Responde desde una guía interna y no llama a una API de inteligencia artificial, por lo que no consume tokens.",
    "La ayuda es gratuita: busca la consulta en un catálogo propio y alterna respuestas preparadas. No genera cargos de IA.",
    "No hay consumo de tokens. Las respuestas están guardadas en L’ARTISAN y los temas faltantes pueden enviarse a Administración."
  ]}
];

const STOP = new Set(["algo","como","con","cual","del","donde","esta","esto","hacer","hago","las","los","para","por","puedo","que","una"]);
export function normalizeAssistantText(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9ñ&%]+/g, " ").trim(); }
function tokens(value: string) { return normalizeAssistantText(value).split(" ").filter((word) => word.length > 2 && !STOP.has(word)); }
export function topicsForRole(role: AssistantRole) { return assistantTopics.filter((topic) => topic.roles.includes(role)); }
export function matchAssistantTopic(question: string, role: AssistantRole) {
  const normalized = normalizeAssistantText(question); const query = new Set(tokens(question)); let best: { topic: AssistantTopic; score: number } | null = null;
  for (const topic of topicsForRole(role)) {
    let score = normalized === normalizeAssistantText(topic.question) ? 100 : 0;
    for (const keyword of topic.keywords) { const key = normalizeAssistantText(keyword); if (normalized.includes(key)) score += 10 + tokens(keyword).length * 3; }
    const known = new Set(tokens(`${topic.question} ${topic.keywords.join(" ")}`)); for (const word of query) if (known.has(word)) score += word.length >= 7 ? 4 : 2;
    if (!best || score > best.score) best = { topic, score };
  }
  return best && best.score >= 6 ? best.topic : null;
}
export const fallbackAnswers: [string,string,string] = [
  "Todavía no tengo ese tema en mi guía. Podés enviarlo a Administración y así incorporamos la respuesta para la próxima vez.",
  "No encontré una respuesta suficientemente segura. Enviála a Administración desde aquí y quedará registrada en su bandeja.",
  "Ese caso aún no está documentado. Para no indicarte algo incorrecto, podés derivarlo a Administración."
];
