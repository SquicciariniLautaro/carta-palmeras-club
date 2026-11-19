// Pruebas de la base: npm run probar-base
//
// Arma una base nueva con supabase/schema.sql, le corre encima todas las
// actualizaciones (dos veces: se tienen que poder repetir) y prueba las
// reglas del negocio como dueño, como empleado y como la carta online.
import { DUENO, EMPLEADO, actualizaciones, crearBase, herramientas, leerSql } from "./entorno.mjs";

const db = await crearBase();
const { q, uno, prueba, rechaza, igual, como, anonimo, resultado } = herramientas(db);
const J = JSON.stringify;

console.log("\nInstalación");
await prueba("schema.sql en una base nueva", () => db.exec(leerSql("schema.sql")));
for (const archivo of actualizaciones()) {
  await prueba(`${archivo} (dos veces)`, async () => {
    await db.exec(leerSql(archivo));
    await db.exec(leerSql(archivo));
  });
}
await prueba("schema.sql se puede volver a correr", () => db.exec(leerSql("schema.sql")));

await db.exec(`
  insert into auth.users values ('${DUENO.id}', '${DUENO.email}'), ('${EMPLEADO.id}', '${EMPLEADO.email}');
  insert into public.admins (user_id) values ('${DUENO.id}');
  insert into public.admins (user_id, rol) values ('${EMPLEADO.id}', 'empleado');
`);
const id = async (nombre) => (await uno("select id from comidas where nombre = $1", [nombre])).id;
const COCA = await id("Coca-Cola 500 ml");
const AGUA = await id("Agua mineral 500 ml");
const BURGUER = await id("Burguer Cheese");
const stock = async (comida) => (await uno("select stock from comidas where id = $1", [comida])).stock;
const venta = (items, pagos = null) =>
  uno("select registrar_venta_local($1::jsonb, 'noche', null, null, $2::jsonb) as r", [J(items), pagos && J(pagos)]).then((x) => x.r);
const EFECTIVO = [{ metodo: "efectivo", monto: null }];

// ---------------------------------------------------------------------------
console.log("\nRoles");
await prueba("mi_rol: dueño y empleado", async () => {
  igual(await como(DUENO, () => uno("select mi_rol() as r").then((x) => x.r)), "dueno", "dueño");
  igual(await como(EMPLEADO, () => uno("select mi_rol() as r").then((x) => x.r)), "empleado", "empleado");
});
await rechaza("el empleado no se puede hacer dueño", () => como(EMPLEADO, () => q("update admins set rol = 'dueno'")), "permission denied");
await rechaza("la carta no puede preguntar roles", () => anonimo(() => q("select mi_rol()")), "permission denied");

// ---------------------------------------------------------------------------
console.log("\nCaja (la abre el empleado)");
let caja;
await prueba("el empleado abre la caja", async () => {
  caja = (await como(EMPLEADO, () => uno("select abrir_caja(1000) as c"))).c.id;
});
await rechaza("el empleado no cambia el efectivo inicial", () =>
  como(EMPLEADO, () => q("update cajas set monto_inicial = 0 where id = $1", [caja])), "efectivo inicial");
await prueba("el empleado sí carga el conteo", () =>
  como(EMPLEADO, () => q(`update cajas set conteo = '{"1000": 1}' where id = $1`, [caja])));
let retiro;
await prueba("el empleado hace un retiro y queda su usuario", async () => {
  retiro = await como(EMPLEADO, () => uno("insert into caja_movimientos (caja_id, tipo, concepto, monto) values ($1, 'retiro', 'Hielo', 500) returning id, usuario", [caja]));
  igual(retiro.usuario, EMPLEADO.email, "usuario");
});
await rechaza("el empleado no borra el retiro", () => como(EMPLEADO, () => q("delete from caja_movimientos where id = $1", [retiro.id])), "Solo el dueño");
await rechaza("el empleado no borra arqueos", () => como(EMPLEADO, () => q("delete from cajas where id = $1", [caja])), "Solo el dueño");

// ---------------------------------------------------------------------------
console.log("\nStock");
await rechaza("nadie escribe el stock a mano (ni el dueño)", () =>
  como(DUENO, () => q("update comidas set stock = 99 where id = $1", [COCA])), "pestaña Stock");
