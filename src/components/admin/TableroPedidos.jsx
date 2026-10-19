import { formatearPrecio } from "../../lib/formato";
import {
  IconoBasura,
  IconoCampana,
  IconoCheck,
  IconoCocina,
  IconoEditar,
  IconoFlechaDerecha,
  IconoImpresora,
  IconoMoto,
  IconoOjo,
  IconoRecibo,
  IconoReloj,
  IconoWhatsApp,
} from "../ui/Iconos";
import { ESTADOS, ESTADOS_ABIERTOS, esEnvio, nombreEstado, siguientePaso, tiempoDesde } from "./ventasUtils";

// Minutos que puede esperar un pedido en cada estado antes de marcarse como demorado
const ESPERA_MAXIMA = { pendiente: 5, en_preparacion: 40, enviado: 40, entregado: 20 };

const COLUMNAS = [
  { estado: "pendiente", titulo: "Nuevos", ayuda: "Confirmalos y avisale al cliente", Icono: IconoCampana },
  { estado: "en_preparacion", titulo: "En preparación", ayuda: "En la cocina", Icono: IconoCocina },
  { estado: "enviado", titulo: "En camino / listos", ayuda: "Delivery, retiro o servido", Icono: IconoMoto },
  { estado: "entregado", titulo: "Entregados", ayuda: "Falta cobrar y cerrar la cuenta", Icono: IconoCheck },
];

const PASOS_CORTOS = { pendiente: "Nuevo", en_preparacion: "Cocina", enviado: "Camino", entregado: "Entregado" };

const PLANTILLA_POR_ESTADO = { pendiente: "recibido", en_preparacion: "confirmado", enviado: "en_camino", entregado: "en_camino" };

