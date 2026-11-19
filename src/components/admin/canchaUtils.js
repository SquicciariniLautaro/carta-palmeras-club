import { supabase } from "../../lib/supabase";
import { imprimirTicket } from "../../lib/impresion";

// Turno con su cuenta: el alquiler, lo que consumieron (bebidas, comida, regalos) y lo pagado
export const COLUMNAS_TURNO =
  "*, ventas(id, numero, estado, total, created_at, cliente_nombre, turno, origen, nota, venta_items(*), pagos(id, metodo, monto, nota, usuario, cliente_id, clientes(nombre)))";

// "20:00:00" → minutos desde las 00
export function aMinutos(hora) {
  const [h, m] = String(hora).split(":").map(Number);
  return h * 60 + m;
}

// 1290 → "21:30" (pasada la medianoche vuelve a 00:00)
export function aHora(minutos) {
  const total = ((minutos % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function textoDuracion(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}

export function horario(t) {
  const inicio = aMinutos(t.desde);
  return `${aHora(inicio)} a ${aHora(inicio + t.minutos)}`;
}

export const redondo = (n) => Math.round(n * 100) / 100;

// Estado de la plata de un turno: el total (alquiler + consumos), lo pagado (señas incluidas) y lo que falta
export const estaCobrado = (t) => t.ventas?.estado === "cerrado";
export const totalTurnoDe = (t) => Number(t.ventas?.total ?? t.precio);
export const pagadoDe = (t) => (t.ventas?.pagos ?? []).reduce((acc, p) => acc + Number(p.monto), 0);
export const estaSenado = (t) => !estaCobrado(t) && pagadoDe(t) > 0;
export const restaDe = (t) => redondo(totalTurnoDe(t) - pagadoDe(t));
// Lo que consumieron (todo lo que no es el alquiler)
export const consumosDe = (t) => (t.ventas?.venta_items ?? []).filter((i) => i.comida_id != null || !/^Alquiler de cancha/.test(i.nombre));

export async function imprimirTicketDeVenta(ventaId) {
  const { data } = await supabase.from("ventas").select("*, venta_items(*), pagos(metodo, monto)").eq("id", ventaId).single();
  if (data) imprimirTicket(data, data.pagos ?? []);
}
