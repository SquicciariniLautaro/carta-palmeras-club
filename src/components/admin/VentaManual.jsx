import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { formatearPrecio, precioFinal } from "../../lib/formato";
import { IconoBasura, IconoMas } from "../ui/Iconos";
import Modal from "../ui/Modal";

// Registrar una venta hecha en el local: queda confirmada y descuenta stock
export default function VentaManual({ abierto, comidas, onCerrar, onRegistrada }) {
  const [lineas, setLineas] = useState([]); // [{ id, cantidad }]
  const [seleccion, setSeleccion] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [cliente, setCliente] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  const porId = useMemo(() => new Map(comidas.map((c) => [c.id, c])), [comidas]);
  const ordenadas = useMemo(() => [...comidas].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")), [comidas]);
  const total = lineas.reduce((acc, l) => {
    const c = porId.get(l.id);
    return c ? acc + precioFinal(c) * l.cantidad : acc;
  }, 0);

  function agregar(e) {
    e.preventDefault();
    const comida = porId.get(seleccion);
    const n = Number(cantidad);
    if (!comida) return toast.error("Elegí una comida.");
    if (!Number.isInteger(n) || n <= 0) return toast.error("La cantidad tiene que ser un entero mayor a 0.");
    const yaHay = lineas.find((l) => l.id === comida.id)?.cantidad ?? 0;
    if (yaHay + n > comida.stock) {
      return toast.error(`No hay stock suficiente de "${comida.nombre}" (quedan ${comida.stock}).`);
    }
    setLineas((prev) =>
      yaHay ? prev.map((l) => (l.id === comida.id ? { ...l, cantidad: l.cantidad + n } : l)) : [...prev, { id: comida.id, cantidad: n }]
    );
    setSeleccion("");
    setCantidad("1");
  }

  function reiniciar() {
    setLineas([]);
    setSeleccion("");
    setCantidad("1");
    setCliente("");
    setNota("");
  }

  async function registrar() {
    if (lineas.length === 0) return;
    setGuardando(true);
    const { data, error } = await supabase.rpc("registrar_venta_manual", {
      items: lineas.map((l) => ({ comida_id: l.id, cantidad: l.cantidad })),
      cliente_nombre: cliente.trim() || null,
      nota: nota.trim() || null,
    });
    setGuardando(false);
    if (error) {
      toast.error(mensajeDeError(error, "No se pudo registrar la venta."));
      return;
    }
    toast.success(`Venta #${data.numero} registrada por ${formatearPrecio(data.total)}`);
    reiniciar();
    onRegistrada();
  }

  return (
    <Modal abierto={abierto} onCerrar={guardando ? () => {} : onCerrar} titulo="Registrar venta manual" ancho="max-w-xl">
      <div className="space-y-4">
        <form onSubmit={agregar} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="vm-comida" className="sr-only">
            Comida
          </label>
          <select id="vm-comida" className="campo flex-1" value={seleccion} onChange={(e) => setSeleccion(e.target.value)}>
            <option value="">Elegí una comida…</option>
            {ordenadas.map((c) => (
              <option key={c.id} value={c.id} disabled={c.stock <= 0}>
                {c.nombre} · {formatearPrecio(precioFinal(c))} · stock {c.stock}
                {c.activo ? "" : " (inactiva)"}
              </option>
            ))}
          </select>
          <label htmlFor="vm-cant" className="sr-only">
            Cantidad
          </label>
          <input
            id="vm-cant"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            className="campo sm:w-20"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
          />
          <button type="submit" className="boton-secundario shrink-0">
            <IconoMas className="size-4" /> Agregar
          </button>
        </form>

        {lineas.length === 0 ? (
          <p className="rounded-xl bg-fondo p-4 text-center text-sm text-tinta-suave">Agregá las comidas vendidas.</p>
        ) : (
          <ul className="divide-y divide-borde rounded-xl bg-fondo px-3">
            {lineas.map((l) => {
              const c = porId.get(l.id);
              if (!c) return null;
              return (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <strong>{l.cantidad}x</strong> {c.nombre}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {formatearPrecio(precioFinal(c) * l.cantidad)}
                    <button
                      type="button"
                      className="rounded p-1 text-tinta-suave hover:text-brasa"
                      onClick={() => setLineas((prev) => prev.filter((x) => x.id !== l.id))}
                      aria-label={`Quitar ${c.nombre}`}
                    >
                      <IconoBasura className="size-4" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="vm-cliente" className="etiqueta">
              Cliente (opcional)
            </label>
            <input id="vm-cliente" className="campo" maxLength={80} value={cliente} onChange={(e) => setCliente(e.target.value)} />
          </div>
          <div>
            <label htmlFor="vm-nota" className="etiqueta">
              Nota (opcional)
            </label>
            <input id="vm-nota" className="campo" maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-borde pt-4">
          <span className="text-lg font-bold">Total: {formatearPrecio(total)}</span>
          <button type="button" className="boton-primario" disabled={guardando || lineas.length === 0} onClick={registrar}>
            {guardando ? "Registrando…" : "Registrar venta"}
          </button>
        </div>
        <p className="text-xs text-tinta-suave">
          Los precios finales los calcula la base de datos con los valores actuales. La venta queda confirmada y descuenta stock.
        </p>
      </div>
    </Modal>
  );
}
