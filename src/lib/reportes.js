// Hojas de Excel para el contador. Cada función recibe los datos tal como
// vienen de la base y devuelve una hoja para descargarExcel().
import { METODOS_PAGO, TURNOS, nombreEstado, unidadesDeVenta } from "../components/admin/ventasUtils";

const turno = (t) => TURNOS[t]?.corto ?? t ?? "";
const metodo = (m) => METODOS_PAGO[m]?.nombre ?? m ?? "";

export function hojaVentas(ventas, subtitulo) {
  return {
    nombre: "Ventas",
    titulo: "Ventas",
    subtitulo,
    columnas: [
      { titulo: "N° venta", clave: "numero", tipo: "entero", ancho: 10 },
      { titulo: "Fecha y hora", clave: "created_at", tipo: "fechaHora", ancho: 17 },
      { titulo: "Turno", valor: (v) => turno(v.turno), ancho: 11 },
      { titulo: "Origen", valor: (v) => (v.origen === "manual" ? "Local / caja" : "Web (WhatsApp)"), ancho: 15 },
      { titulo: "Cliente", clave: "cliente_nombre", ancho: 22 },
      { titulo: "Productos", ajustar: true, ancho: 48, valor: (v) => (v.venta_items ?? []).map((i) => `${i.cantidad} x ${i.nombre}${i.detalle ? ` (${i.detalle})` : ""}`).join("; ") },
      { titulo: "Unidades", clave: "unidades", tipo: "entero", ancho: 10, valor: (v) => unidadesDeVenta(v) },
      { titulo: "Estado", valor: (v) => (v.estado === "cerrado" ? "Cobrada" : nombreEstado(v)), ancho: 14 },
      { titulo: "Forma de pago", ancho: 30, valor: (v) => (v.pagos ?? []).map((p) => metodo(p.metodo) + (v.pagos.length > 1 ? ` ${Number(p.monto).toFixed(2)}` : "")).join(" + ") },
      { titulo: "Total", clave: "total", tipo: "moneda", ancho: 15 },
    ],
    filas: ventas,
    totales: ["total", "unidades"],
  };
}

export function hojaProductos(ventas, subtitulo) {
  const filas = [];
  for (const v of ventas) {
    for (const i of v.venta_items ?? []) {
      filas.push({ ...i, numero: v.numero, created_at: v.created_at, turno: v.turno });
    }
  }
  return {
    nombre: "Detalle de productos",
    titulo: "Detalle de productos vendidos",
    subtitulo,
    columnas: [
      { titulo: "Fecha y hora", clave: "created_at", tipo: "fechaHora", ancho: 17 },
      { titulo: "N° venta", clave: "numero", tipo: "entero", ancho: 10 },
      { titulo: "Turno", valor: (f) => turno(f.turno), ancho: 11 },
      { titulo: "Producto", clave: "nombre", ancho: 32 },
      { titulo: "Detalle", clave: "detalle", ancho: 32, ajustar: true },
      { titulo: "Cantidad", clave: "cantidad", tipo: "entero", ancho: 10 },
      { titulo: "Precio unitario", clave: "precio_unitario", tipo: "moneda", ancho: 15 },
      { titulo: "Subtotal", clave: "subtotal", tipo: "moneda", ancho: 15 },
    ],
    filas,
    totales: ["cantidad", "subtotal"],
  };
}

export function hojaCobros(pagos, subtitulo) {
  return {
    nombre: "Cobros",
    titulo: "Cobros (ingresos de dinero)",
    subtitulo,
    columnas: [
      { titulo: "Fecha y hora", clave: "created_at", tipo: "fechaHora", ancho: 17 },
      {
        titulo: "Concepto",
        ancho: 32,
        valor: (p) => (p.concepto === "cobro_cuenta" ? "Pago de cuenta corriente" : `Venta N° ${p.ventas?.numero ?? "—"}`),
      },
      { titulo: "Turno", valor: (p) => turno(p.ventas?.turno), ancho: 11 },
      { titulo: "Cliente", valor: (p) => p.clientes?.nombre ?? "", ancho: 22 },
      { titulo: "Forma de pago", valor: (p) => metodo(p.metodo), ancho: 18 },
      { titulo: "Arqueo N°", valor: (p) => p.cajas?.numero ?? "", tipo: "entero", ancho: 10 },
      { titulo: "Nota", clave: "nota", ancho: 24 },
      { titulo: "Importe", clave: "monto", tipo: "moneda", ancho: 15 },
    ],
    filas: pagos,
    totales: ["monto"],
    notas: [
      "Los pagos con forma \"Cuenta corriente\" son ventas fiadas: no entró dinero. Ese dinero ingresa cuando el cliente paga su cuenta (concepto \"Pago de cuenta corriente\").",
    ],
  };
}

export function hojaGastos(gastos, subtitulo) {
  return {
    nombre: "Gastos",
    titulo: "Gastos y costos",
    subtitulo,
    columnas: [
      { titulo: "Fecha", clave: "fecha", tipo: "fecha", ancho: 12 },
      { titulo: "Categoría", clave: "categoria", ancho: 26 },
      { titulo: "Tipo", valor: (g) => (g.tipo === "fijo" ? "Fijo" : "Variable"), ancho: 10 },
      { titulo: "Descripción", clave: "descripcion", ancho: 34, ajustar: true },
      { titulo: "Proveedor", clave: "proveedor", ancho: 22 },
      { titulo: "Comprobante", clave: "comprobante", ancho: 16 },
      { titulo: "Estado", valor: (g) => (g.estado === "pagado" ? "Pagado" : "Pendiente de pago"), ancho: 16 },
      { titulo: "Vencimiento", clave: "vencimiento", tipo: "fecha", ancho: 12 },
      { titulo: "Forma de pago", valor: (g) => (g.metodo === "tarjeta" ? "Tarjeta" : metodo(g.metodo)), ancho: 15 },
      { titulo: "Importe", clave: "monto", tipo: "moneda", ancho: 15 },
    ],
    filas: gastos,
    totales: ["monto"],
  };
}

