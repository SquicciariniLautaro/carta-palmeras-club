import { useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { DIAS, ORDEN_SEMANA, estadoLocal, hhmm, textoApertura } from "../../lib/horarios";
import { IconoReloj } from "../ui/Iconos";

function filasIniciales(horarios, turno) {
  const porDia = new Map(horarios.map((h) => [h.dia, h]));
  return ORDEN_SEMANA.map((dia) => {
    const h = porDia.get(dia);
    return { turno, dia, abierto: h?.abierto ?? true, desde: hhmm(h?.desde ?? "00:00"), hasta: hhmm(h?.hasta ?? "00:00") };
  });
}

// Horario de atención de cada turno. El de la noche controla la carta: fuera de
// horario no deja mandar pedidos. El del mediodía es informativo.
export default function Horarios({ turno = "noche", horarios, onCambio }) {
  const conCarta = turno === "noche";
  const [filas, setFilas] = useState(() => filasIniciales(horarios, turno));
  const [guardando, setGuardando] = useState(false);

  // Si los horarios cambian desde afuera (al recargar), se vuelven a cargar
  const [origen, setOrigen] = useState(horarios);
  if (horarios !== origen) {
    setOrigen(horarios);
    setFilas(filasIniciales(horarios, turno));
  }

  const cambiar = (dia, campo, valor) => setFilas((prev) => prev.map((f) => (f.dia === dia ? { ...f, [campo]: valor } : f)));

  function copiarATodos(fila) {
    setFilas((prev) => prev.map((f) => ({ ...f, abierto: fila.abierto, desde: fila.desde, hasta: fila.hasta })));
    toast.success(`Copiaste el horario del ${DIAS[fila.dia].toLowerCase()} a todos los días. Falta guardar.`);
  }

  async function guardar() {
    if (filas.some((f) => f.abierto && (!f.desde || !f.hasta))) {
      toast.error("Completá el horario de los días abiertos.");
      return;
    }
    setGuardando(true);
    const { error } = await supabase.from("horarios").upsert(filas, { onConflict: "turno,dia" });
    setGuardando(false);
    if (error) {
      toast.error(mensajeDeError(error, "No se pudo guardar el horario."));
      return;
    }
    toast.success("Horario guardado");
    onCambio();
  }

  const ahora = estadoLocal(horarios);

  return (
    <section className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{conCarta ? "Horario de la noche" : "Horario del mediodía"}</h1>
        <p className="text-sm text-tinta-suave">
          {conCarta
            ? "Fuera de este horario la carta se puede mirar, pero no se pueden mandar pedidos. Hora de Argentina."
            : "Horario del servicio del mediodía. Es informativo: no afecta a la carta online. Hora de Argentina."}
        </p>
      </div>

      <p
        className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold ${
          ahora.abierto ? "bg-emerald-100 text-emerald-900" : "bg-brasa/10 text-brasa"
        }`}
      >
        <IconoReloj className="size-4" />
        {conCarta
          ? ahora.abierto
            ? "Ahora la carta está recibiendo pedidos."
            : `Ahora la carta figura cerrada. ${textoApertura(ahora)}.`
          : ahora.abierto
            ? "Ahora es horario del mediodía."
            : `Fuera del horario del mediodía. ${textoApertura(ahora).replace("Abrimos", "Abre")}.`}
      </p>

      <ul className="tarjeta divide-y divide-borde">
        {filas.map((f) => (
          <li key={f.dia} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <label className="flex w-36 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4 accent-palmera"
                checked={f.abierto}
                onChange={(e) => cambiar(f.dia, "abierto", e.target.checked)}
              />
              {DIAS[f.dia]}
            </label>
            {f.abierto ? (
              <div className="flex items-center gap-2 text-sm">
                <input
                  type="time"
                  className="campo w-28 py-1.5"
                  value={f.desde}
                  onChange={(e) => cambiar(f.dia, "desde", e.target.value)}
                  aria-label={`${DIAS[f.dia]}: abre a las`}
                />
                a
                <input
                  type="time"
                  className="campo w-28 py-1.5"
                  value={f.hasta}
                  onChange={(e) => cambiar(f.dia, "hasta", e.target.value)}
                  aria-label={`${DIAS[f.dia]}: cierra a las`}
                />
                {f.desde === f.hasta && <span className="text-xs text-tinta-suave">todo el día</span>}
                {f.desde > f.hasta && <span className="text-xs text-tinta-suave">cierra al día siguiente</span>}
              </div>
            ) : (
              <span className="text-sm text-tinta-suave">Cerrado</span>
            )}
            <button
              type="button"
              className="ml-auto text-xs text-tinta-suave underline hover:text-tinta"
              onClick={() => copiarATodos(f)}
            >
              Copiar a todos
            </button>
          </li>
        ))}
      </ul>

      <ul className="list-disc space-y-1 pl-5 text-xs text-tinta-suave">
        <li>Si cierran después de medianoche, poné por ejemplo 20:00 a 01:00: se entiende que cierra al día siguiente.</li>
        <li>Con la misma hora en los dos campos, ese día queda abierto todo el día.</li>
        <li>Destildá un día para marcarlo cerrado.</li>
      </ul>

      <div className="flex justify-end">
        <button type="button" className="boton-primario" onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar horario"}
        </button>
      </div>
    </section>
  );
}
