import { claveDia, fechaInput, precioFinal } from "../../lib/formato";
import { opcionesDe } from "../../lib/opciones";

// Turnos del negocio. La noche es la carta online; el mediodía es solo de uso interno.
export const TURNOS = {
  noche: { nombre: "Venta noche", corto: "Noche", detalle: "Carta online y pedidos por WhatsApp" },
  mediodia: { nombre: "Venta mediodía", corto: "Mediodía", detalle: "Menú del mediodía · uso interno" },
};

// Recorrido de un pedido: nuevo → en preparación → en camino → entregado → cobrado.
// "Cobrado" (cerrado) = se registró el pago: solo esas ventas cuentan en la facturación.
// Los cancelados se eliminan automáticamente (no quedan en el historial).
export const ESTADOS = {
  pendiente: { nombre: "Nuevo", clase: "bg-brasa/15 text-brasa border-brasa/40", color: "#c2371c" },
  en_preparacion: { nombre: "En preparación", clase: "bg-amber-100 text-amber-900 border-amber-300", color: "#d97706" },
  enviado: { nombre: "En camino", clase: "bg-sky-100 text-sky-900 border-sky-300", color: "#0284c7" },
  entregado: { nombre: "Entregado", clase: "bg-violet-100 text-violet-900 border-violet-300", color: "#7c3aed" },
  cerrado: { nombre: "Cobrado", clase: "bg-emerald-100 text-emerald-900 border-emerald-300", color: "#059669" },
  cancelado: { nombre: "Cancelado", clase: "bg-borde text-tinta-suave border-borde", color: "#6b5b4e" },
};

// Pedidos que todavía falta cobrar (se muestran en el tablero), en orden
export const ESTADOS_ABIERTOS = ["pendiente", "en_preparacion", "enviado", "entregado"];

export function estaAbierto(venta) {
  return ESTADOS_ABIERTOS.includes(venta.estado);
}

// La entrega viaja en la nota: "Envío a domicilio: …" o "Retira en el local"
export function esEnvio(venta) {
  return /^env[ií]o a domicilio/i.test(venta?.nota ?? "");
}

// Nombre del estado según el tipo de pedido (en camino / listo para retirar / servido)
export function nombreEstado(venta, estado = venta.estado) {
  if (estado === "enviado") {
    if (venta.origen === "manual") return "Servido";
    return esEnvio(venta) ? "En camino" : "Listo para retirar";
  }
  return ESTADOS[estado]?.nombre ?? estado;
}

// Próximo paso del pedido y el texto del botón que lo hace avanzar
export function siguientePaso(venta) {
  switch (venta.estado) {
    case "pendiente":
      return { estado: "en_preparacion", texto: venta.origen === "web" ? "Confirmar pedido" : "Pasar a cocina" };
    case "en_preparacion":
      return {
        estado: "enviado",
        texto: venta.origen === "manual" ? "Marcar servido" : esEnvio(venta) ? "Salió el delivery" : "Listo para retirar",
      };
    case "enviado":
      return { estado: "entregado", texto: "Marcar entregado" };
    case "entregado":
      return { estado: "cerrado", texto: "Cobrar y cerrar cuenta" };
    default:
      return null;
  }
}

export const METODOS_PAGO = {
  efectivo: { nombre: "Efectivo" },
  transferencia: { nombre: "Transferencia" },
  cuenta_corriente: { nombre: "Cuenta corriente" },
};

// "Efectivo $ 5.000 + Transferencia $ 17.000"
export function textoPagos(pagos, formatear) {
  return (pagos ?? []).map((p) => `${METODOS_PAGO[p.metodo]?.nombre ?? p.metodo} ${formatear(p.monto)}`).join(" + ");
}

// Una entrada por comida, o una por variante si la comida las tiene (Simple, Doble…).
// La usan la venta en caja y la edición de pedidos.
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

// Períodos para las secciones de dinero (gastos, finanzas)
export const RANGOS_MES = [
  { id: "mes", nombre: "Este mes" },
  { id: "mes_anterior", nombre: "Mes anterior" },
  { id: "30", nombre: "Últimos 30 días" },
  { id: "anio", nombre: "Este año" },
  { id: "personalizado", nombre: "Personalizado" },
];

function inicioDelDia(fecha) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d;
}

// "2026-10-02" → Date local a las 00:00
export function desdeInput(texto) {
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
  if (rango === "mes") return { desde: new Date(hoy.getFullYear(), hoy.getMonth(), 1), hasta: manana };
  if (rango === "mes_anterior") {
    return { desde: new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), hasta: new Date(hoy.getFullYear(), hoy.getMonth(), 1) };
  }
  if (rango === "anio") return { desde: new Date(hoy.getFullYear(), 0, 1), hasta: manana };
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

// "16/10/2026 al 31/10/2026" para títulos de reportes y nombres de archivo
export function textoPeriodo(periodo) {
  const fin = new Date(periodo.hasta.getTime() - 864e5);
  const f = (d) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${f(periodo.desde)} al ${f(fin)}`;
}

export function sufijoArchivo(periodo) {
  return `${fechaInput(periodo.desde)}_a_${fechaInput(periodo.hasta.getTime() - 864e5)}`;
}

export function unidadesDeVenta(venta) {
  return (venta.venta_items ?? []).reduce((acc, i) => acc + i.cantidad, 0);
}

// Facturación (solo ventas cobradas) por día, incluyendo días sin ventas
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

// Las 5 comidas más vendidas (por unidades) entre las ventas cobradas
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