await rechaza("el empleado no ajusta el stock", () => como(EMPLEADO, () => q("select ajustar_stock($1, 50)", [COCA])), "Solo el dueño");
await prueba("el dueño ajusta el stock (conteo)", async () => {
  await como(DUENO, () => q("select ajustar_stock($1, 5, 'Conteo inicial')", [COCA]));
  igual(await stock(COCA), 5, "stock");
});
await prueba("el empleado carga mercadería y suma", async () => {
  await como(EMPLEADO, () => q("select cargar_mercaderia($1::jsonb, 'Remito 123')", [J([{ comida_id: COCA, cantidad: 10 }, { comida_id: AGUA, cantidad: 6 }])]));
  igual(await stock(COCA), 15, "coca");
  igual(await stock(AGUA), 6, "agua (arrancaba sin cargar)");
  const m = await uno("select tipo, cantidad, stock_resultante, usuario, nota from stock_movimientos where comida_id = $1 order by id desc limit 1", [COCA]);
  igual(`${m.tipo} ${m.cantidad} ${m.stock_resultante} ${m.usuario} ${m.nota}`, `ingreso 10 15 ${EMPLEADO.email} Remito 123`, "movimiento");
});
await rechaza("no se carga mercadería de cocina", () =>
  como(EMPLEADO, () => q("select cargar_mercaderia($1::jsonb)", [J([{ comida_id: BURGUER, cantidad: 3 }])])), "kiosco");
let vLocal;
await prueba("vender descuenta y anota la venta en el historial", async () => {
  vLocal = await como(EMPLEADO, () => venta([{ comida_id: COCA, cantidad: 2 }, { comida_id: BURGUER, cantidad: 1, variante: "Doble" }]));
  igual(await stock(COCA), 13, "coca");
  const m = await uno("select tipo, cantidad, venta_numero from stock_movimientos where comida_id = $1 order by id desc limit 1", [COCA]);
  igual(`${m.tipo} ${m.cantidad} ${m.venta_numero}`, `venta -2 ${vLocal.numero}`, "movimiento");
});
await prueba("editar el pedido (2 → 1) devuelve 1", async () => {
  const items = await q("select id, comida_id from venta_items where venta_id = $1", [vLocal.id]);
  await como(EMPLEADO, () => q("select editar_venta($1, $2::jsonb)", [vLocal.id, J(items.map((i) => ({ id: i.id, cantidad: 1 })))]));
  igual(await stock(COCA), 14, "coca");
});
await prueba("cancelar el pedido abierto devuelve el stock", async () => {
  await como(EMPLEADO, () => q("update ventas set estado = 'cancelado' where id = $1", [vLocal.id]));
  igual(await stock(COCA), 15, "coca");
});
await rechaza("pedido web con más de lo que hay", () =>
  anonimo(() => q("select crear_pedido($1::jsonb, 'Ana', null, '3884131570')", [J([{ comida_id: AGUA, cantidad: 7 }])])), "stock suficiente");
await prueba("pedido web con lo justo deja 0 y la carta lo oculta", async () => {
  await anonimo(() => q("select crear_pedido($1::jsonb, 'Ana', null, '3884131570')", [J([{ comida_id: AGUA, cantidad: 6 }])]));
  igual(await stock(AGUA), 0, "agua");
  igual((await anonimo(() => q("select id from comidas where id = $1", [AGUA]))).length, 0, "visible en la carta");
  igual((await anonimo(() => q("select id from comidas where id = $1", [COCA]))).length, 1, "la coca sigue visible");
});
await prueba("en el local se puede vender de más (queda negativo)", async () => {
  await como(EMPLEADO, () => venta([{ comida_id: AGUA, cantidad: 2 }], EFECTIVO));
  igual(await stock(AGUA), -2, "agua");
});

// ---------------------------------------------------------------------------
console.log("\nPermisos del empleado en productos y ventas");
await prueba("sí cambia precios (y queda en la actividad)", () => como(EMPLEADO, () => q("update comidas set precio = 3100 where id = $1", [COCA])));
await prueba("sí marca que no hay", () => como(EMPLEADO, () => q("update comidas set activo = false where id = $1", [BURGUER])));
await prueba("…y vuelve a marcar que hay", () => como(EMPLEADO, () => q("update comidas set activo = true where id = $1", [BURGUER])));
await prueba("sí crea productos", () =>
  como(EMPLEADO, () => q("insert into comidas (nombre, precio, categoria_id) select 'Producto del empleado', 10, categoria_id from comidas where id = $1", [COCA])));
