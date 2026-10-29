import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { formatearFechaHora } from "../../lib/formato";
import { descargarExcel } from "../../lib/excel";
import { nombreUsuario, useRol } from "../../hooks/useRol";
import { IconoBasura, IconoEditar, IconoExcel, IconoMas } from "../ui/Iconos";
import Cargando from "../ui/Cargando";
import Modal from "../ui/Modal";
import { ESTADOS_STOCK, estadoStock, idsDeKiosco } from "./ventasUtils";

const TIPOS = {
  venta: { nombre: "Venta", clase: "text-tinta-suave" },
  devolucion: { nombre: "Devolución", clase: "text-sky-800" },
  ingreso: { nombre: "Entró mercadería", clase: "text-emerald-800" },
  ajuste: { nombre: "Ajuste (conteo)", clase: "text-amber-900" },
};

const LIMITE_HISTORIAL = 300;

function Insignia({ comida }) {
  const estado = estadoStock(comida);
  return (
    <span className={`cifras rounded-full px-2.5 py-0.5 text-xs font-bold ${ESTADOS_STOCK[estado]?.clase ?? "bg-borde text-tinta-suave"}`}>
      {comida.stock ?? "sin cargar"}
    </span>
  );
}

// Entra mercadería: varias líneas (producto + cantidad) y una nota (proveedor, remito)
function CargarMercaderia({ productos, inicial, onCerrar, onCargada }) {
  const [lineas, setLineas] = useState(() => [{ comidaId: inicial ?? "", cantidad: "" }]);
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const setLinea = (i, cambios) => setLineas((prev) => prev.map((l, j) => (j === i ? { ...l, ...cambios } : l)));

  async function guardar(e) {
    e.preventDefault();
    const items = lineas.filter((l) => l.comidaId || l.cantidad);
    if (items.length === 0) return toast.error("Agregá al menos un producto.");
    if (items.some((l) => !l.comidaId || !(Number.isInteger(Number(l.cantidad)) && Number(l.cantidad) > 0))) {
      return toast.error("Elegí el producto y poné una cantidad entera en cada línea.");
    }
    setGuardando(true);
    const { error } = await supabase.rpc("cargar_mercaderia", {
      items: items.map((l) => ({ comida_id: l.comidaId, cantidad: Number(l.cantidad) })),
      nota: nota.trim() || null,
    });
    setGuardando(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo cargar la mercadería."));
    toast.success(items.length === 1 ? "Mercadería cargada" : `Mercadería cargada: ${items.length} productos`);
    onCargada();
  }

  return (
    <form onSubmit={guardar} className="space-y-4" noValidate>
      <p className="text-sm text-tinta-suave">Lo que cargues se suma al stock que ya hay.</p>
      <ul className="space-y-2">
        {lineas.map((l, i) => (
          <li key={i} className="grid grid-cols-[1fr_96px_auto] items-center gap-2">
            <select className="campo" value={l.comidaId} onChange={(e) => setLinea(i, { comidaId: e.target.value })} aria-label="Producto">
              <option value="">Elegí el producto…</option>
              {productos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} (hay {c.stock ?? 0})
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              className="campo cifras"
              placeholder="Cant."
              value={l.cantidad}
              onChange={(e) => setLinea(i, { cantidad: e.target.value })}
              aria-label="Cantidad que entró"
            />
            <button
              type="button"
              className="rounded p-2 text-tinta-suave hover:bg-borde hover:text-rojo disabled:opacity-30"
              onClick={() => setLineas((prev) => prev.filter((_, j) => j !== i))}
              disabled={lineas.length === 1}
              aria-label="Quitar línea"
            >
              <IconoBasura className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="boton-secundario px-3 py-2 text-xs" onClick={() => setLineas((prev) => [...prev, { comidaId: "", cantidad: "" }])}>
        <IconoMas className="size-4" /> Otro producto
      </button>
      <label className="block">
        <span className="etiqueta">Nota (opcional)</span>
        <input className="campo" maxLength={200} placeholder="Ej.: proveedor, número de remito" value={nota} onChange={(e) => setNota(e.target.value)} />
      </label>
      <div className="flex justify-end gap-2 border-t border-borde pt-4">
        <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </button>
        <button type="submit" className="boton-primario" disabled={guardando}>
          {guardando ? "Cargando…" : "Cargar mercadería"}
        </button>
      </div>
    </form>
  );
}

// Solo dueño: corrige el stock con lo que se contó
function Ajustar({ comida, onCerrar, onAjustado }) {
  const [real, setReal] = useState(String(Math.max(comida.stock ?? 0, 0)));
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const diferencia = Number(real) - (comida.stock ?? 0);

  async function guardar(e) {
    e.preventDefault();
    if (real === "" || !Number.isInteger(Number(real)) || Number(real) < 0) return toast.error("Poné la cantidad que contaste (0 o más).");
    setGuardando(true);
    const { error } = await supabase.rpc("ajustar_stock", { comida_id: comida.id, stock_real: Number(real), nota: nota.trim() || null });
    setGuardando(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo ajustar el stock."));
    toast.success(`Stock de ${comida.nombre}: ${real}`);
    onAjustado();
  }

  return (
    <form onSubmit={guardar} className="space-y-4" noValidate>
      <p className="text-sm">
        Según el sistema hay <strong>{comida.stock ?? "sin cargar"}</strong>. Poné lo que contaste: la diferencia queda en el historial.
      </p>
      <label className="block">
        <span className="etiqueta">Hay de verdad</span>
        <input type="number" min="0" step="1" inputMode="numeric" className="campo cifras sm:w-40" value={real} onChange={(e) => setReal(e.target.value)} />
      </label>
      {real !== "" && diferencia !== 0 && (
        <p className={`text-sm font-semibold ${diferencia < 0 ? "text-brasa" : "text-emerald-800"}`}>
          {diferencia < 0 ? `Faltan ${-diferencia} unidades` : `Sobran ${diferencia} unidades`}
        </p>
      )}
      <label className="block">
        <span className="etiqueta">Motivo (opcional)</span>
        <input className="campo" maxLength={200} placeholder="Ej.: conteo del lunes, se rompieron 2" value={nota} onChange={(e) => setNota(e.target.value)} />
      </label>
      <div className="flex justify-end gap-2 border-t border-borde pt-4">
        <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </button>
        <button type="submit" className="boton-primario" disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar ajuste"}
        </button>
      </div>
    </form>
  );
}

// Stock de bebidas y golosinas del turno: lo que hay, avisos, carga de
// mercadería, ajustes (dueño) e historial de movimientos.
export default function Stock({ turno, comidas, categorias, cargando, actualizacion = 0, onCambio }) {
  const { esDueno } = useRol();
  const [cargar, setCargar] = useState(null); // null | { inicial }
  const [ajustar, setAjustar] = useState(null);
  const [filtro, setFiltro] = useState("");
  const [vuelta, setVuelta] = useState(0);
  const [historial, setHistorial] = useState({ clave: null, filas: [], error: null });

  const kiosco = useMemo(() => idsDeKiosco(categorias, comidas), [categorias, comidas]);
  const productos = useMemo(
    () =>
      comidas
        .filter((c) => kiosco.has(c.id))
        .sort((a, b) => {
          const orden = { sin: 0, bajo: 1, ok: 2 };
          return (orden[estadoStock(a)] ?? 3) - (orden[estadoStock(b)] ?? 3) || a.nombre.localeCompare(b.nombre, "es");
        }),
    [comidas, kiosco]
  );
  const nombreCategoria = useMemo(() => new Map(categorias.map((c) => [c.id, c.nombre])), [categorias]);
  const bajos = productos.filter((c) => estadoStock(c) === "bajo").length;
  const sin = productos.filter((c) => estadoStock(c) === "sin").length;

  const ids = productos.map((c) => c.id).join(",");
  const clave = `${ids}-${filtro}-${vuelta}-${actualizacion}`;
  useEffect(() => {
    if (!ids) return;
    let activo = true;
    let consulta = supabase.from("stock_movimientos").select("*").order("created_at", { ascending: false }).limit(LIMITE_HISTORIAL);
    consulta = filtro ? consulta.eq("comida_id", filtro) : consulta.in("comida_id", ids.split(","));
    consulta.then(({ data, error }) => activo && setHistorial({ clave, filas: data ?? [], error }));
    return () => {
      activo = false;
    };
  }, [ids, filtro, clave]);

  const listo = () => {
    setCargar(null);
    setAjustar(null);
    setVuelta((n) => n + 1);
    onCambio();
  };

  function exportar() {
    const titulo = `Stock ${turno === "noche" ? "noche" : "mediodía"}`;
    descargarExcel(`stock-${turno}-${new Date().toISOString().slice(0, 10)}`, [
      {
        nombre: "Stock",
        titulo,
        subtitulo: `Al ${formatearFechaHora(new Date())}`,
        columnas: [
          { titulo: "Producto", clave: "nombre", ancho: 32 },
          { titulo: "Categoría", ancho: 16, valor: (c) => nombreCategoria.get(c.categoria_id) ?? "" },
          { titulo: "Stock", clave: "stock", tipo: "entero", ancho: 10 },
          { titulo: "Avisar con", clave: "stock_minimo", tipo: "entero", ancho: 12 },
          { titulo: "Estado", ancho: 14, valor: (c) => ESTADOS_STOCK[estadoStock(c)]?.nombre ?? "Sin cargar" },
        ],
        filas: productos,
      },
      {
        nombre: "Movimientos",
        titulo: `${titulo} · movimientos`,
        subtitulo: `Últimos ${historial.filas.length}`,
        columnas: [
          { titulo: "Fecha y hora", clave: "created_at", tipo: "fechaHora", ancho: 17 },
          { titulo: "Producto", clave: "nombre", ancho: 30 },
          { titulo: "Movimiento", ancho: 18, valor: (m) => TIPOS[m.tipo]?.nombre ?? m.tipo },
          { titulo: "Cantidad", clave: "cantidad", tipo: "entero", ancho: 10 },
          { titulo: "Quedó", clave: "stock_resultante", tipo: "entero", ancho: 10 },
          { titulo: "Venta N°", clave: "venta_numero", tipo: "entero", ancho: 10 },
          { titulo: "Quién", ancho: 16, valor: (m) => nombreUsuario(m.usuario) },
          { titulo: "Nota", clave: "nota", ancho: 32 },
        ],
        filas: historial.filas,
      },
    ]).catch(() => toast.error("No se pudo armar el Excel."));
  }

  if (cargando) return <Cargando texto="Cargando stock…" />;

  if (productos.length === 0) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-6 text-center text-sm text-tinta-suave">
        <p className="font-semibold text-tinta">Todavía no hay productos con stock en este turno.</p>
        <p className="mt-1">
          Solo llevan stock las categorías marcadas como <strong>Kiosco</strong> (bebidas y golosinas).
          {esDueno ? " Marcalas en Categorías y cargá ahí sus productos." : " Las marca el dueño en Categorías."}
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Stock de bebidas y golosinas</h1>
          <p className="text-sm text-tinta-suave">Cada venta lo descuenta sola. Cuando llega mercadería, cargala acá.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="boton-secundario" onClick={exportar}>
            <IconoExcel className="size-4" /> Excel
          </button>
          <button type="button" className="boton-primario" onClick={() => setCargar({})}>
            <IconoMas className="size-4" /> Cargar mercadería
          </button>
        </div>
      </div>

      {(sin > 0 || bajos > 0) && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          {sin > 0 && <strong>{sin === 1 ? "1 producto sin stock" : `${sin} productos sin stock`}</strong>}
          {sin > 0 && bajos > 0 && " y "}
          {bajos > 0 && <strong>{bajos === 1 ? "1 con poco stock" : `${bajos} con poco stock`}</strong>}
          . Avisale al dueño o cargá la mercadería cuando llegue.
        </p>
      )}

      <ul className="grid gap-2 md:grid-cols-2">
        {productos.map((c) => (
          <li key={c.id} className={`tarjeta flex items-center justify-between gap-3 p-3 ${c.activo ? "" : "opacity-60"}`}>
            <div className="min-w-0">
              <p className="truncate font-semibold">{c.nombre}</p>
              <p className="text-xs text-tinta-suave">
                {nombreCategoria.get(c.categoria_id)} · avisa con {c.stock_minimo ?? 5}
                {estadoStock(c) && estadoStock(c) !== "ok" && <span className="font-semibold"> · {ESTADOS_STOCK[estadoStock(c)].nombre}</span>}
                {!c.activo && " · marcado que no hay"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Insignia comida={c} />
              <button type="button" className="boton-secundario px-2.5 py-1.5 text-xs" onClick={() => setCargar({ inicial: c.id })} aria-label={`Cargar mercadería de ${c.nombre}`}>
                <IconoMas className="size-4" />
              </button>
              {esDueno && (
                <button type="button" className="boton-secundario px-2.5 py-1.5 text-xs" onClick={() => setAjustar(c)}>
                  <IconoEditar className="size-4" /> Ajustar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Historial de movimientos</h2>
          <select className="campo w-auto" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar por producto">
            <option value="">Todos los productos</option>
            {productos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
        {historial.clave !== clave && historial.filas.length === 0 ? (
          <Cargando texto="Cargando movimientos…" />
        ) : historial.error ? (
          <p className="tarjeta p-4 text-sm text-tinta-suave">{mensajeDeError(historial.error, "No se pudo cargar el historial.")}</p>
        ) : historial.filas.length === 0 ? (
          <p className="tarjeta p-4 text-center text-sm text-tinta-suave">Todavía no hay movimientos.</p>
        ) : (
          <ul className="tarjeta max-h-[32rem] divide-y divide-borde overflow-y-auto px-3">
            {historial.filas.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.nombre}</span>
                  <span className="text-xs text-tinta-suave">
                    {formatearFechaHora(m.created_at)} · <span className={TIPOS[m.tipo]?.clase}>{TIPOS[m.tipo]?.nombre ?? m.tipo}</span>
                    {m.venta_numero && ` #${m.venta_numero}`} · {nombreUsuario(m.usuario)}
                    {m.nota && ` · ${m.nota}`}
                  </span>
                </span>
                <span className="cifras shrink-0 text-right">
                  <span className={`block font-semibold ${m.cantidad < 0 ? "text-brasa" : "text-emerald-700"}`}>
                    {m.cantidad > 0 ? "+" : ""}
                    {m.cantidad}
                  </span>
                  <span className="text-xs text-tinta-suave">quedó {m.stock_resultante}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal abierto={Boolean(cargar)} onCerrar={() => setCargar(null)} titulo="Cargar mercadería" ancho="max-w-lg">
        {cargar && <CargarMercaderia key={cargar.inicial ?? "nueva"} productos={productos} inicial={cargar.inicial} onCerrar={() => setCargar(null)} onCargada={listo} />}
      </Modal>
      <Modal abierto={Boolean(ajustar)} onCerrar={() => setAjustar(null)} titulo={ajustar ? `Ajustar stock · ${ajustar.nombre}` : ""} ancho="max-w-md">
        {ajustar && <Ajustar key={ajustar.id} comida={ajustar} onCerrar={() => setAjustar(null)} onAjustado={listo} />}
      </Modal>
    </section>
  );
}
