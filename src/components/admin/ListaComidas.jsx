import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { borrarImagen, urlImagen } from "../../lib/imagenes";
import { formatearPrecio, normalizarTexto } from "../../lib/formato";
import { IconoBasura, IconoBuscar, IconoEditar, IconoEstrella, IconoMas } from "../ui/Iconos";
import Cargando from "../ui/Cargando";
import Confirmar from "../ui/Confirmar";
import FormComida from "./FormComida";
import { ESTADOS_STOCK, estadoStock, idsDeKiosco } from "./ventasUtils";
import { useRol } from "../../hooks/useRol";

function Interruptor({ activo, onCambiar, etiqueta, bloqueado = false, motivo }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      aria-disabled={bloqueado || undefined}
      title={bloqueado ? motivo : undefined}
      onClick={bloqueado ? () => toast.error(motivo) : onCambiar}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${activo ? "bg-palmera" : "bg-borde"} ${bloqueado ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-tinta transition-all ${activo ? "left-5.5" : "left-0.5"}`}
      />
    </button>
  );
}

export default function ListaComidas({ turno = "noche", comidas, categorias, cargando, onCambio }) {
  const conCarta = turno === "noche";
  const { esDueno } = useRol();
  const [busqueda, setBusqueda] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [soloSinPrecio, setSoloSinPrecio] = useState(false);
  const [editando, setEditando] = useState(null); // null | "nueva" | comida
  const [aBorrar, setABorrar] = useState(null);
  const [borrando, setBorrando] = useState(false);

  const nombreCategoria = useMemo(() => new Map(categorias.map((c) => [c.id, c.nombre])), [categorias]);
  const kiosco = useMemo(() => idsDeKiosco(categorias, comidas), [categorias, comidas]);

  // Platos cargados sin precio (por ejemplo la lista del mediodía): el dueño se lo pone
  const sinPrecio = useMemo(() => comidas.filter((c) => c.precio == null).length, [comidas]);
  const verSinPrecio = soloSinPrecio && sinPrecio > 0;

  const filtradas = useMemo(() => {
    const texto = normalizarTexto(busqueda);
    return comidas.filter(
      (c) =>
        (!categoriaFiltro || c.categoria_id === categoriaFiltro) &&
        (!texto || normalizarTexto(c.nombre).includes(texto)) &&
        (!verSinPrecio || c.precio == null)
    );
  }, [comidas, busqueda, categoriaFiltro, verSinPrecio]);

  async function actualizar(comida, cambios, mensaje) {
    const { error } = await supabase.from("comidas").update(cambios).eq("id", comida.id);
    if (error) {
      toast.error(mensajeDeError(error, "No se pudo guardar el cambio."));
    } else {
      toast.success(mensaje);
    }
    onCambio();
  }

  async function borrar() {
    if (!aBorrar) return;
    setBorrando(true);
    const { error } = await supabase.from("comidas").delete().eq("id", aBorrar.id);
    setBorrando(false);
    if (error) {
      toast.error(mensajeDeError(error, "No se pudo borrar la comida."));
      return;
    }
    await borrarImagen(aBorrar.imagen_url, aBorrar.imagen_path);
    toast.success(`Borraste "${aBorrar.nombre}"`);
    setABorrar(null);
    onCambio();
  }

  if (cargando) return <Cargando texto="Cargando comidas…" />;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {conCarta ? "Comidas de la carta" : "Platos del mediodía"} ({comidas.length})
          </h1>
          <p className="text-sm text-tinta-suave">
            {conCarta
              ? "Son las que se ven en la carta online. Las inactivas quedan ocultas."
              : "Uso interno: no aparecen en la carta online y no llevan foto."}
          </p>
        </div>
        {esDueno ? (
        <button
          type="button"
          className="boton-primario"
          onClick={() => setEditando("nueva")}
          disabled={categorias.length === 0}
          title={categorias.length === 0 ? "Primero creá una categoría" : undefined}
        >
          <IconoMas className="size-4" /> {conCarta ? "Nueva comida" : "Nuevo plato"}
        </button>
        ) : (
          <p className="max-w-xs text-xs text-tinta-suave">Los productos y los precios los cambia el dueño. Vos marcás si hay o no hay.</p>
        )}
      </div>

      {sinPrecio > 0 && (
        <div className="tarjeta flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-brasa p-3 text-sm">
          <p>
            <span className="font-semibold">
              {sinPrecio === 1 ? "1 plato todavía no tiene precio." : `${sinPrecio} platos todavía no tienen precio.`}
            </span>{" "}
            <span className="text-tinta-suave">
              {esDueno
                ? "Tocá Editar, poné el precio y guardá: ahí queda disponible para vender."
                : "Hasta que el dueño les ponga precio no se pueden vender."}
            </span>
          </p>
          <button type="button" className="boton-secundario px-3 py-2" onClick={() => setSoloSinPrecio(!verSinPrecio)}>
            {verSinPrecio ? "Ver todos" : "Ver solo los sin precio"}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Buscar comida</span>
          <IconoBuscar className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-suave" />
          <input
            type="search"
            className="campo pl-9"
            placeholder="Buscar por nombre…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </label>
        <select
          className="campo sm:w-56"
          value={categoriaFiltro}
          onChange={(e) => setCategoriaFiltro(e.target.value)}
          aria-label="Filtrar por categoría"
        >
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>

      {filtradas.length === 0 ? (
        <div className="tarjeta p-8 text-center text-tinta-suave">
          {comidas.length === 0 ? (conCarta ? "Todavía no cargaste comidas." : "Todavía no cargaste platos del mediodía. Creá una categoría y después los platos.") : "No hay comidas con ese filtro."}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtradas.map((c) => (
            <li
              key={c.id}
              className={`tarjeta grid items-center gap-x-3 gap-y-3 p-3 ${
                conCarta
                  ? "grid-cols-[56px_1fr] lg:grid-cols-[56px_minmax(0,1fr)_160px_120px_90px_auto]"
                  : "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_160px_110px_auto]"
              } ${c.activo ? "" : "opacity-60"}`}
            >
              {!conCarta ? null : c.imagen_url ? (
                <img
                  src={urlImagen(c.imagen_url, { ancho: 112, proporcion: "1:1" })}
                  alt={c.nombre}
                  className="size-14 rounded-lg object-cover object-center"
                  loading="lazy"
                />
              ) : (
                <div className="grid size-14 place-items-center rounded-lg bg-borde text-center text-[10px] text-tinta-suave">
                  Sin imagen
                </div>
              )}

              <div className="min-w-0">
                <p className="flex items-center gap-1 truncate font-semibold">
                  {c.destacado && <IconoEstrella className="size-3.5 shrink-0 text-palmera" />}
                  <span className="truncate">{c.nombre}</span>
                </p>
                <p className="text-xs text-tinta-suave">
                  {nombreCategoria.get(c.categoria_id) ?? "Sin categoría"}
                  {kiosco.has(c.id) && (
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 font-semibold ${ESTADOS_STOCK[estadoStock(c)]?.clase ?? "bg-borde text-tinta-suave"}`}
                    >
                      {c.stock == null ? "Stock sin cargar" : c.stock <= 0 ? `Sin stock (${c.stock})` : `Stock: ${c.stock}`}
                    </span>
                  )}
                </p>
              </div>

              <div className="col-span-2 text-sm lg:col-span-1">
                {c.precio == null ? (
                  <span className="rounded-full bg-brasa/15 px-2 py-0.5 text-xs font-semibold text-brasa">Sin precio</span>
                ) : (
                <span className={c.precio_promo ? "text-xs text-tinta-suave line-through" : "font-semibold"}>
                  {formatearPrecio(c.precio)}
                </span>
                )}
                {c.precio_promo && (
                  <span className="ml-2 font-semibold text-brasa">{formatearPrecio(c.precio_promo)}</span>
                )}
              </div>

              {conCarta && (
              <label className={`flex items-center gap-2 text-xs text-tinta-suave ${esDueno ? "" : "invisible"}`}>
                <Interruptor
                  activo={c.destacado}
                  etiqueta={`Destacado: ${c.nombre}`}
                  onCambiar={() =>
                    actualizar(c, { destacado: !c.destacado }, c.destacado ? "Ya no es destacado" : "Marcado como destacado")
                  }
                />
                Destacado
              </label>
              )}

              <label className="flex items-center gap-2 text-xs text-tinta-suave">
                <Interruptor
                  activo={c.activo}
                  etiqueta={`Activo: ${c.nombre}`}
                  bloqueado={c.precio == null}
                  motivo={esDueno ? "Primero ponele precio: tocá Editar." : "Todavía no tiene precio: se lo pone el dueño."}
                  onCambiar={() =>
                    actualizar(
                      c,
                      { activo: !c.activo },
                      conCarta
                        ? c.activo ? "Oculta en el catálogo" : "Visible en el catálogo"
                        : c.activo ? "Marcado como no disponible" : "Disponible para vender"
                    )
                  }
                />
                {conCarta ? "Activo" : "Disponible"}
              </label>

              <div className={`flex justify-end gap-2 lg:col-span-1 ${conCarta ? "col-span-2" : ""} ${esDueno ? "" : "invisible"}`}>
                <button type="button" className="boton-secundario px-3 py-2" onClick={() => setEditando(c)}>
                  <IconoEditar className="size-4" /> Editar
                </button>
                <button
                  type="button"
                  className="boton-secundario px-3 py-2 hover:text-brasa"
                  onClick={() => setABorrar(c)}
                  aria-label={`Borrar ${c.nombre}`}
                >
                  <IconoBasura className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editando && (
        <FormComida
          comida={editando === "nueva" ? null : editando}
          categorias={categorias}
          turno={turno}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            onCambio();
          }}
        />
      )}

      <Confirmar
        abierto={Boolean(aBorrar)}
        titulo="Borrar comida"
        mensaje={`¿Seguro que querés borrar "${aBorrar?.nombre ?? ""}"?${conCarta ? " También se borra su imagen." : " También sale del cronograma del menú."} Las ventas anteriores se conservan. Si solo querés ocultarla (por ejemplo, si hoy no hay), desactivala.`}
        textoConfirmar="Borrar"
        procesando={borrando}
        onConfirmar={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </section>
  );
}