await rechaza("no borra productos", () => como(EMPLEADO, () => q("delete from comidas where nombre = 'Producto del empleado'")), "solo el dueño");
await rechaza("no toca categorías", () => como(EMPLEADO, () => q("update categorias set nombre = 'X' where nombre = 'Bebidas'")), "solo el dueño");
await rechaza("no toca horarios", () => como(EMPLEADO, () => q("update horarios set abierto = false")), "solo el dueño");
await rechaza("no arma el menú del día", () =>
  como(EMPLEADO, () => q("insert into menu_dia (fecha, comida_id) values (current_date, $1)", [BURGUER])), "solo el dueño");
await prueba("el dueño sí cambia precios", () => como(DUENO, () => q("update comidas set precio = 3200 where id = $1", [COCA])));

let cobrada;
await prueba("el empleado cobra una venta y queda quién cobró", async () => {
  cobrada = await como(EMPLEADO, () => venta([{ comida_id: BURGUER, cantidad: 1 }], EFECTIVO));
  igual((await uno("select usuario from pagos where venta_id = $1", [cobrada.id])).usuario, EMPLEADO.email, "usuario del cobro");
});
await rechaza("no borra una venta cobrada", () => como(EMPLEADO, () => q("delete from ventas where id = $1", [cobrada.id])), "solo el dueño");
await rechaza("no anula el cobro", () => como(EMPLEADO, () => q("select anular_cobro($1)", [cobrada.id])), "Solo el dueño");
await rechaza("no cambia el total de una venta a mano", async () => {
  const abierta = await como(EMPLEADO, () => venta([{ comida_id: BURGUER, cantidad: 1 }]));
  await como(EMPLEADO, () => q("update ventas set total = 1 where id = $1", [abierta.id]));
}, "solo podés cambiar el estado");
await rechaza("no agrega productos a una venta por fuera de las funciones", () =>
  como(EMPLEADO, () => q("insert into venta_items (venta_id, nombre, precio_unitario, cantidad, subtotal) values ($1, 'x', 0, 1, 0)", [cobrada.id])), "permission denied");
await prueba("el dueño sí anula el cobro", () => como(DUENO, () => q("select anular_cobro($1)", [cobrada.id])));

// ---------------------------------------------------------------------------
console.log("\nCuentas corrientes y gastos");
let cliente;
await prueba("el empleado crea una cuenta corriente", async () => {
  cliente = (await como(EMPLEADO, () => uno("insert into clientes (nombre) values ('Vecino') returning id"))).id;
});
await prueba("…y le corrige el teléfono", () => como(EMPLEADO, () => q("update clientes set telefono = '388111' where id = $1", [cliente])));
await rechaza("no le cambia el límite de crédito", () =>
  como(EMPLEADO, () => q("update clientes set limite_credito = 999999 where id = $1", [cliente])), "límite de crédito");
await rechaza("no la da de baja", () => como(EMPLEADO, () => q("update clientes set activo = false where id = $1", [cliente])), "límite de crédito");
await prueba("el dueño carga dos gastos (uno con la caja)", () =>
  como(DUENO, async () => {
    await q("insert into gastos (categoria, descripcion, monto, metodo, caja_id) values ('Insumos', 'Hielo', 2000, 'efectivo', $1)", [caja]);
    await q("insert into gastos (categoria, descripcion, monto, metodo) values ('Sueldos', 'Encargado', 500000, 'transferencia')");
  }));
await prueba("el empleado solo ve el gasto de la caja", async () => {
  const filas = await como(EMPLEADO, () => q("select descripcion from gastos"));
  igual(filas.map((f) => f.descripcion).join(","), "Hielo", "gastos visibles");
});
await rechaza("el empleado no carga gastos", () =>
  como(EMPLEADO, () => q("insert into gastos (categoria, descripcion, monto, metodo) values ('x', 'y', 1, 'efectivo')")), "row-level security");

