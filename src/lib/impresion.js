// Impresión en la ticketera térmica (58 u 80 mm) desde el navegador.
// Se arma el ticket en un contenedor que solo se ve al imprimir y se llama a
// window.print(): sin ventanas emergentes ni librerías.
//
// Ninguna página web puede imprimir sola: Chrome siempre muestra el cuadro de
// impresión, salvo que se abra con --kiosk-printing (ver ConfigImpresora).
// Por eso medimos cuánto tarda window.print(): si tarda, hubo cuadro y el
// panel avisa que falta abrirlo desde el acceso directo.
import { NEGOCIO } from "../config";
import { formatearFechaHora, formatearPesos } from "./formato";
import { METODOS_PAGO, TURNOS, esEnvio } from "../components/admin/ventasUtils";

const CLAVE = "palmeras.impresora";
const CLAVE_MODO = "palmeras.impresion.modo";
const CLAVE_CORTADOR = "palmeras.cortador";
export const EVENTO_MODO = "palmeras:modo-impresion";
export const EVENTO_CORTADOR = "palmeras:cortador";

// El "cortador" lo instala el instalador de la ticketera (instalador-panel.ps1) cuando el
// driver no trae la opción de cortar (el genérico POS-80): un programita en la computadora
// del local que le manda a la ticketera la orden de corte después de cada impresión.
const CORTADOR = "http://127.0.0.1:17580";

export const CONFIG_IMPRESORA = Object.freeze({
  ancho: 80, // mm del papel: 80 o 58
  comandaAlConfirmar: true, // imprime la comanda de cocina al confirmar un pedido
  comandaAlLlegar: false, // imprime la comanda apenas entra un pedido web
  comandaKiosco: false, // también si el pedido es solo de bebidas o golosinas
  ticketAlCobrar: false, // imprime el ticket del cliente al cobrar
});

// "directa" (sale sola), "dialogo" (Chrome pidió confirmar) o null (sin probar)
export function leerModoImpresion() {
  try {
    return localStorage.getItem(CLAVE_MODO);
  } catch {
    return null;
  }
}

function guardarModo(modo) {
  try {
    localStorage.setItem(CLAVE_MODO, modo);
  } catch {
    // modo privado: igual avisamos en esta sesión
  }
  window.dispatchEvent(new CustomEvent(EVENTO_MODO, { detail: modo }));
}

// "si" si el cortador respondió alguna vez en esta computadora: desde ahí se le pide el
// corte en cada impresión (aunque una falle, por ejemplo si recién se prendió la compu).
export function leerCortador() {
  try {
    return localStorage.getItem(CLAVE_CORTADOR);
  } catch {
    return null;
  }
}

// El evento lleva el resultado del último pedido: "si" (cortó) o "fallo"
function avisarCortador(ok) {
  if (ok) {
    try {
      localStorage.setItem(CLAVE_CORTADOR, "si");
    } catch {
      // modo privado
    }
  }
  window.dispatchEvent(new CustomEvent(EVENTO_CORTADOR, { detail: ok ? "si" : "fallo" }));
}

// Pide el corte del papel. El cortador espera a que la comanda entre a la cola de Windows
// y recién ahí corta, así que se llama después de window.print(). La primera vez Chrome
// pregunta si el panel puede usar apps de esta computadora: hay que tocar Permitir (por
// eso el tiempo de espera es largo). Devuelve true si cortó.
export async function cortarPapel() {
  const control = new AbortController();
  const espera = setTimeout(() => control.abort(), 30_000);
  let ok;
  try {
    const r = await fetch(`${CORTADOR}/cortar`, { signal: control.signal, cache: "no-store", targetAddressSpace: "loopback" });
    ok = r.ok && (await r.json()).ok === true;
  } catch {
    ok = false;
  } finally {
    clearTimeout(espera);
  }
  avisarCortador(ok);
  return ok;
}

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

// Si window.print() tarda más que esto, se abrió el cuadro de impresión
const TARDA_CON_DIALOGO_MS = 1500;

// Cola: si llegan dos pedidos juntos, cada comanda sale entera y en orden
// (antes la segunda podía pisar a la primera mientras se imprimía).
const cola = [];
let imprimiendo = false;

// probarCorte: pide el corte aunque esta computadora todavía no tenga el cortador
// (lo usa "Imprimir prueba"); si no, solo donde ya respondió alguna vez, así en el
// celular o en otra computadora no se intenta.
function imprimirHtml(html, { probarCorte = false } = {}) {
  cola.push({ html, probarCorte });
  if (!imprimiendo) siguiente();
}

function siguiente() {
  const trabajo = cola.shift();
  if (trabajo === undefined) {
    imprimiendo = false;
    return;
  }
  imprimiendo = true;
  const { html, probarCorte } = trabajo;

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
  // El largo del papel lo pone el driver de la ticketera (rollo continuo). Cada
  // impresión es un trabajo aparte: la corta el driver ("Corte al final del
  // documento") o, si no tiene esa opción, el cortador (ver cortarPapel).
  estilo.textContent = `@media print { @page { margin: 0; } }`;
  zona.className = ancho === 58 ? "ticket-58" : "ticket-80";
  zona.innerHTML = html;
  document.body.classList.add("imprimiendo");

  let terminado = false;
  let reserva = 0;
  let corte = Promise.resolve();
  const terminar = () => {
    if (terminado) return;
    terminado = true;
    window.removeEventListener("afterprint", terminar);
    clearTimeout(reserva);
    document.body.classList.remove("imprimiendo");
    zona.innerHTML = "";
    // La siguiente comanda espera a que el corte de esta ya esté en la cola de Windows:
    // si no, el corte podía salir después de la siguiente y quedaban las dos pegadas.
    // (setTimeout: afterprint puede llegar antes de que window.print() termine)
    setTimeout(() => corte.finally(() => setTimeout(siguiente, 300)), 0);
  };
  window.addEventListener("afterprint", terminar);
  // setTimeout y no requestAnimationFrame: con la pestaña en segundo plano
  // los cuadros no se dibujan y la comanda quedaba esperando hasta volver.
  setTimeout(() => {
    void zona.offsetHeight; // aplica los estilos antes de imprimir
    const inicio = performance.now();
    window.print();
    guardarModo(performance.now() - inicio > TARDA_CON_DIALOGO_MS ? "dialogo" : "directa");
    if (probarCorte || leerCortador() === "si") corte = cortarPapel();
    reserva = setTimeout(terminar, 60_000); // por si el navegador no avisa que terminó
  }, 50);
}

function lineaEntrega(venta) {
  if (venta.origen === "manual") return venta.cliente_nombre ? "" : "Consumo en el local";
  return esEnvio(venta) ? "ENVÍO A DOMICILIO" : "RETIRA EN EL LOCAL";
}

// Comanda para la cocina: grande, sin precios
export function imprimirComanda(venta, opciones) {
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
    </div>`,
    opciones
  );
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
