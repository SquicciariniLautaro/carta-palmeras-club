import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { formatearPesos, formatearPrecio, normalizarTexto } from "../../lib/formato";
import { imprimirComanda, imprimirTicket, leerConfigImpresora } from "../../lib/impresion";
import { useCaja, useClientes } from "../../hooks/useCaja";
import { IconoBasura, IconoBuscar, IconoMenuDia } from "../ui/Iconos";
import Modal from "../ui/Modal";
import ControlCantidad from "../catalogo/ControlCantidad";
import FormPagos from "./FormPagos";
import { PAGO_INICIAL, pagoUsaCaja, pagosConMontos, validarPago } from "./pagosUtils";
import { TURNOS, entradasDeComidas, necesitaCocina, stockDe } from "./ventasUtils";

const MAX_POR_LINEA = 50;

function Contenido({ turno, comidas, kiosco, menuHoy, onCerrar, onRegistrada }) {
  const { caja } = useCaja();
  const { clientes, recargar: recargarClientes } = useClientes();
  const [lineas, setLineas] = useState([]); // [{ valor, cantidad }]
  const [busqueda, setBusqueda] = useState("");
  const [cliente, setCliente] = useState("");
  const [nota, setNota] = useState("");
  const [modo, setModo] = useState("cobrar"); // cobrar | abierta
  const [pago, setPago] = useState(PAGO_INICIAL);
  const [comandaElegida, setComandaElegida] = useState(null); // null = según lo que se vende
  const [conTicket, setConTicket] = useState(() => leerConfigImpresora().ticketAlCobrar);
  const [guardando, setGuardando] = useState(false);

  const entradas = useMemo(() => entradasDeComidas(comidas), [comidas]);
  const entradaPorValor = useMemo(() => new Map(entradas.map((e) => [e.valor, e])), [entradas]);
  const delMenu = useMemo(() => entradas.filter((e) => menuHoy.includes(e.comida.id)), [entradas, menuHoy]);
  const encontradas = useMemo(() => {
    const texto = normalizarTexto(busqueda);
    if (!texto) return [];
    return entradas.filter((e) => normalizarTexto(e.nombre).includes(texto)).slice(0, 8);
  }, [entradas, busqueda]);

  const total = lineas.reduce((acc, l) => acc + (entradaPorValor.get(l.valor)?.precio ?? 0) * l.cantidad, 0);

  // Solo bebidas o golosinas: la comanda queda destildada (se puede tildar igual)
  const paraCocina = necesitaCocina(
    lineas.map((l) => ({ comida_id: entradaPorValor.get(l.valor)?.comida.id })),
    kiosco
  );
  const conComanda = comandaElegida ?? (lineas.length === 0 || paraCocina);

  // Unidades pedidas de cada comida (una bebida puede estar en varias líneas)
  const pedidas = new Map();
  for (const l of lineas) {
    const id = entradaPorValor.get(l.valor)?.comida.id;
    if (id) pedidas.set(id, (pedidas.get(id) ?? 0) + l.cantidad);
  }
  const sinStock = [...pedidas]
    .map(([id, cantidad]) => ({ comida: comidas.find((c) => c.id === id), cantidad }))
    .filter(({ comida, cantidad }) => comida && stockDe(comida, kiosco) != null && cantidad > stockDe(comida, kiosco));

  function sumar(valor, delta = 1) {
    setLineas((prev) => {
      const existe = prev.find((l) => l.valor === valor);
      if (!existe) return delta > 0 ? [...prev, { valor, cantidad: delta }] : prev;
      return prev
        .map((l) => (l.valor === valor ? { ...l, cantidad: Math.min(MAX_POR_LINEA, l.cantidad + delta) } : l))
        .filter((l) => l.cantidad > 0);
    });
  }

  async function registrar() {
    if (lineas.length === 0) return toast.error("Agregá al menos un producto.");
    let pagos = null;
    if (modo === "cobrar") {
      const validacion = validarPago(pago, total);
      if (validacion.error) return toast.error(validacion.error);
      if (pagoUsaCaja(pago) && !caja) return toast.error("Abrí la caja para cobrar en efectivo o por transferencia.");
      pagos = validacion.pagos;
    }
    setGuardando(true);
    const { data, error } = await supabase.rpc("registrar_venta_local", {
      items: lineas.map((l) => {
        const e = entradaPorValor.get(l.valor);
        return { comida_id: e.comida.id, cantidad: l.cantidad, variante: e.variante };
      }),
      turno,
      cliente_nombre: cliente.trim() || null,
      nota: nota.trim() || null,
      pagos,
    });
    if (error) {
      setGuardando(false);
      return toast.error(mensajeDeError(error, "No se pudo registrar la venta."));
    }
    // Traemos la venta completa para imprimir con los precios que guardó la base
    const { data: venta } = await supabase.from("ventas").select("*, venta_items(*)").eq("id", data.id).single();
    setGuardando(false);
    if (venta && conComanda) imprimirComanda(venta);
    if (venta && modo === "cobrar" && conTicket) setTimeout(() => imprimirTicket(venta, pagosConMontos(pagos, Number(venta.total))), 400);
    toast.success(
      modo === "cobrar"
        ? `Venta #${data.numero} cobrada: ${formatearPesos(data.total)}`
        : `Cuenta #${data.numero} abierta. La cobrás desde el tablero.`
    );
    onRegistrada();
  }

  return (
    <div className="space-y-4">
      {delMenu.length > 0 && (
        <div>
          <p className="etiqueta flex items-center gap-1.5">
            <IconoMenuDia className="size-4" /> Menú de hoy (tocá para sumar)
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {delMenu.map((e) => (
              <button
                key={e.valor}
                type="button"
                onClick={() => sumar(e.valor)}
                className="rounded-xl border border-borde bg-papel px-3 py-2.5 text-left text-sm hover:border-mediodia hover:bg-mediodia-suave"
              >
                <span className="block font-semibold leading-tight">{e.nombre}</span>
                <span className="cifras text-xs text-tinta-suave">{formatearPrecio(e.precio)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="relative">
        <label className="relative block">
          <span className="sr-only">Buscar producto</span>
          <IconoBuscar className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-suave" />
          <input
            type="search"
            className="campo pl-9"
            placeholder={`Buscar en la carta de ${TURNOS[turno].corto.toLowerCase()}…`}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </label>
        {encontradas.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-borde bg-papel shadow-lg">
            {encontradas.map((e) => (
              <li key={e.valor}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-borde"
                  onClick={() => {
                    sumar(e.valor);
                    setBusqueda("");
                  }}
                >
                  <span>
                    {e.nombre}
                    {!e.comida.activo && <span className="ml-1 text-xs text-tinta-suave">(no disponible)</span>}
                    {stockDe(e.comida, kiosco) != null && (
                      <span className={`ml-1 text-xs ${stockDe(e.comida, kiosco) > 0 ? "text-tinta-suave" : "font-semibold text-brasa"}`}>
                        (stock: {stockDe(e.comida, kiosco)})
                      </span>
                    )}
                  </span>
                  <span className="cifras shrink-0 text-tinta-suave">{formatearPrecio(e.precio)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {busqueda && encontradas.length === 0 && <p className="mt-1 text-xs text-tinta-suave">No hay productos con ese nombre.</p>}
      </div>

      {lineas.length === 0 ? (
        <p className="rounded-xl bg-fondo p-4 text-center text-sm text-tinta-suave">Todavía no agregaste productos.</p>
      ) : (
        <ul className="divide-y divide-borde rounded-xl bg-fondo px-3">
          {lineas.map((l) => {
            const e = entradaPorValor.get(l.valor);
            if (!e) return null;
            return (
              <li key={l.valor} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  {e.nombre}
                  <span className="cifras block text-xs text-tinta-suave">{formatearPrecio(e.precio)} c/u</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="w-28">
                    <ControlCantidad cantidad={l.cantidad} onSumar={() => sumar(l.valor)} onRestar={() => sumar(l.valor, -1)} nombre={e.nombre} chico />
                  </span>
                  <span className="cifras w-20 text-right font-semibold">{formatearPrecio(e.precio * l.cantidad)}</span>
                  <button
                    type="button"
                    className="rounded p-1.5 text-tinta-suave hover:bg-borde hover:text-rojo"
                    onClick={() => setLineas((prev) => prev.filter((x) => x.valor !== l.valor))}
                    aria-label={`Quitar ${e.nombre}`}
                  >
                    <IconoBasura className="size-4" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {sinStock.length > 0 && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          Según el sistema no alcanza el stock de {sinStock.map(({ comida }) => `${comida.nombre} (quedan ${stockDe(comida, kiosco)})`).join(", ")}.
          La venta se registra igual y el stock queda en negativo: después corregilo en Comidas con lo que hay en la heladera.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="etiqueta">Cliente o mesa (opcional)</span>
          <input className="campo" maxLength={80} placeholder="Ej.: Mesa 4" value={cliente} onChange={(e) => setCliente(e.target.value)} />
        </label>
        <label>
          <span className="etiqueta">Nota para la cocina (opcional)</span>
          <input className="campo" maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-fondo p-1" role="radiogroup" aria-label="Cuándo se cobra">
        {[
          ["cobrar", "Cobrar ahora"],
          ["abierta", "Dejar cuenta abierta"],
        ].map(([id, texto]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={modo === id}
            onClick={() => setModo(id)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${modo === id ? "bg-papel text-tinta shadow-sm" : "text-tinta-suave"}`}
          >
            {texto}
          </button>
        ))}
      </div>

      {modo === "cobrar" ? (
        <FormPagos total={total} valor={pago} onCambio={setPago} clientes={clientes} onClienteCreado={recargarClientes} />
      ) : (
        <p className="rounded-xl bg-fondo p-3 text-xs text-tinta-suave">
          La cuenta queda en el tablero de pedidos. Podés sumarle productos y cerrarla cuando el cliente pague.
        </p>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-palmera" checked={conComanda} onChange={(e) => setComandaElegida(e.target.checked)} />
          Imprimir comanda para la cocina
          {lineas.length > 0 && !paraCocina && <span className="text-xs text-tinta-suave">(solo bebidas o golosinas: es opcional)</span>}
        </label>
        {modo === "cobrar" && (
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-palmera" checked={conTicket} onChange={(e) => setConTicket(e.target.checked)} />
            Imprimir ticket del cliente
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borde pt-4">
        <span className="cifras text-xl font-bold">Total: {formatearPesos(total)}</span>
        <div className="flex gap-2">
          <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button type="button" className="boton-primario" disabled={guardando || lineas.length === 0} onClick={registrar}>
            {guardando ? "Registrando…" : modo === "cobrar" ? "Cobrar venta" : "Abrir cuenta"}
          </button>
        </div>
      </div>
      <p className="text-xs text-tinta-suave">Los precios finales los calcula la base de datos con los valores actuales.</p>
    </div>
  );
}

// Venta en caja (mostrador o mesa) para el turno noche o mediodía
export default function VentaLocal({ abierto, turno, comidas, kiosco = new Set(), menuHoy = [], onCerrar, onRegistrada }) {
  const [vuelta, setVuelta] = useState(0);
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo={`Nueva venta en caja · ${TURNOS[turno].corto}`} ancho="max-w-2xl">
      {abierto && (
        <Contenido
          key={vuelta}
          turno={turno}
          comidas={comidas}
          kiosco={kiosco}
          menuHoy={menuHoy}
          onCerrar={onCerrar}
          onRegistrada={() => {
            setVuelta((n) => n + 1);
            onRegistrada();
          }}
        />
      )}
    </Modal>
  );
}