// ---------------------------------------------------------------------------
console.log("\nCancha: precio, señas y cobro");
await rechaza("el empleado no fija el precio de la cancha", () =>
  como(EMPLEADO, () => q("insert into ajustes values ('cancha_precio_hora', 1)")), "solo el dueño");
await prueba("el dueño fija $30.000 la hora", () => como(DUENO, () => q("insert into ajustes values ('cancha_precio_hora', 30000)")));
const reservar = (usuario, fecha, desde, minutos, precio, cliente = "Los pibes") =>
  como(usuario, () =>
    uno("insert into cancha_turnos (fecha, desde, minutos, cliente_nombre, precio) values ($1, $2, $3, $4, $5) returning id",
      [fecha, desde, minutos, cliente, precio])).then((x) => x.id);
await rechaza("el empleado no reserva con otro precio", () => reservar(EMPLEADO, "2030-01-10", "20:00", 60, 25000), "lo define el dueño");
let turno;
await prueba("el empleado reserva al precio del dueño (1 h 30 = $45.000)", async () => {
  turno = await reservar(EMPLEADO, "2030-01-10", "20:00", 90, 45000);
});
await rechaza("se pisa con otro turno", () => reservar(EMPLEADO, "2030-01-10", "21:00", 60, 30000), "ya está reservada");
await prueba("el dueño puede hacer un precio especial", () => reservar(DUENO, "2030-01-10", "22:00", 60, 20000, "Amigos del club"));
await rechaza("la seña no puede ser todo", () =>
  como(EMPLEADO, () => q("select senar_turno_cancha($1, 45000, 'efectivo')", [turno])), "menor que lo que falta");
await prueba("el empleado cobra una seña de $10.000", async () => {
  const r = (await como(EMPLEADO, () => uno("select senar_turno_cancha($1, 10000, 'transferencia') as r", [turno]))).r;
  igual(r.resta, 35000, "resta");
  const resumen = (await como(EMPLEADO, () => uno("select resumen_caja($1) as r", [caja]))).r;
  igual(resumen.ventas_transferencia, 10000, "la seña entró en la caja");
});
await rechaza("no se borra un turno señado", () => como(DUENO, () => q("delete from cancha_turnos where id = $1", [turno])), "señado");
await prueba("al cobrar se cobra solo lo que falta", async () => {
  await como(EMPLEADO, () => q("select cobrar_turno_cancha($1, $2::jsonb)", [turno, J(EFECTIVO)]));
  const pagos = await q("select p.monto, p.nota from pagos p join cancha_turnos t on t.venta_id = p.venta_id where t.id = $1 order by p.created_at, p.monto", [turno]);
  igual(pagos.map((p) => `${Number(p.monto)}${p.nota ? ` ${p.nota}` : ""}`).sort().join(" + "), "10000 Seña + 35000", "pagos");
  igual((await uno("select v.estado from ventas v join cancha_turnos t on t.venta_id = v.id where t.id = $1", [turno])).estado, "cerrado", "estado");
});
let noVino;
await prueba("turno señado que no viene: lo cierra el dueño con la seña", async () => {
  noVino = await reservar(EMPLEADO, "2030-01-11", "19:00", 60, 30000, "Faltó");
  await como(EMPLEADO, () => q("select senar_turno_cancha($1, 5000, 'efectivo')", [noVino]));
  await como(DUENO, () => q("select cerrar_turno_con_sena($1)", [noVino]));
  const v = await uno("select v.estado, v.total from ventas v join cancha_turnos t on t.venta_id = v.id where t.id = $1", [noVino]);
  igual(`${v.estado} ${Number(v.total)}`, "cerrado 5000", "venta");
});
await rechaza("el empleado no cierra con la seña", async () => {
  const t = await reservar(EMPLEADO, "2030-01-12", "19:00", 60, 30000, "Otro");
  await como(EMPLEADO, () => q("select senar_turno_cancha($1, 5000, 'efectivo')", [t]));
  await como(EMPLEADO, () => q("select cerrar_turno_con_sena($1)", [t]));
}, "Solo el dueño");
await rechaza("el empleado no anula cobros de la cancha", () => como(EMPLEADO, () => q("select anular_cobro_cancha($1)", [turno])), "Solo el dueño");

