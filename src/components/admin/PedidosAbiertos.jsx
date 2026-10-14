import { formatearPrecio } from "../../lib/formato";
import { IconoBasura, IconoEditar, IconoOjo, IconoReloj } from "../ui/Iconos";
import { BotonCerrar, SelectorEstado } from "./EstadoPedido";
import { tiempoDesde } from "./ventasUtils";

// Un pedido abierto hace más de esto se marca como demorado
const MINUTOS_DEMORADO = 90;

function Accion({ onClick, children, peligro = false, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-tinta-suave hover:bg-borde disabled:opacity-50 ${
        peligro ? "hover:text-rojo" : "hover:text-tinta"
      }`}
    >
      {children}
    </button>
  );
}

function TarjetaPedido({ venta, ahora, procesando, onEstado, onCerrar, onVer, onEditar, onBorrar }) {
  const minutos = (ahora - new Date(venta.created_at).getTime()) / 60000;
  const demorado = minutos > MINUTOS_DEMORADO;
  const nuevo = venta.estado === "pendiente";

  return (
    <li
      className={`tarjeta flex flex-col gap-3 p-4 shadow-sm ${
        venta.estado === "entregado"
          ? "border-2 border-emerald-500"
          : nuevo
            ? "border-2 border-brasa"
            : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-2xl font-bold leading-none">#{venta.numero}</p>
          <p className="mt-1 truncate text-sm font-medium">{venta.cliente_nombre || "Sin nombre"}</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          {nuevo && (
            <span className="rounded-full bg-brasa px-2 py-0.5 text-[11px] font-bold uppercase text-white">Nuevo</span>
          )}
          <span
            className={`inline-flex items-center gap-1 text-xs ${demorado ? "font-semibold text-rojo" : "text-tinta-suave"}`}
          >
            <IconoReloj className="size-3.5" /> {tiempoDesde(venta.created_at, ahora)}
          </span>
          <span className="text-[11px] text-tinta-suave">{venta.origen === "manual" ? "En el local" : "Web"}</span>
        </div>
      </div>

      <ul className="space-y-0.5 text-sm">
        {venta.venta_items.map((i) => (
          <li key={i.id}>
            <strong>{i.cantidad}x</strong> {i.nombre}
            {i.detalle && <span className="block pl-5 text-xs text-tinta-suave">{i.detalle}</span>}
          </li>
        ))}
      </ul>

      {venta.nota && <p className="rounded-lg bg-fondo px-2.5 py-2 text-xs whitespace-pre-line">{venta.nota}</p>}

      <div className="mt-auto space-y-2 border-t border-borde pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-tinta-suave">Total</span>
          <span className="text-xl font-bold">{formatearPrecio(venta.total)}</span>
        </div>
        <div>
          <span className="etiqueta">Estado del pedido</span>
          <SelectorEstado venta={venta} onCambiar={onEstado} disabled={procesando} grande />
        </div>
        <BotonCerrar venta={venta} onCerrar={onCerrar} disabled={procesando} />
        <div className="flex flex-wrap justify-between gap-1">
          <Accion onClick={() => onVer(venta)}>
            <IconoOjo className="size-4" /> Ver
          </Accion>
          <Accion onClick={() => onEditar(venta)} disabled={procesando}>
            <IconoEditar className="size-4" /> Editar
          </Accion>
          <Accion onClick={() => onBorrar(venta)} disabled={procesando} peligro>
            <IconoBasura className="size-4" /> Borrar
          </Accion>
        </div>
      </div>
    </li>
  );
}

// Pedidos que falta cerrar, de cualquier fecha: el más viejo primero
export default function PedidosAbiertos({ pedidos, cargando, error, ahora, ...acciones }) {
  const porCerrar = pedidos.filter((p) => p.estado === "entregado").length;
  return (
    <section className="space-y-3 rounded-2xl border-2 border-palmera/40 bg-palmera/5 p-3 sm:p-4" aria-labelledby="abiertos-titulo">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="abiertos-titulo" className="text-lg font-bold">
          Pedidos sin cerrar{" "}
          <span className="ml-1 rounded-full bg-palmera px-2.5 py-0.5 text-sm text-white">{pedidos.length}</span>
        </h2>
        {porCerrar > 0 && (
          <p className="text-sm font-semibold text-emerald-800">
            {porCerrar === 1 ? "1 pedido entregado espera" : `${porCerrar} pedidos entregados esperan`} que lo cierren
          </p>
        )}
      </div>

      {cargando ? (
        <p className="py-6 text-center text-sm text-tinta-suave">Cargando pedidos…</p>
      ) : error ? (
        <p className="py-6 text-center text-sm text-brasa">No pudimos cargar los pedidos abiertos.</p>
      ) : pedidos.length === 0 ? (
        <p className="py-6 text-center text-sm text-tinta-suave">Todo al día: no hay pedidos sin cerrar. 🎉</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pedidos.map((v) => (
            <TarjetaPedido key={v.id} venta={v} ahora={ahora} {...acciones} />
          ))}
        </ul>
      )}
    </section>
  );
}
