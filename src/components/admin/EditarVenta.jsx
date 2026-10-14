import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { formatearPrecio } from "../../lib/formato";
import { IconoBasura, IconoMas } from "../ui/Iconos";
import Modal from "../ui/Modal";
import ControlCantidad from "../catalogo/ControlCantidad";
import { entradasDeComidas } from "./ventasUtils";

const MAX_POR_LINEA = 50;

// Contenido del editor: se monta de nuevo con cada pedido, así arranca con sus datos
function Editor({ venta, comidas, onCerrar, onGuardada }) {
  // Líneas que ya tenía el pedido: conservan el precio con el que se pidieron
  const [lineas, setLineas] = useState(() =>
    venta.venta_items.map((i) => ({
      id: i.id,
      nombre: i.nombre,
      detalle: i.detalle,
      precio: Number(i.precio_unitario),
      cantidad: i.cantidad,
    }))
  );
  // Líneas nuevas: toman el precio actual de la comida
  const [nuevas, setNuevas] = useState([]); // [{ valor, cantidad }]
  const [seleccion, setSeleccion] = useState("");
  const [cliente, setCliente] = useState(venta.cliente_nombre ?? "");
  const [nota, setNota] = useState(venta.nota ?? "");
  const [guardando, setGuardando] = useState(false);

  const entradas = useMemo(() => entradasDeComidas(comidas), [comidas]);
  const entradaPorValor = useMemo(() => new Map(entradas.map((e) => [e.valor, e])), [entradas]);

  const total =
    lineas.reduce((acc, l) => acc + l.precio * l.cantidad, 0) +
    nuevas.reduce((acc, n) => acc + (entradaPorValor.get(n.valor)?.precio ?? 0) * n.cantidad, 0);
  const vacio = lineas.length === 0 && nuevas.length === 0;

  const cambiarLinea = (id, delta) =>
    setLineas((prev) =>
      prev.map((l) => (l.id === id ? { ...l, cantidad: Math.min(MAX_POR_LINEA, Math.max(1, l.cantidad + delta)) } : l))
    );
  const cambiarNueva = (valor, delta) =>
    setNuevas((prev) =>
      prev.map((n) =>
        n.valor === valor ? { ...n, cantidad: Math.min(MAX_POR_LINEA, Math.max(1, n.cantidad + delta)) } : n
      )
    );

  function agregar(e) {
    e.preventDefault();
    if (!entradaPorValor.has(seleccion)) return toast.error("Elegí una comida.");
    setNuevas((prev) =>
      prev.some((n) => n.valor === seleccion)
        ? prev.map((n) => (n.valor === seleccion ? { ...n, cantidad: Math.min(MAX_POR_LINEA, n.cantidad + 1) } : n))
        : [...prev, { valor: seleccion, cantidad: 1 }]
    );
    setSeleccion("");
  }

  async function guardar() {
    if (vacio) return toast.error("El pedido no puede quedar vacío. Si no va, cancelalo o borralo.");
    setGuardando(true);
    const { data, error } = await supabase.rpc("editar_venta", {
      venta_id: venta.id,
      items: lineas.map((l) => ({ id: l.id, cantidad: l.cantidad })),
      nuevos: nuevas.map((n) => {
        const entrada = entradaPorValor.get(n.valor);
        return { comida_id: entrada.comida.id, cantidad: n.cantidad, variante: entrada.variante };
      }),
      cliente_nombre: cliente.trim() || null,
      nota: nota.trim() || null,
    });
    setGuardando(false);
    if (error) {
      toast.error(mensajeDeError(error, "No se pudo guardar el pedido."));
      return;
    }
    toast.success(`Pedido #${data.numero} actualizado: ${formatearPrecio(data.total)}`);
    onGuardada();
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-borde rounded-xl bg-fondo px-3">
        {lineas.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              {l.nombre}
              {l.detalle && <span className="block text-xs text-tinta-suave">{l.detalle}</span>}
              <span className="block text-xs text-tinta-suave">{formatearPrecio(l.precio)} c/u</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="w-28">
                <ControlCantidad
                  cantidad={l.cantidad}
                  onSumar={() => cambiarLinea(l.id, 1)}
                  onRestar={() => cambiarLinea(l.id, -1)}
                  nombre={l.nombre}
                  chico
                />
              </span>
              <button
                type="button"
                className="rounded p-1.5 text-tinta-suave hover:bg-borde hover:text-rojo"
                onClick={() => setLineas((prev) => prev.filter((x) => x.id !== l.id))}
                aria-label={`Sacar ${l.nombre} del pedido`}
              >
                <IconoBasura className="size-4" />
              </button>
            </span>
          </li>
        ))}
        {nuevas.map((n) => {
          const e = entradaPorValor.get(n.valor);
          if (!e) return null;
          return (
            <li key={n.valor} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                {e.nombre} <span className="rounded-full bg-palmera/15 px-1.5 text-[11px] font-semibold text-palmera">nuevo</span>
                <span className="block text-xs text-tinta-suave">{formatearPrecio(e.precio)} c/u</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="w-28">
                  <ControlCantidad
                    cantidad={n.cantidad}
                    onSumar={() => cambiarNueva(n.valor, 1)}
                    onRestar={() => cambiarNueva(n.valor, -1)}
                    nombre={e.nombre}
                    chico
                  />
                </span>
                <button
                  type="button"
                  className="rounded p-1.5 text-tinta-suave hover:bg-borde hover:text-rojo"
                  onClick={() => setNuevas((prev) => prev.filter((x) => x.valor !== n.valor))}
                  aria-label={`Sacar ${e.nombre} del pedido`}
                >
                  <IconoBasura className="size-4" />
                </button>
              </span>
            </li>
          );
        })}
        {vacio && <li className="py-4 text-center text-sm text-tinta-suave">El pedido quedó vacío.</li>}
      </ul>

      <form onSubmit={agregar} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="ev-comida" className="sr-only">
          Sumar comida
        </label>
        <select id="ev-comida" className="campo flex-1" value={seleccion} onChange={(e) => setSeleccion(e.target.value)}>
          <option value="">Sumar una comida al pedido…</option>
          {entradas.map((e) => (
            <option key={e.valor} value={e.valor}>
              {e.nombre} · {formatearPrecio(e.precio)}
              {e.comida.activo ? "" : " (inactiva)"}
            </option>
          ))}
        </select>
        <button type="submit" className="boton-secundario shrink-0">
          <IconoMas className="size-4" /> Sumar
        </button>
      </form>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ev-cliente" className="etiqueta">
            Cliente
          </label>
          <input id="ev-cliente" className="campo" maxLength={80} value={cliente} onChange={(e) => setCliente(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ev-nota" className="etiqueta">
            Nota (entrega, dirección, aclaraciones)
          </label>
          <textarea
            id="ev-nota"
            className="campo resize-none"
            rows={2}
            maxLength={300}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borde pt-4">
        <span className="text-lg font-bold">Total: {formatearPrecio(total)}</span>
        <div className="flex gap-2">
          <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button type="button" className="boton-primario" onClick={guardar} disabled={guardando || vacio}>
            {guardando ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
      <p className="text-xs text-tinta-suave">
        Lo que ya estaba en el pedido mantiene su precio. Lo que sumes se cobra al precio actual del menú.
      </p>
    </div>
  );
}

export default function EditarVenta({ venta, comidas, onCerrar, onGuardada }) {
  return (
    <Modal abierto={Boolean(venta)} onCerrar={onCerrar} titulo={venta ? `Editar pedido #${venta.numero}` : ""} ancho="max-w-xl">
      {venta && <Editor key={venta.id} venta={venta} comidas={comidas} onCerrar={onCerrar} onGuardada={onGuardada} />}
    </Modal>
  );
}
