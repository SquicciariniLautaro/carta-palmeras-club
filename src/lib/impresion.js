// Impresión en la ticketera térmica (58 u 80 mm) desde el navegador.
// Se arma el ticket en un contenedor que solo se ve al imprimir y se llama a
// window.print(): sin ventanas emergentes ni librerías.
//
// Para que imprima directo, sin el cuadro de diálogo, abrí el panel en Chrome
// con la opción --kiosk-printing y la ticketera como impresora predeterminada.
import { NEGOCIO } from "../config";
import { formatearFechaHora, formatearPesos } from "./formato";
import { METODOS_PAGO, TURNOS, esEnvio } from "../components/admin/ventasUtils";

const CLAVE = "palmeras.impresora";

export const CONFIG_IMPRESORA = Object.freeze({
  ancho: 80, // mm del papel: 80 o 58
  comandaAlConfirmar: true, // imprime la comanda de cocina al confirmar un pedido
  comandaAlLlegar: false, // imprime la comanda apenas entra un pedido web
  ticketAlCobrar: false, // imprime el ticket del cliente al cobrar
});

export function leerConfigImpresora() {
  try {
    return { ...CONFIG_IMPRESORA, ...JSON.parse(localStorage.getItem(CLAVE) || "{}") };
  } catch {
    return { ...CONFIG_IMPRESORA };
  }
}

export function guardarConfigImpresora(config) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(config));
  } catch {
    // modo privado: queda la configuración de esta sesión
  }
}