// Puntos del recorrido: los pasos hechos quedan pintados y el actual se anima
function Recorrido({ venta }) {
  const actual = ESTADOS_ABIERTOS.indexOf(venta.estado);
  const color = ESTADOS[venta.estado].color;
  return (
    <div aria-label={`Estado: ${nombreEstado(venta)}`}>
      <div className="relative flex items-center justify-between">
        <div className="absolute inset-x-2 top-1/2 h-1 -translate-y-1/2 rounded-full bg-borde" />
        <div
          className="absolute left-2 top-1/2 h-1 -translate-y-1/2 rounded-full transition-[width] duration-700"
          style={{ width: `calc((100% - 1rem) * ${actual / (ESTADOS_ABIERTOS.length - 1)})`, background: color }}
        />
        {ESTADOS_ABIERTOS.map((e, i) => (
          <span
            key={e}
            className={`relative z-10 grid size-5 place-items-center rounded-full border-2 text-[10px] font-bold ${
              i < actual ? "text-white" : i === actual ? "animate-pop text-white" : "border-borde bg-papel text-tinta-suave"
            }`}
            style={i <= actual ? { background: color, borderColor: color } : undefined}
          >
            {i < actual ? <IconoCheck className="size-3" /> : i + 1}
          </span>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-medium text-tinta-suave">
        {ESTADOS_ABIERTOS.map((e) => (
          <span key={e} className={e === venta.estado ? "text-tinta" : ""}>
            {PASOS_CORTOS[e]}
          </span>
        ))}
      </div>
    </div>
  );
}

// Animación propia de cada estado, para ver de un vistazo en qué está cada pedido
function IndicadorEstado({ venta }) {
  if (venta.estado === "en_preparacion") {
    return (
      <div className="h-2 overflow-hidden rounded-full bg-amber-100" aria-hidden="true">
        <div className="progreso-rayas animate-rayas h-full w-full rounded-full bg-amber-500" />
      </div>
    );
  }
  if (venta.estado === "enviado") {
    return (
      <div className="relative h-5 rounded-full bg-sky-100" aria-hidden="true">
        <span className="animate-recorrido absolute top-0 grid size-5 place-items-center rounded-full bg-sky-600 text-white">
          <IconoMoto className="size-3.5" />
        </span>
      </div>
    );
  }
  return null;
}

function Accion({ onClick, etiqueta, children, peligro = false, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={etiqueta}
      aria-label={etiqueta}
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-tinta-suave hover:bg-borde disabled:opacity-50 ${
        peligro ? "hover:text-rojo" : "hover:text-tinta"
      }`}
    >
      {children}
    </button>
  );
}

function TarjetaPedido({ venta, ahora, procesando, onAvanzar, onCobrar, onVer, onEditar, onCancelar, onAvisar, onImprimir }) {
  const minutos = (ahora - new Date(venta.created_at).getTime()) / 60000;
  const demorado = minutos > (ESPERA_MAXIMA[venta.estado] ?? 60) + (venta.estado === "pendiente" ? 0 : 20);
  const paso = siguientePaso(venta);
  const nuevo = venta.estado === "pendiente";
  const entregado = venta.estado === "entregado";
  const colorPaso = paso ? ESTADOS[paso.estado].color : undefined;
  const entrega = venta.origen === "manual" ? (venta.cliente_nombre ? "En el local" : "Mostrador") : esEnvio(venta) ? "Envío" : "Retira";

  return (
    <li
      className={`tarjeta animate-entrar flex flex-col gap-3 border-l-4 p-3.5 shadow-sm ${nuevo ? "animate-latido" : ""}`}
      style={{ borderLeftColor: ESTADOS[venta.estado].color }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span className="text-2xl font-bold leading-none">#{venta.numero}</span>
            {nuevo && (
              <span className="animate-respirar rounded-full bg-brasa px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Nuevo
              </span>
            )}
          </p>
          <p className="mt-1 truncate text-sm font-semibold">{venta.cliente_nombre || "Sin nombre"}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <span className={`inline-flex items-center gap-1 text-xs ${demorado ? "font-bold text-rojo" : "text-tinta-suave"}`}>
            <IconoReloj className="size-3.5" /> {tiempoDesde(venta.created_at, ahora)}
          </span>
          <span className="rounded-full bg-fondo px-2 py-0.5 text-[11px] font-medium text-tinta-suave">
            {venta.origen === "manual" ? "Caja" : "Web"} · {entrega}
          </span>
        </div>
      </div>

      {demorado && (
        <p className="rounded-lg bg-rojo/10 px-2 py-1 text-xs font-semibold text-rojo">
          {nuevo ? "Sin confirmar: el cliente está esperando respuesta" : `Demorado: ${nombreEstado(venta).toLowerCase()} hace rato`}
        </p>
      )}

      <Recorrido venta={venta} />
      <IndicadorEstado venta={venta} />

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
          <span className="cifras text-xl font-bold">{formatearPrecio(venta.total)}</span>
        </div>

        {paso &&
          (entregado ? (
            <button
              type="button"
              onClick={() => onCobrar(venta)}
              disabled={procesando}
              className="boton reflejo animate-brillo w-full bg-emerald-600 py-3 text-base text-white shadow-md hover:bg-emerald-700"
            >
              <IconoCheck className="size-5" /> {paso.texto}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onAvanzar(venta, paso.estado)}
              disabled={procesando}
              className="boton w-full py-3 text-base text-white shadow-md hover:brightness-95"
              style={{ background: colorPaso }}
            >
              {paso.texto} <IconoFlechaDerecha className="size-5" />
            </button>
          ))}

        {!entregado && (
          <button
            type="button"
            className="w-full rounded-lg py-1 text-xs font-medium text-emerald-800 underline-offset-2 hover:underline"
            onClick={() => onCobrar(venta)}
            disabled={procesando}
          >
            Ya pagó: cobrar ahora
          </button>
        )}

        <div className="flex flex-wrap items-center justify-between gap-0.5">
          {venta.origen === "web" && (
            <Accion onClick={() => onAvisar(venta, PLANTILLA_POR_ESTADO[venta.estado])} etiqueta="Avisar al cliente por WhatsApp">
              <IconoWhatsApp className="size-4 text-whatsapp-oscuro" /> Avisar
            </Accion>
          )}
          <Accion onClick={() => onImprimir(venta, "comanda")} etiqueta="Imprimir comanda para la cocina">
            <IconoImpresora className="size-4" /> Comanda
          </Accion>
          <Accion onClick={() => onImprimir(venta, "ticket")} etiqueta="Imprimir ticket para el cliente">
            <IconoRecibo className="size-4" /> Ticket
          </Accion>
          <Accion onClick={() => onVer(venta)} etiqueta={`Ver la cuenta #${venta.numero}`}>
            <IconoOjo className="size-4" />
          </Accion>
          <Accion onClick={() => onEditar(venta)} etiqueta={`Editar pedido #${venta.numero}`} disabled={procesando}>
            <IconoEditar className="size-4" />
          </Accion>
          <Accion onClick={() => onCancelar(venta)} etiqueta={`Cancelar pedido #${venta.numero}`} disabled={procesando} peligro>
            <IconoBasura className="size-4" />
          </Accion>
        </div>
      </div>
    </li>
  );
}

// Tablero de pedidos sin cobrar, de cualquier fecha: una columna por estado
export default function TableroPedidos({ pedidos, cargando, error, ahora, ...acciones }) {
  return (
    <section className="space-y-3" aria-labelledby="tablero-titulo">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="tablero-titulo" className="text-lg font-bold">
          Pedidos en curso{" "}
          <span className="ml-1 rounded-full bg-tinta px-2.5 py-0.5 text-sm text-fondo">{pedidos.length}</span>
        </h2>
        <p className="text-xs text-tinta-suave">Cada pedido avanza con un solo botón. Los cancelados se eliminan solos.</p>
      </div>

      {cargando ? (
        <p className="tarjeta py-8 text-center text-sm text-tinta-suave">Cargando pedidos…</p>
      ) : error ? (
        <p className="tarjeta py-8 text-center text-sm text-brasa">No pudimos cargar los pedidos en curso.</p>
      ) : pedidos.length === 0 ? (
        <p className="tarjeta py-8 text-center text-sm text-tinta-suave">Todo al día: no hay pedidos sin cobrar.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNAS.map(({ estado, titulo, ayuda, Icono }) => {
            const lista = pedidos.filter((p) => p.estado === estado);
            const alerta = estado === "pendiente" && lista.length > 0;
            return (
              <div key={estado} className="flex min-w-0 flex-col gap-2 rounded-2xl bg-borde/40 p-2">
                <div
                  className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-white"
                  style={{ background: ESTADOS[estado].color }}
                >
                  <span className="flex items-center gap-2 text-sm font-bold">
                    <Icono className={`size-4 ${alerta ? "animate-timbre" : ""}`} /> {titulo}
                  </span>
                  <span className="grid min-w-6 place-items-center rounded-full bg-white/25 px-1.5 text-xs font-bold">{lista.length}</span>
                </div>
                <p className="px-1 text-[11px] text-tinta-suave">{ayuda}</p>
                {lista.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-borde px-3 py-6 text-center text-xs text-tinta-suave">Sin pedidos</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {lista.map((v) => (
                      <TarjetaPedido key={v.id} venta={v} ahora={ahora} {...acciones} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
