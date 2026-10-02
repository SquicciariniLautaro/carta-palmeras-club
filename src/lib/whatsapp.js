import { NEGOCIO } from "../config";
import { formatearPrecio } from "./formato";

export function linkWhatsApp(mensaje) {
  return `https://wa.me/${NEGOCIO.whatsapp}?text=${encodeURIComponent(mensaje)}`;
}

// Mensaje del pedido. Los ítems y el total vienen de la base (crear_pedido),
// así el dueño recibe exactamente lo que quedó registrado.
export const ENTREGA = { retiro: "retiro", envio: "envio" };

// La entrega se guarda dentro de la nota de la venta para que el dueño la vea
// también en el panel, sin tocar la base de datos.
export function notaParaRegistro({ nota, entrega, direccion }) {
  const entregaTexto =
    entrega === ENTREGA.envio ? `Envío a domicilio: ${direccion}` : "Retira en el local";
  return [entregaTexto, nota].filter(Boolean).join(". ");
}

export function armarMensajePedido({ numero, items, total, cliente, nota, entrega, direccion }) {
  const lineas = items.map(
    (i) => `*${i.cantidad}x* ${i.nombre} - ${formatearPrecio(i.subtotal)}`
  );

  const partes = [`¡Hola ${NEGOCIO.nombre}! Quiero hacer este pedido:`, ""];
  partes.push(`*Pedido #${numero}*`);
  if (cliente) partes.push(`*A nombre de:* ${cliente}`);
  if (entrega === ENTREGA.envio) {
    partes.push("*Entrega:* Envío a domicilio", `*Dirección:* ${direccion}`);
  } else {
    partes.push("*Entrega:* Retiro en el local");
  }
  partes.push("", ...lineas, "", `*Total a pagar: ${formatearPrecio(total)}*`);
  if (nota) partes.push("", `*Nota:* ${nota}`);
  partes.push("", "¿Me confirmás el tiempo de demora y cómo te lo pago?");

  return partes.join("\n");
}

export function mensajeConsulta(comida) {
  return comida
    ? `¡Hola ${NEGOCIO.nombre}! Quería consultar por "${comida.nombre}".`
    : `¡Hola ${NEGOCIO.nombre}! Quería hacerles una consulta.`;
}