export function hojaArqueos(cajas, subtitulo) {
  const r = (c, k) => c.resumen?.[k] ?? null;
  return {
    nombre: "Arqueos de caja",
    titulo: "Arqueos de caja",
    subtitulo,
    columnas: [
      { titulo: "N°", clave: "numero", tipo: "entero", ancho: 7 },
      { titulo: "Apertura", clave: "abierta_at", tipo: "fechaHora", ancho: 17 },
      { titulo: "Cierre", clave: "cerrada_at", tipo: "fechaHora", ancho: 17 },
      { titulo: "Turno", valor: (c) => turno(c.turno), ancho: 10 },
      { titulo: "Estado", valor: (c) => (c.estado === "cerrada" ? "Cerrado" : "Abierto"), ancho: 10 },
      { titulo: "Efectivo inicial", clave: "monto_inicial", tipo: "moneda", ancho: 15 },
      { titulo: "Ventas efectivo", clave: "ve", tipo: "moneda", ancho: 15, valor: (c) => r(c, "ventas_efectivo") },
      { titulo: "Ventas transferencia", clave: "vt", tipo: "moneda", ancho: 15, valor: (c) => r(c, "ventas_transferencia") },
      { titulo: "Ventas cta. cte.", clave: "vc", tipo: "moneda", ancho: 15, valor: (c) => r(c, "ventas_cuenta_corriente") },
      { titulo: "Cobros cta. cte. efectivo", clave: "ce", tipo: "moneda", ancho: 15, valor: (c) => r(c, "cobros_cuenta_efectivo") },
      { titulo: "Cobros cta. cte. transf.", clave: "ct", tipo: "moneda", ancho: 15, valor: (c) => r(c, "cobros_cuenta_transferencia") },
      { titulo: "Ingresos de efectivo", clave: "in", tipo: "moneda", ancho: 15, valor: (c) => r(c, "ingresos") },
      { titulo: "Retiros", clave: "re", tipo: "moneda", ancho: 15, valor: (c) => r(c, "retiros") },
      { titulo: "Gastos pagados con caja", clave: "ga", tipo: "moneda", ancho: 15, valor: (c) => r(c, "gastos_efectivo") },
      { titulo: "Efectivo esperado", clave: "es", tipo: "moneda", ancho: 15, valor: (c) => r(c, "efectivo_esperado") },
      { titulo: "Efectivo contado", clave: "efectivo_contado", tipo: "moneda", ancho: 15 },
      { titulo: "Diferencia", clave: "di", tipo: "moneda", ancho: 15, valor: (c) => r(c, "diferencia") },
      { titulo: "Abrió", clave: "abierta_por", ancho: 22 },
      { titulo: "Cerró", clave: "cerrada_por", ancho: 22 },
      { titulo: "Nota", clave: "nota", ancho: 26 },
    ],
    filas: cajas,
    totales: ["ve", "vt", "vc", "ce", "ct", "in", "re", "ga", "di"],
    notas: ["Diferencia = efectivo contado − efectivo esperado. Negativo: faltante. Positivo: sobrante."],
  };
}

export function hojaCuentas(clientes, subtitulo) {
  return {
    nombre: "Cuentas corrientes",
    titulo: "Cuentas corrientes de clientes",
    subtitulo,
    columnas: [
      { titulo: "Cliente", clave: "nombre", ancho: 26 },
      { titulo: "DNI / CUIT", clave: "documento", ancho: 15 },
      { titulo: "Teléfono", clave: "telefono", ancho: 16 },
      { titulo: "Límite de crédito", clave: "limite_credito", tipo: "moneda", ancho: 16 },
      { titulo: "Total fiado", clave: "total_cargado", tipo: "moneda", ancho: 16 },
      { titulo: "Total pagado", clave: "total_pagado", tipo: "moneda", ancho: 16 },
      { titulo: "Saldo adeudado", clave: "saldo", tipo: "moneda", ancho: 16 },
      { titulo: "Último movimiento", clave: "ultimo_movimiento", tipo: "fechaHora", ancho: 17 },
      { titulo: "Estado", valor: (c) => (c.activo ? "Activo" : "De baja"), ancho: 10 },
    ],
    filas: clientes,
    totales: ["total_cargado", "total_pagado", "saldo"],
  };
}

// movimientos: [{ fecha, concepto, debe, haber, saldo }]
export function hojaEstadoCuenta(cliente, movimientos) {
  return {
    nombre: "Estado de cuenta",
    titulo: `Estado de cuenta · ${cliente.nombre}`,
    subtitulo: [cliente.documento && `DNI/CUIT ${cliente.documento}`, cliente.telefono && `Tel. ${cliente.telefono}`]
      .filter(Boolean)
      .join(" · "),
    columnas: [
      { titulo: "Fecha y hora", clave: "fecha", tipo: "fechaHora", ancho: 17 },
      { titulo: "Concepto", clave: "concepto", ancho: 50, ajustar: true },
      { titulo: "Debe (fiado)", clave: "debe", tipo: "moneda", ancho: 16 },
      { titulo: "Haber (pagó)", clave: "haber", tipo: "moneda", ancho: 16 },
      { titulo: "Saldo", clave: "saldo", tipo: "moneda", ancho: 16 },
    ],
    filas: movimientos,
    totales: ["debe", "haber"],
  };
}