function esc(texto) {
  return String(texto ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function imprimirHtml(html) {
  const { ancho } = leerConfigImpresora();
  let zona = document.getElementById("zona-impresion");
  if (!zona) {
    zona = document.createElement("div");
    zona.id = "zona-impresion";
    document.body.appendChild(zona);
  }
  let estilo = document.getElementById("estilo-impresion");
  if (!estilo) {
    estilo = document.createElement("style");
    estilo.id = "estilo-impresion";
    document.head.appendChild(estilo);
  }
  estilo.textContent = `@media print { @page { size: ${ancho}mm auto; margin: 0; } }`;
  zona.className = ancho === 58 ? "ticket-58" : "ticket-80";
  zona.innerHTML = html;
  document.body.classList.add("imprimiendo");

  const limpiar = () => {
    document.body.classList.remove("imprimiendo");
    zona.innerHTML = "";
    window.removeEventListener("afterprint", limpiar);
  };
  window.addEventListener("afterprint", limpiar);
  // Esperamos un cuadro para que el navegador aplique los estilos
  requestAnimationFrame(() => {
    window.print();
    setTimeout(limpiar, 60_000);
  });
}

function lineaEntrega(venta) {
  if (venta.origen === "manual") return venta.cliente_nombre ? "" : "Consumo en el local";
  return esEnvio(venta) ? "ENVÍO A DOMICILIO" : "RETIRA EN EL LOCAL";
}

// Comanda para la cocina: grande, sin precios
export function imprimirComanda(venta) {
  const items = (venta.venta_items ?? [])
    .map(
      (i) => `<div class="t-item"><span class="t-cant">${i.cantidad}</span><span><strong>${esc(i.nombre)}</strong>${
        i.detalle ? `<br><span class="t-det">${esc(i.detalle)}</span>` : ""
      }</span></div>`
    )
    .join("");
  imprimirHtml(`
    <div class="ticket">
      <p class="t-centro t-chico">COMANDA · ${esc(TURNOS[venta.turno]?.corto.toUpperCase() ?? "")}</p>
      <p class="t-centro t-enorme">#${esc(venta.numero)}</p>
      <p class="t-centro">${esc(formatearFechaHora(venta.created_at))}</p>
      ${venta.cliente_nombre ? `<p class="t-centro t-grande">${esc(venta.cliente_nombre)}</p>` : ""}
      ${lineaEntrega(venta) ? `<p class="t-centro"><strong>${esc(lineaEntrega(venta))}</strong></p>` : ""}
      <hr>
      ${items}
      <hr>
      ${venta.nota ? `<p class="t-nota"><strong>NOTA:</strong> ${esc(venta.nota)}</p>` : ""}
      <p class="t-centro t-chico">Impreso ${esc(formatearFechaHora(new Date()))}</p>
    </div>`);
}

// Ticket de la venta para el cliente (no fiscal)
export function imprimirTicket(venta, pagos = []) {
  const items = (venta.venta_items ?? [])
    .map(
      (i) => `<div class="t-fila"><span>${i.cantidad} x ${esc(i.nombre)}${
        i.detalle ? `<br><span class="t-det">${esc(i.detalle)}</span>` : ""
      }${i.cantidad > 1 ? `<br><span class="t-det">${esc(formatearPesos(i.precio_unitario))} c/u</span>` : ""}</span><span>${esc(
        formatearPesos(i.subtotal)
      )}</span></div>`
    )
    .join("");
  const listaPagos = pagos
    .map((p) => `<div class="t-fila"><span>${esc(METODOS_PAGO[p.metodo]?.nombre ?? p.metodo)}</span><span>${esc(formatearPesos(p.monto))}</span></div>`)
    .join("");
  imprimirHtml(`
    <div class="ticket">
      <p class="t-centro t-grande"><strong>${esc(NEGOCIO.nombre.toUpperCase())}</strong></p>
      <p class="t-centro t-chico">Comprobante no válido como factura</p>
      <hr>
      <div class="t-fila"><span>Venta N° ${esc(venta.numero)}</span><span>${esc(formatearFechaHora(venta.created_at))}</span></div>
      ${venta.cliente_nombre ? `<p>Cliente: ${esc(venta.cliente_nombre)}</p>` : ""}
      <hr>
      ${items}
      <hr>
      <div class="t-fila t-grande"><strong>TOTAL</strong><strong>${esc(formatearPesos(venta.total))}</strong></div>
      ${listaPagos ? `<hr><p class="t-chico">FORMA DE PAGO</p>${listaPagos}` : ""}
      <hr>
      <p class="t-centro">Gracias por su compra</p>
    </div>`);
}

// Resumen de un arqueo de caja (al cerrarlo o desde el historial)
export function imprimirArqueo(caja, resumen) {
  const r = resumen ?? caja.resumen ?? {};
  const fila = (texto, valor, fuerte = false) =>
    `<div class="t-fila">${fuerte ? `<strong>${esc(texto)}</strong><strong>${esc(formatearPesos(valor))}</strong>` : `<span>${esc(texto)}</span><span>${esc(formatearPesos(valor))}</span>`}</div>`;
  const contado = caja.efectivo_contado ?? r.efectivo_contado;
  imprimirHtml(`
    <div class="ticket">
      <p class="t-centro t-grande"><strong>ARQUEO DE CAJA N° ${esc(caja.numero)}</strong></p>
      <p class="t-centro">${esc(NEGOCIO.nombre)}</p>
      <hr>
      <p>Apertura: ${esc(formatearFechaHora(caja.abierta_at))}</p>
      ${caja.cerrada_at ? `<p>Cierre: ${esc(formatearFechaHora(caja.cerrada_at))}</p>` : "<p>Caja abierta (parcial)</p>"}
      <hr>
      ${fila("Efectivo inicial", r.monto_inicial)}
      ${fila("Ventas en efectivo", r.ventas_efectivo)}
      ${fila("Cobros cta. cte. efectivo", r.cobros_cuenta_efectivo)}
      ${fila("Ingresos de efectivo", r.ingresos)}
      ${fila("Retiros", -Number(r.retiros ?? 0))}
      ${fila("Gastos pagados con caja", -Number(r.gastos_efectivo ?? 0))}
      ${fila("EFECTIVO ESPERADO", r.efectivo_esperado, true)}
      ${contado != null ? fila("EFECTIVO CONTADO", contado, true) : ""}
      ${r.diferencia != null ? fila(Number(r.diferencia) < 0 ? "FALTANTE" : "SOBRANTE", Math.abs(Number(r.diferencia)), true) : ""}
      <hr>
      ${fila("Ventas por transferencia", r.ventas_transferencia)}
      ${fila("Cobros cta. cte. transferencia", r.cobros_cuenta_transferencia)}
      ${fila("Ventas a cuenta corriente", r.ventas_cuenta_corriente)}
      ${fila("TOTAL VENDIDO", r.total_vendido, true)}
      <p>Cantidad de ventas: ${esc(r.cantidad_ventas ?? 0)}</p>
      <hr>
      <p class="t-centro t-chico">Impreso ${esc(formatearFechaHora(new Date()))}</p>
    </div>`);
}
