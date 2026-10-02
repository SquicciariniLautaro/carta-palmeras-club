import { claveDia, fechaInput, formatearFechaHora } from "../../lib/formato";

export const ESTADOS = {
  pendiente: { nombre: "Pendiente", clase: "bg-naranja/15 text-naranja" },
  confirmada: { nombre: "Confirmada", clase: "bg-queso/15 text-queso" },
  cancelada: { nombre: "Cancelada", clase: "bg-noche-3 text-crema-suave" },
};

export const RANGOS = [
  { id: "hoy", nombre: "Hoy" },
  { id: "7", nombre: "Últimos 7 días" },
  { id: "30", nombre: "Últimos 30 días" },
  { id: "personalizado", nombre: "Personalizado" },
];

function inicioDelDia(fecha) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d;
}

// "2026-10-02" → Date local a las 00:00
function desdeInput(texto) {
  const [a, m, d] = texto.split("-").map(Number);
  return new Date(a, m - 1, d);
}

// Devuelve { desde, hasta } (hasta exclusivo) o null si el rango es inválido
export function calcularRango(rango, desdeTexto, hastaTexto) {
  const hoy = inicioDelDia(new Date());
  const manana = new Date(hoy);
  manana.setDate(manana.getDate() + 1);

  if (rango === "hoy") return { desde: hoy, hasta: manana };
  if (rango === "7" || rango === "30") {
    const desde = new Date(hoy);
    desde.setDate(desde.getDate() - (Number(rango) - 1));
    return { desde, hasta: manana };
  }
  if (!desdeTexto || !hastaTexto) return null;
  const desde = desdeInput(desdeTexto);
  const hasta = desdeInput(hastaTexto);
  hasta.setDate(hasta.getDate() + 1);
  if (hasta <= desde) return null;
  return { desde, hasta };
}

export function hoyInput() {
  return fechaInput(new Date());
}

export function unidadesDeVenta(venta) {
  return (venta.venta_items ?? []).reduce((acc, i) => acc + i.cantidad, 0);
}

// Facturación (solo confirmadas) por día, incluyendo días sin ventas
export function facturacionPorDia(ventas, desde, hasta) {
  const totales = new Map();
  for (const v of ventas) {
    if (v.estado !== "confirmada") continue;
    const clave = claveDia(v.created_at);
    totales.set(clave, (totales.get(clave) ?? 0) + Number(v.total));
  }
  const dias = [];
  const cursor = new Date(desde);
  // Para rangos muy largos limitamos a 366 barras
  while (cursor < hasta && dias.length < 366) {
    const clave = claveDia(cursor);
    dias.push({ clave, fecha: new Date(cursor), total: totales.get(clave) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

// Las 5 comidas más vendidas (por unidades) entre las ventas confirmadas
export function masVendidas(ventas, limite = 5) {
  const porNombre = new Map();
  for (const v of ventas) {
    if (v.estado !== "confirmada") continue;
    for (const item of v.venta_items ?? []) {
      const clave = item.comida_id ?? `nombre:${item.nombre}`;
      const actual = porNombre.get(clave) ?? { nombre: item.nombre, unidades: 0, total: 0 };
      actual.unidades += item.cantidad;
      actual.total += Number(item.subtotal);
      porNombre.set(clave, actual);
    }
  }
  return [...porNombre.values()].sort((a, b) => b.unidades - a.unidades || b.total - a.total).slice(0, limite);
}

// CSV con ";" y coma decimal: se abre bien en Excel configurado en español
export function ventasACsv(ventas) {
  const celda = (valor) => {
    const texto = String(valor ?? "");
    return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const numero = (n) => Number(n).toFixed(2).replace(".", ",");
  const encabezado = ["Número", "Fecha", "Cliente", "Ítems", "Unidades", "Total", "Estado", "Origen", "Nota"];
  const filas = ventas.map((v) => [
    v.numero,
    formatearFechaHora(v.created_at),
    v.cliente_nombre ?? "",
    (v.venta_items ?? []).map((i) => `${i.cantidad}x ${i.nombre}`).join(", "),
    unidadesDeVenta(v),
    numero(v.total),
    ESTADOS[v.estado]?.nombre ?? v.estado,
    v.origen === "manual" ? "Manual" : "Web",
    v.nota ?? "",
  ]);
  return "﻿" + [encabezado, ...filas].map((f) => f.map(celda).join(";")).join("\r\n");
}

export function descargarArchivo(contenido, nombre, tipo = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
