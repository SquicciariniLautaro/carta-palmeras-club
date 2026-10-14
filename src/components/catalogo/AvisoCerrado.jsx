import { DIAS, ORDEN_SEMANA, textoApertura, textoTurno } from "../../lib/horarios";
import { IconoReloj } from "../ui/Iconos";

// Cartel arriba de la carta cuando el local está fuera de horario
export default function AvisoCerrado({ estado, horarios }) {
  const porDia = new Map(horarios.map((h) => [h.dia, h]));
  return (
    <div className="mx-auto mb-4 max-w-xl rounded-2xl border-2 border-brasa bg-brasa/10 p-4 text-center" role="status">
      <p className="flex items-center justify-center gap-2 text-lg font-bold text-brasa">
        <IconoReloj className="size-5" /> Ahora estamos cerrados
      </p>
      <p className="mt-1 text-sm font-medium">{textoApertura(estado)}. Mientras tanto podés mirar la carta.</p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-tinta-suave underline">Ver horarios</summary>
        <ul className="mx-auto mt-2 max-w-xs space-y-0.5 text-left">
          {ORDEN_SEMANA.filter((d) => porDia.has(d)).map((d) => (
            <li key={d} className="flex justify-between gap-4">
              <span>{DIAS[d]}</span>
              <span className="text-tinta-suave">{textoTurno(porDia.get(d))}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
