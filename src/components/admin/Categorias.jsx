import { useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { IconoBasura, IconoFlechaAbajo, IconoFlechaArriba, IconoMas } from "../ui/Iconos";
import Confirmar from "../ui/Confirmar";

function FilaCategoria({ categoria, cantidad, esPrimera, esUltima, onRenombrar, onMover, onBorrar }) {
  const [nombre, setNombre] = useState(categoria.nombre);
  const [original, setOriginal] = useState(categoria.nombre);
  if (categoria.nombre !== original) {
    setOriginal(categoria.nombre);
    setNombre(categoria.nombre);
  }

  function guardar() {
    const limpio = nombre.trim();
    if (!limpio) {
      setNombre(categoria.nombre);
      toast.error("El nombre no puede quedar vacío.");
      return;
    }
    if (limpio !== categoria.nombre) onRenombrar(limpio);
  }

  return (
    <li className="tarjeta flex flex-wrap items-center gap-2 p-3">
      <div className="flex flex-col">
        <button
          type="button"
          className="rounded p-1 text-tinta-suave hover:bg-borde hover:text-tinta disabled:opacity-30"
          onClick={() => onMover(-1)}
          disabled={esPrimera}
          aria-label={`Subir ${categoria.nombre}`}
        >
          <IconoFlechaArriba className="size-4" />
        </button>
        <button
          type="button"
          className="rounded p-1 text-tinta-suave hover:bg-borde hover:text-tinta disabled:opacity-30"
          onClick={() => onMover(1)}
          disabled={esUltima}
          aria-label={`Bajar ${categoria.nombre}`}
        >
          <IconoFlechaAbajo className="size-4" />
        </button>
      </div>
      <input
        className="campo min-w-0 flex-1"
        value={nombre}
        maxLength={60}
        onChange={(e) => setNombre(e.target.value)}
        onBlur={guardar}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label={`Nombre de la categoría ${categoria.nombre}`}
      />
      <span className="w-24 text-right text-xs text-tinta-suave">
        {cantidad} {cantidad === 1 ? "comida" : "comidas"}
      </span>
      <button
        type="button"
        className="boton-secundario px-3 py-2 hover:text-brasa"
        onClick={onBorrar}
        disabled={cantidad > 0}
        title={cantidad > 0 ? "No se puede borrar: tiene comidas" : undefined}
        aria-label={`Borrar ${categoria.nombre}`}
      >
        <IconoBasura className="size-4" />
      </button>
    </li>
  );
}

export default function Categorias({ categorias, comidas, onCambio }) {
  const [nueva, setNueva] = useState("");
  const [creando, setCreando] = useState(false);
  const [aBorrar, setABorrar] = useState(null);

  const cantidadPorCategoria = (id) => comidas.filter((c) => c.categoria_id === id).length;

  async function crear(e) {
    e.preventDefault();
    const nombre = nueva.trim();
    if (!nombre) return;
    setCreando(true);
    const orden = categorias.reduce((max, c) => Math.max(max, c.orden), 0) + 1;
    const { error } = await supabase.from("categorias").insert({ nombre, orden });
    setCreando(false);
    if (error) {
      toast.error(mensajeDeError(error, "No se pudo crear la categoría."));
      return;
    }
    setNueva("");
    toast.success(`Categoría "${nombre}" creada`);
    onCambio();
  }

  async function renombrar(categoria, nombre) {
    const { error } = await supabase.from("categorias").update({ nombre }).eq("id", categoria.id);
    if (error) toast.error(mensajeDeError(error, "No se pudo renombrar."));
    else toast.success("Categoría renombrada");
    onCambio();
  }

  // Intercambia el orden con la vecina y renumera todo 1..N
  async function mover(indice, direccion) {
    const lista = [...categorias];
    const destino = indice + direccion;
    [lista[indice], lista[destino]] = [lista[destino], lista[indice]];
    const cambios = lista
      .map((c, i) => ({ id: c.id, orden: i + 1, anterior: c.orden }))
      .filter((c) => c.orden !== c.anterior);
    const resultados = await Promise.all(
      cambios.map((c) => supabase.from("categorias").update({ orden: c.orden }).eq("id", c.id))
    );
    const fallo = resultados.find((r) => r.error);
    if (fallo) toast.error(mensajeDeError(fallo.error, "No se pudo reordenar."));
    onCambio();
  }

  async function borrar() {
    const { error } = await supabase.from("categorias").delete().eq("id", aBorrar.id);
    if (error) {
      toast.error(
        error.code === "23503"
          ? "No se puede borrar: todavía tiene comidas."
          : mensajeDeError(error, "No se pudo borrar.")
      );
    } else {
      toast.success(`Borraste "${aBorrar.nombre}"`);
    }
    setABorrar(null);
    onCambio();
  }

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Categorías</h1>
        <p className="text-sm text-tinta-suave">
          El orden de esta lista es el orden de los filtros del catálogo. Solo se pueden borrar categorías sin comidas.
        </p>
      </div>

      <form onSubmit={crear} className="flex gap-2">
        <label htmlFor="nueva-cat" className="sr-only">
          Nueva categoría
        </label>
        <input
          id="nueva-cat"
          className="campo"
          placeholder="Nueva categoría (ej.: Lomitos)"
          value={nueva}
          maxLength={60}
          onChange={(e) => setNueva(e.target.value)}
        />
        <button type="submit" className="boton-primario shrink-0" disabled={creando || !nueva.trim()}>
          <IconoMas className="size-4" /> Crear
        </button>
      </form>

      {categorias.length === 0 ? (
        <div className="tarjeta p-8 text-center text-tinta-suave">Todavía no hay categorías.</div>
      ) : (
        <ul className="space-y-2">
          {categorias.map((c, i) => (
            <FilaCategoria
              key={c.id}
              categoria={c}
              cantidad={cantidadPorCategoria(c.id)}
              esPrimera={i === 0}
              esUltima={i === categorias.length - 1}
              onRenombrar={(nombre) => renombrar(c, nombre)}
              onMover={(dir) => mover(i, dir)}
              onBorrar={() => setABorrar(c)}
            />
          ))}
        </ul>
      )}

      <Confirmar
        abierto={Boolean(aBorrar)}
        titulo="Borrar categoría"
        mensaje={`¿Borrar la categoría "${aBorrar?.nombre ?? ""}"?`}
        textoConfirmar="Borrar"
        onConfirmar={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </section>
  );
}
