import { useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { borrarImagen } from "../../lib/imagenes";
import { formatearPrecio, normalizarTexto } from "../../lib/formato";
import { IconoBasura, IconoBuscar, IconoEditar, IconoEstrella, IconoMas, IconoMenos } from "../ui/Iconos";
import Cargando from "../ui/Cargando";
import Confirmar from "../ui/Confirmar";
import FormComida from "./FormComida";

// Control rápido de stock: – [campo] +
function EditorStock({ comida, onGuardar }) {
  const [valor, setValor] = useState(String(comida.stock));
  const [stockOriginal, setStockOriginal] = useState(comida.stock);

  // Si el stock cambia desde afuera (ej. una venta confirmada), actualizamos el campo
  if (comida.stock !== stockOriginal) {
    setStockOriginal(comida.stock);
    setValor(String(comida.stock));
  }

  // Los botones – y + solo cambian el número en pantalla; el guardado (y el
  // aviso) ocurre una vez, cuando el dueño deja de tocar.
  const temporizador = useRef(null);

  function cambiarCon(delta) {
    const actual = Number(valor);
    const base = Number.isInteger(actual) && actual >= 0 ? actual : comida.stock;
    const nuevo = Math.max(0, base + delta);
    setValor(String(nuevo));
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => confirmar(nuevo), 900);
  }

  function confirmar(nuevo) {
    clearTimeout(temporizador.current);
    const n = Number(nuevo);
    if (!Number.isInteger(n) || n < 0) {
      toast.error("El stock tiene que ser un número entero mayor o igual a 0.");
      setValor(String(comida.stock));
      return;
    }
    if (n !== comida.stock) onGuardar(n);
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="grid size-8 place-items-center rounded-lg bg-borde hover:bg-brasa hover:text-fondo disabled:opacity-40"
        onClick={() => cambiarCon(-1)}
        disabled={Number(valor) <= 0}
        aria-label={`Restar stock de ${comida.nombre}`}
      >
        <IconoMenos className="size-4" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min="0"
        step="1"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onBlur={() => confirmar(valor)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="campo w-16 px-2 py-1.5 text-center"
        aria-label={`Stock de ${comida.nombre}`}
      />
      <button
        type="button"
        className="grid size-8 place-items-center rounded-lg bg-palmera text-fondo hover:bg-palmera-oscuro"
        onClick={() => cambiarCon(1)}
        aria-label={`Sumar stock de ${comida.nombre}`}
      >
        <IconoMas className="size-4" />
      </button>
    </div>
  );
}

function Interruptor({ activo, onCambiar, etiqueta }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      onClick={onCambiar}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${activo ? "bg-palmera" : "bg-borde"}`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-tinta transition-all ${activo ? "left-5.5" : "left-0.5"}`}
      />
    </button>
  );
}

export default function ListaComidas({ comidas, categorias, cargando, onCambio }) {
  const [busqueda, setBusqueda] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [editando, setEditando] = useState(null); // null | "nueva" | comida
  const [aBorrar, setABorrar] = useState(null);
  const [borrando, setBorrando] = useState(false);

  const nombreCategoria = useMemo(() => new Map(categorias.map((c) => [c.id, c.nombre])), [categorias]);

  const filtradas = useMemo(() => {
    const texto = normalizarTexto(busqueda);
    return comidas.filter(
      (c) =>
        (!categoriaFiltro || c.categoria_id === categoriaFiltro) &&
        (!texto || normalizarTexto(c.nombre).includes(texto))
    );
  }, [comidas, busqueda, categoriaFiltro]);

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
    await borrarImagen(aBorrar.imagen_path);
    toast.success(`Borraste "${aBorrar.nombre}"`);
    setABorrar(null);
    onCambio();
  }

  if (cargando) return <Cargando texto="Cargando comidas…" />;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Comidas ({comidas.length})</h1>
        <button
          type="button"
          className="boton-primario"
          onClick={() => setEditando("nueva")}
          disabled={categorias.length === 0}
          title={categorias.length === 0 ? "Primero creá una categoría" : undefined}
        >
          <IconoMas className="size-4" /> Nueva comida
        </button>
      </div>

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
          {comidas.length === 0 ? "Todavía no cargaste comidas. ¡Creá la primera!" : "No hay comidas con ese filtro."}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtradas.map((c) => (
            <li
              key={c.id}
              className={`tarjeta grid grid-cols-[56px_1fr] items-center gap-x-3 gap-y-3 p-3 lg:grid-cols-[56px_minmax(0,1fr)_140px_140px_120px_90px_auto] ${
                c.activo ? "" : "opacity-60"
              }`}
            >
              {c.imagen_url ? (
                <img src={c.imagen_url} alt={c.nombre} className="size-14 rounded-lg object-cover" loading="lazy" />
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
                <p className="text-xs text-tinta-suave">{nombreCategoria.get(c.categoria_id) ?? "Sin categoría"}</p>
              </div>

              <div className="col-span-2 text-sm lg:col-span-1">
                <span className={c.precio_promo ? "text-xs text-tinta-suave line-through" : "font-semibold"}>
                  {formatearPrecio(c.precio)}
                </span>
                {c.precio_promo && (
                  <span className="ml-2 font-semibold text-brasa">{formatearPrecio(c.precio_promo)}</span>
                )}
              </div>

              <div className="col-span-2 flex items-center gap-2 lg:col-span-1">
                <span className="text-xs text-tinta-suave lg:hidden">Stock</span>
                <EditorStock
                  comida={c}
                  onGuardar={(n) => actualizar(c, { stock: n }, `Stock de "${c.nombre}": ${n}`)}
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-tinta-suave">
                <Interruptor
                  activo={c.destacado}
                  etiqueta={`Destacado: ${c.nombre}`}
                  onCambiar={() =>
                    actualizar(c, { destacado: !c.destacado }, c.destacado ? "Ya no es destacado" : "Marcado como destacado")
                  }
                />
                Destacado
              </label>

              <label className="flex items-center gap-2 text-xs text-tinta-suave">
                <Interruptor
                  activo={c.activo}
                  etiqueta={`Activo: ${c.nombre}`}
                  onCambiar={() =>
                    actualizar(c, { activo: !c.activo }, c.activo ? "Oculta en el catálogo" : "Visible en el catálogo")
                  }
                />
                Activo
              </label>

              <div className="col-span-2 flex justify-end gap-2 lg:col-span-1">
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
        mensaje={`¿Seguro que querés borrar "${aBorrar?.nombre ?? ""}"? También se borra su imagen. Las ventas anteriores se conservan. Si solo querés ocultarla, desactivala.`}
        textoConfirmar="Borrar"
        procesando={borrando}
        onConfirmar={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </section>
  );
}