// ---------------------------------------------------------------------------
console.log("\nCancha: turnos fijos");
const martes = (await uno("select (current_date + ((2 - extract(dow from current_date)::int + 7) % 7) + 7)::text as d")).d;
const martesSiguiente = (await uno("select ($1::date + 7)::text as d", [martes])).d;
let fijo;
await prueba("el empleado anota un turno fijo los martes 20:00", async () => {
  fijo = (await como(EMPLEADO, () => uno(
    "insert into cancha_fijos (dia_semana, desde, minutos, cliente_nombre, precio) values (2, '20:00', 60, 'Los del martes', 30000) returning id"))).id;
});
await rechaza("otro fijo no se le pisa", () =>
  como(EMPLEADO, () => q("insert into cancha_fijos (dia_semana, desde, minutos, cliente_nombre, precio) values (2, '20:30', 60, 'Otros', 30000)")), "turno fijo de Los del martes");
await prueba("el martes que viene aparece anotado (una sola vez)", async () => {
  igual((await como(EMPLEADO, () => uno("select preparar_turnos_fijos($1) as n", [martes]))).n, 1, "anotados");
  igual((await como(EMPLEADO, () => uno("select preparar_turnos_fijos($1) as n", [martes]))).n, 0, "segunda vez");
});
await rechaza("un turno suelto no se le pisa", () => reservar(EMPLEADO, martes, "20:00", 60, 30000, "Suelto"), "ya está reservada");
await prueba("en un día pasado no anota nada", async () => {
  igual((await como(EMPLEADO, () => uno("select preparar_turnos_fijos('2020-01-07') as n"))).n, 0, "anotados");
});
await prueba("liberar ese martes no lo vuelve a anotar", async () => {
  await como(EMPLEADO, () => q("delete from cancha_turnos where fijo_id = $1 and fecha = $2", [fijo, martes]));
  igual((await como(EMPLEADO, () => uno("select preparar_turnos_fijos($1) as n", [martes]))).n, 0, "anotados");
});
await prueba("si el dueño cambia el precio, se corrige en los días que vienen", async () => {
  await como(EMPLEADO, () => q("select preparar_turnos_fijos($1)", [martesSiguiente]));
  await como(DUENO, () => q("update cancha_fijos set precio = 25000 where id = $1", [fijo]));
  igual(Number((await uno("select precio from cancha_turnos where fijo_id = $1 and fecha = $2", [fijo, martesSiguiente])).precio), 25000, "precio");
});
await prueba("se señó y después se borró el fijo: el turno señado queda", async () => {
  const t = (await uno("select id from cancha_turnos where fijo_id = $1 and fecha = $2", [fijo, martesSiguiente])).id;
  await como(EMPLEADO, () => q("select senar_turno_cancha($1, 5000, 'efectivo')", [t]));
  await como(DUENO, () => q("delete from cancha_fijos where id = $1", [fijo]));
  igual((await q("select id from cancha_turnos where id = $1", [t])).length, 1, "turno señado");
});

// ---------------------------------------------------------------------------
console.log("\nRegistro de actividad");
await prueba("el empleado no ve el registro", async () => {
  igual((await como(EMPLEADO, () => q("select * from actividad"))).length, 0, "filas");
});
await rechaza("nadie lo puede borrar", () => como(DUENO, () => q("delete from actividad")), "permission denied");
await prueba("el dueño ve quién hizo cada cosa", async () => {
  const filas = await como(DUENO, () => q("select usuario, accion from actividad order by id"));
  const hay = (usuario, accion) => filas.some((f) => f.usuario === usuario && f.accion === accion);
  const faltan = [
    [EMPLEADO.email, "Abrió la caja"],
    [EMPLEADO.email, "Retiro de efectivo"],
    [DUENO.email, "Ajustó el stock"],
    [EMPLEADO.email, "Cargó mercadería"],
    [EMPLEADO.email, "Venta en caja"],
    [EMPLEADO.email, "Editó un pedido"],
    [EMPLEADO.email, "Canceló un pedido"],
    [null, "Pedido web"],
    [EMPLEADO.email, "Cobró"],
    [EMPLEADO.email, "Marcó que no hay"],
    [DUENO.email, "Cambió el precio"],
    [DUENO.email, "Anuló un cobro"],
    [EMPLEADO.email, "Creó una cuenta corriente"],
    [DUENO.email, "Cargó un gasto"],
    [DUENO.email, "Cambió el precio de la cancha"],
    [EMPLEADO.email, "Reservó un turno"],
    [EMPLEADO.email, "Cobró una seña"],
    [DUENO.email, "Cerró un turno con la seña (no vino)"],
    [EMPLEADO.email, "Anotó un turno fijo"],
    [EMPLEADO.email, "Liberó un turno fijo"],
    [DUENO.email, "Borró un turno fijo"],
  ].filter(([u, a]) => !hay(u, a));
  if (faltan.length) throw new Error("faltan: " + faltan.map(([u, a]) => `${a} (${u ?? "carta"})`).join(", "));
});

