import { claveDia, fechaInput, formatearFechaHora, precioFinal } from "../../lib/formato";
import { opcionesDe } from "../../lib/opciones";

// Recorrido de un pedido: pendiente → en preparación → enviado → entregado → cerrado.
// "Cerrado" = entregado y cobrado: solo los cerrados cuentan en la facturación.
export const ESTADOS = {
  pendiente: { nombre: "Pendiente", clase: "bg-brasa/15 text-brasa border-brasa/40" },
  en_preparacion: { nombre: "En preparación", clase: "bg-amber-100 text-amber-900 border-amber-300" },
  enviado: { nombre: "Enviado", clase: "bg-sky-100 text-sky-900 border-sky-300" },
  entregado: { nombre: "Entregado", clase: "bg-violet-100 text-violet-900 border-violet-300" },
  cerrado: { nombre: "Cerrado", clase: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  cancelado: { nombre: "Cancelado", clase: "bg-borde text-tinta-suave border-borde" },
};

// Pedidos que todavía falta cerrar (se muestran arriba de todo en Ventas)
export const ESTADOS_ABIERTOS = ["pendiente", "en_preparacion", "enviado", "entregado"];

export function estaAbierto(venta) {
  return ESTADOS_ABIERTOS.includes(venta.estado);
}

// Una entrada por comida, o una por variante si la comida las tiene (Simple, Doble…).
// La usan la venta manual y la edición de pedidos.
export function entradasDeComidas(comidas) {
  const lista = [];
  for (const c of [...comidas].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))) {
    const { variantes } = opcionesDe(c);
    if (variantes.length === 0) {
      lista.push({ valor: c.id, comida: c, variante: null, nombre: c.nombre, precio: precioFinal(c) });
    } else {
      for (const v of variantes) {
        lista.push({
          valor: `${c.id}|${v.nombre}`,
          comida: c,
          variante: v.nombre,
          nombre: `${c.nombre} · ${v.nombre}`,
          precio: v.precio,
        });
      }
    }
  }
  return lista;
}

// "hace 5 min", "hace 2 h 10 min"
export function tiempoDesde(iso, ahora) {
  const minutos = Math.max(0, Math.floor((ahora - new Date(iso).getTime()) / 60000));
  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h${minutos % 60 ? ` ${minutos % 60} min` : ""}`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} día${dias === 1 ? "" : "s"}`;
}

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

// Facturación (solo pedidos cerrados) por día, incluyendo días sin ventas
export function facturacionPorDia(ventas, desde, hasta) {
  const totales = new Map();
  for (const v of ventas) {
    if (v.estado !== "cerrado") continue;
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

// Las 5 comidas más vendidas (por unidades) entre los pedidos cerrados
export function masVendidas(ventas, limite = 5) {
  const porNombre = new Map();
  for (const v of ventas) {
    if (v.estado !== "cerrado") continue;
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
    (v.venta_items ?? []).map((i) => `${i.cantidad}x ${i.nombre}${i.detalle ? ` (${i.detalle})` : ""}`).join(", "),
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
