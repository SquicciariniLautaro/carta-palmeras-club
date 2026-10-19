import { useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { formatearPesos } from "../../lib/formato";
import { useCaja } from "../../hooks/useCaja";
import { IconoAlerta, IconoBasura, IconoCaja, IconoEfectivo, IconoLibreta, IconoMas, IconoTransferencia } from "../ui/Iconos";
import { METODOS_PAGO } from "./ventasUtils";
import { pagoUsaCaja } from "./pagosUtils";

const ICONOS = { efectivo: IconoEfectivo, transferencia: IconoTransferencia, cuenta_corriente: IconoLibreta };

// Aviso con un formulario corto para abrir la caja sin salir de donde se está cobrando
export function AvisoCajaCerrada({ texto = "La caja está cerrada. Para cobrar en efectivo o por transferencia, abrila primero." }) {
  const { recargar } = useCaja();
  const [inicial, setInicial] = useState("");
  const [abriendo, setAbriendo] = useState(false);

  async function abrir() {
    setAbriendo(true);
    const { data, error } = await supabase.rpc("abrir_caja", { monto_inicial: Number(inicial) || 0 });
    setAbriendo(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo abrir la caja."));
    toast.success(`Caja abierta (arqueo N° ${data.numero})`);
    recargar();
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="flex items-start gap-2 font-medium">
        <IconoAlerta className="mt-0.5 size-4 shrink-0" /> {texto}
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex-1">
          <span className="etiqueta text-amber-900">Efectivo inicial en la caja</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            className="campo py-2"
            placeholder="0"
            value={inicial}
            onChange={(e) => setInicial(e.target.value)}
          />
        </label>
        <button type="button" className="boton-primario" onClick={abrir} disabled={abriendo}>
          <IconoCaja className="size-4" /> {abriendo ? "Abriendo…" : "Abrir caja"}
        </button>
      </div>
    </div>
  );
}

function SelectorCliente({ clientes, valor, onCambio, onCreado }) {
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [guardando, setGuardando] = useState(false);
  const activos = clientes.filter((c) => c.activo);
  const elegido = clientes.find((c) => c.id === valor);

  async function crear() {
    if (!nombre.trim()) return toast.error("Escribí el nombre del cliente.");
    setGuardando(true);
    const { data, error } = await supabase
      .from("clientes")
      .insert({ nombre: nombre.trim(), telefono: telefono.trim() || null })
      .select()
      .single();
    setGuardando(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo crear el cliente."));
    toast.success(`Cliente "${data.nombre}" creado`);
    setCreando(false);
    setNombre("");
    setTelefono("");
    await onCreado?.();
    onCambio(data.id);
  }

  return (
    <div className="space-y-2 rounded-xl border border-borde bg-fondo p-3">
      {creando ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
          <input className="campo" placeholder="Nombre y apellido" maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <input className="campo" placeholder="Teléfono" maxLength={30} value={telefono} onChange={(e) => setTelefono(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="boton-primario" onClick={crear} disabled={guardando}>
              {guardando ? "Creando…" : "Crear"}
            </button>
            <button type="button" className="boton-secundario" onClick={() => setCreando(false)}>
              Volver
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <select className="campo flex-1" value={valor} onChange={(e) => onCambio(e.target.value)} aria-label="Cliente de la cuenta corriente">
            <option value="">Elegí el cliente…</option>
            {activos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} · debe {formatearPesos(c.saldo)}
              </option>
            ))}
          </select>
          <button type="button" className="boton-secundario shrink-0" onClick={() => setCreando(true)}>
            <IconoMas className="size-4" /> Nuevo cliente
          </button>
        </div>
      )}
      {elegido && (
        <p className="text-xs text-tinta-suave">
          Saldo actual: <strong className="text-tinta">{formatearPesos(elegido.saldo)}</strong>
          {elegido.limite_credito != null && <> · Límite: {formatearPesos(elegido.limite_credito)}</>}
        </p>
      )}
    </div>
  );
}

// Formulario de forma de pago: efectivo, transferencia o cuenta corriente (o combinadas)
export default function FormPagos({ total, valor, onCambio, clientes, onClienteCreado }) {
  const { caja } = useCaja();
  const set = (cambios) => onCambio({ ...valor, ...cambios });
  const usaCC = valor.dividido ? valor.partes.some((p) => p.metodo === "cuenta_corriente") : valor.metodo === "cuenta_corriente";
  const sumaPartes = valor.partes.reduce((acc, p) => acc + (p.monto === "" ? 0 : Number(p.monto) || 0), 0);
  const resto = Math.max(0, total - sumaPartes);
  const vuelto = valor.metodo === "efectivo" && valor.recibido !== "" ? Number(valor.recibido) - total : null;

  const cambiarParte = (i, cambios) => set({ partes: valor.partes.map((p, j) => (j === i ? { ...p, ...cambios } : p)) });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="etiqueta mb-0">Forma de pago</span>
        <button type="button" className="text-xs font-medium text-palmera underline-offset-2 hover:underline" onClick={() => set({ dividido: !valor.dividido })}>
          {valor.dividido ? "Una sola forma de pago" : "Combinar formas de pago"}
        </button>
      </div>

      {!valor.dividido ? (
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Forma de pago">
          {Object.entries(METODOS_PAGO).map(([id, m]) => {
            const Icono = ICONOS[id];
            const activo = valor.metodo === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={activo}
                onClick={() => set({ metodo: id })}
                className={`flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-3 text-xs font-semibold transition sm:text-sm ${
                  activo ? "border-palmera bg-palmera/10 text-tinta" : "border-borde bg-papel text-tinta-suave hover:border-tinta-suave"
                }`}
              >
                <Icono className="size-6" />
                {m.nombre}
              </button>
            );
          })}
        </div>
      ) : (
        <ul className="space-y-2">
          {valor.partes.map((p, i) => (
            <li key={i} className="flex items-center gap-2">
              <select className="campo flex-1" value={p.metodo} onChange={(e) => cambiarParte(i, { metodo: e.target.value })} aria-label={`Forma de pago ${i + 1}`}>
                {Object.entries(METODOS_PAGO).map(([id, m]) => (
                  <option key={id} value={id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="campo w-36 cifras"
                placeholder={`Resto ${formatearPesos(resto)}`}
                value={p.monto}
                onChange={(e) => cambiarParte(i, { monto: e.target.value })}
                aria-label={`Monto de ${METODOS_PAGO[p.metodo].nombre}`}
              />
              {valor.partes.length > 2 && (
                <button
                  type="button"
                  className="rounded p-1.5 text-tinta-suave hover:bg-borde hover:text-rojo"
                  onClick={() => set({ partes: valor.partes.filter((_, j) => j !== i) })}
                  aria-label="Quitar forma de pago"
                >
                  <IconoBasura className="size-4" />
                </button>
              )}
            </li>
          ))}
          {valor.partes.length < 3 && (
            <li>
              <button
                type="button"
                className="text-xs font-medium text-tinta-suave underline-offset-2 hover:text-tinta hover:underline"
                onClick={() => set({ partes: [...valor.partes, { metodo: "cuenta_corriente", monto: "" }] })}
              >
                + Agregar otra forma de pago
              </button>
            </li>
          )}
          <li className="text-xs text-tinta-suave">Dejá un monto vacío y se completa solo con lo que falta.</li>
        </ul>
      )}

      {!valor.dividido && valor.metodo === "efectivo" && (
        <div className="grid grid-cols-2 items-end gap-3">
          <label>
            <span className="etiqueta">Paga con (opcional)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className="campo cifras"
              placeholder={formatearPesos(total)}
              value={valor.recibido}
              onChange={(e) => set({ recibido: e.target.value })}
            />
          </label>
          <div className={`rounded-xl px-3 py-2.5 text-sm ${vuelto != null && vuelto < 0 ? "bg-brasa/10 text-brasa" : "bg-fondo"}`}>
            <span className="block text-xs text-tinta-suave">Vuelto</span>
            <strong className="cifras">{vuelto == null ? "—" : vuelto < 0 ? `Faltan ${formatearPesos(-vuelto)}` : formatearPesos(vuelto)}</strong>
          </div>
        </div>
      )}

      {usaCC && <SelectorCliente clientes={clientes} valor={valor.clienteId} onCambio={(id) => set({ clienteId: id })} onCreado={onClienteCreado} />}

      {!caja && pagoUsaCaja(valor) && <AvisoCajaCerrada />}
    </div>
  );
}
