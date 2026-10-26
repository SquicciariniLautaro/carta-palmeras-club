// Tarjeta crema de una categoría sobre el mantel a cuadros. "resaltada" pinta el
// título sobre una franja roja (se usa para las promos).
export default function TarjetaCategoria({ id, titulo, bajada, resaltada = false, children }) {
  return (
    <section
      id={`seccion-${id}`}
      data-seccion={id}
      aria-labelledby={`titulo-${id}`}
      className="scroll-mt-36 rounded-[28px] bg-papel p-5 shadow-[0_18px_40px_-18px_rgb(80_15_0/0.65)] ring-1 ring-black/5 sm:p-8"
    >
      <header className={resaltada ? "rounded-2xl bg-palmera px-4 py-3 text-fondo" : "border-b-2 border-palmera pb-2"}>
        {bajada && <p className={`font-script text-2xl leading-none ${resaltada ? "text-fondo/90" : "text-tinta-suave"}`}>{bajada}</p>}
        <h2
          id={`titulo-${id}`}
          className={`text-3xl font-bold uppercase leading-tight tracking-tight sm:text-4xl ${resaltada ? "" : "text-palmera"}`}
        >
          {titulo}
        </h2>
      </header>
      <ul className="mt-1 divide-y divide-borde/80">{children}</ul>
    </section>
  );
}

export function TarjetaCategoriaEsqueleto() {
  return (
    <div className="animate-pulse rounded-[28px] bg-papel p-5 sm:p-8" aria-hidden="true">
      <div className="h-8 w-1/2 rounded bg-borde" />
      <div className="mt-6 space-y-5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-3 flex-1 rounded bg-borde" />
            <div className="size-10 rounded-full bg-borde" />
          </div>
        ))}
      </div>
    </div>
  );
}