// ---------------------------------------------------------------------------
console.log("\nPlatos del mediodía");
const POLLO_LIMON = await id("Pollo al limón");
await prueba("los 44 platos en 5 categorías quedan a $ 7.500 y disponibles", async () => {
  const filas = await q(`select c.nombre, count(*)::int as n, bool_and(m.precio = 7500 and m.activo and m.turno = 'mediodia') as ok
                           from comidas m join categorias c on c.id = m.categoria_id
                          where c.turno = 'mediodia' and not c.controla_stock group by c.nombre`);
  const por = Object.fromEntries(filas.map((f) => [f.nombre, f.n]));
  igual(J(por), J({ ...por, Pollo: 10, Carnes: 12, "Guisos y estofados": 5, Pastas: 9, "Al horno y rellenos": 8 }), "platos por categoría");
  igual(filas.every((f) => f.ok), true, "a $ 7.500 y disponibles");
});
await prueba("la carga y el cambio de precio no anotan una línea por plato en la actividad", async () => {
  igual((await uno("select count(*)::int as n from actividad where accion in ('Creó un producto', 'Cambió el precio') and detalle like 'Pollo al limón%'")).n, 0, "líneas");
  igual((await uno("select count(*)::int as n from actividad where accion = 'Puso $ 7.500 a los platos del mediodía'")).n, 1, "una sola vez");
});
await prueba("volver a correr la actualización no pisa los precios", async () => {
  await como(DUENO, () => q("update comidas set precio = 9000 where id = $1", [POLLO_LIMON]));
  const archivo = actualizaciones().find((a) => a.includes("cuentas-cancha-regalos"));
  await db.exec(leerSql(archivo));
  igual(Number((await uno("select precio from comidas where id = $1", [POLLO_LIMON])).precio), 9000, "precio");
  igual((await uno("select detalle from actividad where accion = 'Cambió el precio' order by id desc limit 1")).detalle, "Pollo al limón · $ 7500.00 → $ 9000.00", "actividad");
});
let SIN_PRECIO;
await prueba("un plato nuevo se puede cargar sin precio (no disponible)", async () => {
  SIN_PRECIO = (await como(DUENO, () =>
    uno("insert into comidas (nombre, precio, activo, categoria_id) select 'Plato a definir', null, false, categoria_id from comidas where id = $1 returning id", [POLLO_LIMON]))).id;
});
await rechaza("el empleado no lo puede marcar disponible sin precio", () =>
  como(EMPLEADO, () => q("update comidas set activo = true where id = $1", [SIN_PRECIO])), "comidas_precio_activo_check");
await rechaza("no se puede vender sin precio", () =>
  como(EMPLEADO, () => uno("select registrar_venta_local($1::jsonb, 'mediodia', null, null, null) as r", [J([{ comida_id: SIN_PRECIO, cantidad: 1 }])])), "precio_unitario");

// ---------------------------------------------------------------------------
console.log("\nCuentas abiertas (mesas y barra) y regalos");
const totalDe = async (venta) => Number((await uno("select total from ventas where id = $1", [venta])).total);
const lineas = (venta) => q("select nombre, cantidad, precio_unitario::float as precio, subtotal::float as subtotal, regalo, precio_lista::float as lista, detalle from venta_items where venta_id = $1 order by nombre, regalo", [venta]);
let mesa;
await prueba("una venta en caja sin cobrar queda como cuenta abierta (fuera del tablero)", async () => {
  mesa = (await como(EMPLEADO, () => uno("select registrar_venta_local($1::jsonb, 'noche', 'Mesa 4', null, null) as r", [J([{ comida_id: COCA, cantidad: 2 }])]))).r;
  const v = await uno("select es_cuenta, estado from ventas where id = $1", [mesa.id]);
  igual(`${v.es_cuenta} ${v.estado}`, "true entregado", "cuenta");
});
await prueba("sumar a la cuenta junta las líneas iguales y descuenta el stock una vez", async () => {
  const antes = await stock(COCA);
  await como(EMPLEADO, () => q("select sumar_a_cuenta($1, $2::jsonb)", [mesa.id, J([{ comida_id: COCA, cantidad: 3 }, { comida_id: BURGUER, cantidad: 1 }])]));
  igual(await stock(COCA), antes - 3, "stock");
  const l = await lineas(mesa.id);
  igual(l.filter((x) => x.nombre === "Coca-Cola 500 ml").map((x) => x.cantidad).join(","), "5", "una sola línea de coca");
  igual(await totalDe(mesa.id), 5 * 3200 + 7500, "total");
  igual((await q("select cantidad from stock_movimientos where comida_id = $1 order by id desc limit 1", [COCA]))[0].cantidad, -3, "un solo movimiento");
});
await prueba("un regalo va a $ 0, descuenta stock y guarda lo que vale", async () => {
  const antes = await stock(COCA);
  await como(EMPLEADO, () => q("select sumar_a_cuenta($1, $2::jsonb)", [mesa.id, J([{ comida_id: COCA, cantidad: 1, regalo: true, aclaracion: "de la casa" }])]));
  igual(await stock(COCA), antes - 1, "stock");
  const r = (await lineas(mesa.id)).find((x) => x.regalo);
  igual(`${r.precio} ${r.subtotal} ${r.lista} ${r.detalle}`, `0 0 3200 Regalo · "de la casa"`, "línea");
  igual(await totalDe(mesa.id), 5 * 3200 + 7500, "el total no cambia");
  const a = await uno("select usuario, detalle, monto from actividad where accion = 'Anotó un regalo' order by id desc limit 1");
  igual(`${a.usuario} ${Number(a.monto)}`, `${EMPLEADO.email} 3200`, "actividad");
});
await rechaza("la carta online no puede pedir regalos", () =>
  anonimo(() => q("select crear_pedido($1::jsonb, 'Ana', null, '3884131570')", [J([{ comida_id: COCA, cantidad: 1, regalo: true }])])), "datos inválidos");
await prueba("se cobra la cuenta y deja de estar abierta", async () => {
  await como(EMPLEADO, () => q("select cobrar_venta($1, $2::jsonb)", [mesa.id, J(EFECTIVO)]));
  igual((await uno("select estado from ventas where id = $1", [mesa.id])).estado, "cerrado", "estado");
});
await rechaza("a una cuenta cobrada no se le suma", () =>
  como(EMPLEADO, () => q("select sumar_a_cuenta($1, $2::jsonb)", [mesa.id, J([{ comida_id: COCA, cantidad: 1 }])])), "ya está cobrada");
let soloRegalo;
await prueba("un regalo suelto (sin cuenta) se cierra en $ 0 sin cobro", async () => {
  soloRegalo = (await como(EMPLEADO, () => uno("select registrar_venta_local($1::jsonb, 'noche', 'Regalo', null, '[]'::jsonb) as r", [J([{ comida_id: COCA, cantidad: 2, regalo: true }])]))).r;
  igual(`${soloRegalo.estado} ${Number(soloRegalo.total)}`, "cerrado 0", "venta");
});
await rechaza("el empleado no borra un regalo ya cerrado", () => como(EMPLEADO, () => q("delete from ventas where id = $1", [soloRegalo.id])), "solo el dueño");
await rechaza("…ni lo reabre", () => como(EMPLEADO, () => q("update ventas set estado = 'entregado' where id = $1", [soloRegalo.id])), "solo el dueño");
await rechaza("una cuenta con algo para cobrar no se cierra sin cobro", () =>
  como(EMPLEADO, () => uno("select registrar_venta_local($1::jsonb, 'noche', null, null, '[]'::jsonb) as r", [J([{ comida_id: COCA, cantidad: 1 }])])), "Indicá cómo se pagó");

// ---------------------------------------------------------------------------
console.log("\nCancha: consumos en la cuenta del turno");
let tc;
const ventaTurno = async (t) => (await uno("select venta_id from cancha_turnos where id = $1", [t])).venta_id;
await prueba("se suman bebidas y una cerveza de regalo al turno", async () => {
  tc = await reservar(EMPLEADO, "2030-02-01", "20:00", 60, 30000, "Los del viernes");
  await como(EMPLEADO, () => q("select sumar_a_turno_cancha($1, $2::jsonb)", [tc, J([{ comida_id: AGUA, cantidad: 4 }, { comida_id: COCA, cantidad: 1, regalo: true, aclaracion: "con el alquiler" }])]));
  const v = await ventaTurno(tc);
  igual(await totalDe(v), 30000 + 4 * 2000, "alquiler + consumos");
  igual((await lineas(v)).map((x) => `${x.cantidad}x ${x.nombre}${x.regalo ? " (regalo)" : ""}`).join(", "),
    "4x Agua mineral 500 ml, 1x Alquiler de cancha, 1x Coca-Cola 500 ml (regalo)", "cuenta");
});
await rechaza("el alquiler no se saca desde la cuenta", async () => {
  const v = await ventaTurno(tc);
  const items = await q("select id, cantidad from venta_items where venta_id = $1 and comida_id is not null", [v]);
  await como(EMPLEADO, () => q("select editar_venta($1, $2::jsonb)", [v, J(items)]));
}, "alquiler de la cancha");
await prueba("la seña tiene en cuenta los consumos", async () => {
  const r = (await como(EMPLEADO, () => uno("select senar_turno_cancha($1, 10000, 'efectivo') as r", [tc]))).r;
  igual(r.resta, 28000, "resta");
});
await rechaza("no se cierra con la seña si tiene consumos", () => como(DUENO, () => q("select cerrar_turno_con_sena($1)", [tc])), "consumos");
await prueba("al cobrar se cobra todo junto (menos la seña)", async () => {
  await como(EMPLEADO, () => q("select cobrar_turno_cancha($1, $2::jsonb)", [tc, J(EFECTIVO)]));
  const pagos = await q("select monto::float as m from pagos where venta_id = $1 order by monto", [await ventaTurno(tc)]);
  igual(pagos.map((p) => p.m).join(" + "), "10000 + 28000", "pagos");
});
await rechaza("a un turno cobrado no se le suman consumos", () =>
  como(EMPLEADO, () => q("select sumar_a_turno_cancha($1, $2::jsonb)", [tc, J([{ comida_id: AGUA, cantidad: 1 }])])), "ya está cobrado");
await prueba("anular el cobro deja la cuenta con sus consumos, abierta", async () => {
  const v = await ventaTurno(tc);
  await como(DUENO, () => q("select anular_cobro_cancha($1)", [tc]));
  const x = await uno("select estado, total from ventas where id = $1", [v]);
  igual(`${x.estado} ${Number(x.total)}`, "entregado 38000", "venta");
  igual((await uno("select count(*)::int as n from pagos where venta_id = $1", [v])).n, 0, "pagos");
});
await prueba("sacar todos los consumos borra la cuenta y el turno queda reservado", async () => {
  const v = await ventaTurno(tc);
  const alquiler = await q("select id, cantidad from venta_items where venta_id = $1 and comida_id is null", [v]);
  const agua = await stock(AGUA);
  await como(EMPLEADO, () => q("select editar_venta($1, $2::jsonb)", [v, J(alquiler)]));
  igual(await ventaTurno(tc), null, "venta del turno");
  igual(await stock(AGUA), agua + 4, "el agua vuelve al stock");
  await como(EMPLEADO, () => q("delete from cancha_turnos where id = $1", [tc]));
});

const { fallas, total } = resultado();
console.log(fallas ? `\n${fallas} de ${total} pruebas fallaron\n` : `\nLas ${total} pruebas dieron bien\n`);
process.exit(fallas ? 1 : 0);
