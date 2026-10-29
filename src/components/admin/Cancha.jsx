import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { fechaInput, formatearFecha, formatearPesos } from "../../lib/formato";
import { imprimirTicket, leerConfigImpresora } from "../../lib/impresion";
import { useCaja, useClientes } from "../../hooks/useCaja";
import { useRol } from "../../hooks/useRol";
import { IconoAnular, IconoBasura, IconoCalendario, IconoCheck, IconoEditar, IconoEfectivo, IconoMas, IconoPelota, IconoRecibo, IconoTransferencia } from "../ui/Iconos";
import Cargando from "../ui/Cargando";
import Confirmar from "../ui/Confirmar";
import Modal from "../ui/Modal";
import FormPagos from "./FormPagos";
import { PAGO_INICIAL, pagoUsaCaja, pagosConMontos, validarPago } from "./pagosUtils";
import { desdeInput, hoyInput, textoPagos } from "./ventasUtils";

// Horas que se muestran en la grilla del día (el turno puede empezar a cualquier hora)
const HORAS = Array.from({ length: 16 }, (_, i) => i + 8); // de 08:00 a 24:00
const DURACIONES = [60, 90, 120, 150, 180, 240];
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const COLUMNAS = "*, ventas(id, numero, estado, total, pagos(metodo, monto, nota, usuario))";

// "20:00:00" → minutos desde las 00
function aMinutos(hora) {
  const [h, m] = String(hora).split(":").map(Number);
  return h * 60 + m;
}

// 1290 → "21:30" (pasada la medianoche vuelve a 00:00)
function aHora(minutos) {
  const total = ((minutos % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function textoDuracion(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}

function horario(t) {
  const inicio = aMinutos(t.desde);
  return `${aHora(inicio)} a ${aHora(inicio + t.minutos)}`;
}

const redondo = (n) => Math.round(n * 100) / 100;
const precioDe = (porHora, minutos) => redondo(Number(porHora || 0) * (minutos / 60));
const porHoraDe = (precio, minutos) => String(redondo(Number(precio) / (minutos / 60)));

// Estado de la plata de un turno: lo pagado (señas incluidas) y lo que falta
const estaCobrado = (t) => t.ventas?.estado === "cerrado";
const pagadoDe = (t) => (t.ventas?.pagos ?? []).reduce((acc, p) => acc + Number(p.monto), 0);
const estaSenado = (t) => !estaCobrado(t) && pagadoDe(t) > 0;
const restaDe = (t) => redondo(Number(t.precio) - pagadoDe(t));

function sumarDias(fecha, dias) {
  const d = desdeInput(fecha);
  d.setDate(d.getDate() + dias);
  return fechaInput(d);
}

async function imprimirTicketDeVenta(ventaId) {
  const { data } = await supabase.from("ventas").select("*, venta_items(*), pagos(metodo, monto)").eq("id", ventaId).single();
  if (data) imprimirTicket(data, data.pagos ?? []);
}

function Resumen({ titulo, valor, detalle }) {
  return (
    <div className="tarjeta p-4">
      <p className="text-xs text-tinta-suave">{titulo}</p>
      <p className="cifras mt-1 text-xl font-bold sm:text-2xl">{valor}</p>
      {detalle && <p className="text-xs text-tinta-suave">{detalle}</p>}
    </div>
  );
}

function Etiqueta({ clase, children }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${clase}`}>{children}</span>;
}

// Precio por hora: si el dueño lo fijó, el empleado no lo puede cambiar
function CampoPrecio({ valor, onCambio, precioHora, bloqueado, ayuda }) {
  const { esDueno } = useRol();
  const fijo = bloqueado || (!esDueno && precioHora != null);
  return (
    <label>
      <span className="etiqueta">Precio por hora (ARS)</span>
      <input
        type="number"
        min="0"
        step="100"
        inputMode="decimal"
        className="campo cifras"
        value={fijo && !bloqueado ? String(precioHora) : valor}
        onChange={(e) => onCambio(e.target.value)}
        disabled={fijo}
      />
      <span className="mt-1 block text-xs text-tinta-suave">
        {ayuda ??
          (!esDueno && precioHora != null
            ? "Lo fija el dueño."
            : esDueno && precioHora != null
              ? `Precio de la cancha: ${formatearPesos(precioHora)}. Podés poner otro para este turno.`
              : "")}
      </span>
    </label>
  );
}

// Formulario de turno: reservar (y cobrar en el momento, si ya pagó) o editar
function FormTurno({ inicial, precioHora, onCerrar, onGuardado }) {
  const { esDueno } = useRol();
  const editando = Boolean(inicial.id);
  const conPagos = editando && (estaCobrado(inicial) || estaSenado(inicial));
  const { caja } = useCaja();
  const { clientes, recargar: recargarClientes } = useClientes(!editando);
  const [v, setV] = useState(() => ({
    fecha: inicial.fecha,
    desde: String(inicial.desde ?? "20:00").slice(0, 5),
    minutos: inicial.minutos ?? 60,
    precioHora: inicial.precio ? porHoraDe(inicial.precio, inicial.minutos) : precioHora != null ? String(precioHora) : "",
    cliente: inicial.cliente_nombre ?? "",
    telefono: inicial.cliente_telefono ?? "",
    nota: inicial.nota ?? "",
  }));
  const [modo, setModo] = useState("reservar"); // reservar | cobrar
  const [pago, setPago] = useState(PAGO_INICIAL);
  const [conTicket, setConTicket] = useState(() => leerConfigImpresora().ticketAlCobrar);
  const [guardando, setGuardando] = useState(false);
  const set = (cambios) => setV((prev) => ({ ...prev, ...cambios }));

  // Sin precio fijado por el dueño: se propone el del último turno
  useEffect(() => {
    if (editando || precioHora != null) return;
    let activo = true;
    supabase
      .from("cancha_turnos")
      .select("precio, minutos")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const ultimo = data?.[0];
        if (!activo || !ultimo) return;
        setV((prev) => (prev.precioHora === "" ? { ...prev, precioHora: porHoraDe(ultimo.precio, ultimo.minutos) } : prev));
      });
    return () => {
      activo = false;
    };
  }, [editando, precioHora]);

  const porHora = !esDueno && precioHora != null ? precioHora : v.precioHora;
  // El empleado que solo corrige la hora o la nota no le cambia el precio (puede ser uno especial del dueño)
  const mantienePrecio = conPagos || (editando && !esDueno && Number(v.minutos) === inicial.minutos);
  const total = mantienePrecio ? Number(inicial.precio) : precioDe(porHora, v.minutos);

  async function guardar(e) {
    e.preventDefault();
    if (!v.fecha || !v.desde) return toast.error("Completá el día y la hora.");
    if (!v.cliente.trim()) return toast.error("Poné el nombre de quien alquila.");
    if (!(total > 0)) return toast.error("Poné el precio por hora.");
    let pagos = null;
    if (!editando && modo === "cobrar") {
      const validacion = validarPago(pago, total);
      if (validacion.error) return toast.error(validacion.error);
      if (pagoUsaCaja(pago) && !caja) return toast.error("Abrí la caja para cobrar en efectivo o por transferencia.");
      pagos = validacion.pagos;
    }

    const fila = {
      fecha: v.fecha,
      desde: v.desde,
      minutos: Number(v.minutos),
      cliente_nombre: v.cliente.trim(),
      cliente_telefono: v.telefono.trim() || null,
      nota: v.nota.trim() || null,
    };
    if (!mantienePrecio) fila.precio = total;

    setGuardando(true);
    const { data, error } = editando
      ? await supabase.from("cancha_turnos").update(fila).eq("id", inicial.id).select().single()
      : await supabase.from("cancha_turnos").insert(fila).select().single();
    if (error) {
      setGuardando(false);
      return toast.error(mensajeDeError(error, "No se pudo guardar el turno."));
    }

    if (pagos) {
      const cobro = await supabase.rpc("cobrar_turno_cancha", { turno_id: data.id, pagos });
      setGuardando(false);
      if (cobro.error) {
        toast.error(mensajeDeError(cobro.error, "El turno quedó reservado pero no se pudo cobrar."));
        return onGuardado();
      }
      if (conTicket) await imprimirTicketDeVenta(cobro.data.id);
      toast.success(`Turno cobrado: ${formatearPesos(total)}`);
    } else {
      setGuardando(false);
      toast.success(editando ? "Turno actualizado" : `Turno reservado: ${aHora(aMinutos(v.desde))} · ${v.cliente.trim()}`);
    }
    onGuardado();
  }

  return (
    <form onSubmit={guardar} className="space-y-4" noValidate>
      {inicial.fijo_id && (
        <p className="rounded-xl bg-cancha-suave p-3 text-xs text-cancha">
          Es un <strong>turno fijo</strong>: lo que cambies acá vale solo para este día. Para cambiarlo todas las semanas, usá "Turnos fijos".
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label>
          <span className="etiqueta">Día</span>
          <input type="date" className="campo" value={v.fecha} onChange={(e) => set({ fecha: e.target.value })} required />
        </label>
        <label>
          <span className="etiqueta">Desde</span>
          <input type="time" className="campo" step="900" value={v.desde} onChange={(e) => set({ desde: e.target.value })} required />
        </label>
        <label>
          <span className="etiqueta">Duración</span>
          <select className="campo" value={v.minutos} onChange={(e) => set({ minutos: Number(e.target.value) })} disabled={conPagos}>
            {[...new Set([...DURACIONES, Number(v.minutos)])]
              .sort((a, b) => a - b)
              .map((m) => (
                <option key={m} value={m}>
                  {textoDuracion(m)}
                </option>
              ))}
          </select>
        </label>
      </div>
      <p className="-mt-2 text-xs text-tinta-suave">
        De {aHora(aMinutos(v.desde || "00:00"))} a {aHora(aMinutos(v.desde || "00:00") + Number(v.minutos))}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="etiqueta">A nombre de *</span>
          <input className="campo" maxLength={80} placeholder="Ej.: Juan Pérez" value={v.cliente} onChange={(e) => set({ cliente: e.target.value })} />
        </label>
        <label>
          <span className="etiqueta">Teléfono (opcional)</span>
          <input className="campo" maxLength={30} inputMode="tel" value={v.telefono} onChange={(e) => set({ telefono: e.target.value })} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <CampoPrecio
          valor={v.precioHora}
          onCambio={(precio) => set({ precioHora: precio })}
          precioHora={precioHora}
          bloqueado={conPagos}
          ayuda={conPagos ? "Ya tiene una seña o un cobro: para cambiar el precio, el dueño tiene que anularlo." : undefined}
        />
        <div className="rounded-xl bg-fondo p-3">
          <p className="text-xs text-tinta-suave">Total del turno</p>
          <p className="cifras text-2xl font-bold">{formatearPesos(total)}</p>
        </div>
      </div>

      <label className="block">
        <span className="etiqueta">Nota (opcional)</span>
        <input className="campo" maxLength={300} placeholder="Ej.: trae pelota" value={v.nota} onChange={(e) => set({ nota: e.target.value })} />
      </label>

      {!editando && (
        <>
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-fondo p-1" role="radiogroup" aria-label="Cuándo se cobra">
            {[
              ["reservar", "Reservar (cobrar o señar después)"],
              ["cobrar", "Ya pagó todo: cobrar ahora"],
            ].map(([id, texto]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={modo === id}
                onClick={() => setModo(id)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${modo === id ? "bg-papel text-tinta shadow-sm" : "text-tinta-suave"}`}
              >
                {texto}
              </button>
            ))}
          </div>
          {modo === "cobrar" && (
            <>
              <FormPagos total={total} valor={pago} onCambio={setPago} clientes={clientes} onClienteCreado={recargarClientes} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-palmera" checked={conTicket} onChange={(e) => setConTicket(e.target.checked)} />
                Imprimir el ticket para el cliente
              </label>
            </>
          )}
        </>
      )}

      <div className="flex justify-end gap-2 border-t border-borde pt-4">
        <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </button>
        <button type="submit" className="boton-primario" disabled={guardando}>
          {guardando ? "Guardando…" : editando ? "Guardar cambios" : modo === "cobrar" ? "Reservar y cobrar" : "Reservar turno"}
        </button>
      </div>
    </form>
  );
}

// Cobra lo que falta del turno (si dejó seña, solo el resto)
function CobrarTurno({ turno, onCerrar, onCobrado }) {
  const { caja } = useCaja();
  const { clientes, recargar: recargarClientes } = useClientes();
  const [pago, setPago] = useState(PAGO_INICIAL);
  const [conTicket, setConTicket] = useState(() => leerConfigImpresora().ticketAlCobrar);
  const [guardando, setGuardando] = useState(false);
  const total = restaDe(turno);
  const sena = pagadoDe(turno);

  async function cobrar() {
    const { error: invalido, pagos } = validarPago(pago, total);
    if (invalido) return toast.error(invalido);
    if (pagoUsaCaja(pago) && !caja) return toast.error("Abrí la caja para cobrar en efectivo o por transferencia.");
    setGuardando(true);
    const { data, error } = await supabase.rpc("cobrar_turno_cancha", { turno_id: turno.id, pagos });
    setGuardando(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo registrar el cobro."));
    if (conTicket) await imprimirTicketDeVenta(data.id);
    toast.success(`Turno de ${turno.cliente_nombre} cobrado: ${formatearPesos(total)} (${textoPagos(pagosConMontos(pagos, total), formatearPesos)})`);
    onCobrado();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">{sena > 0 ? "Falta cobrar" : "Total a cobrar"}</p>
        <p className="cifras mt-1 text-4xl font-bold text-emerald-900">{formatearPesos(total)}</p>
        <p className="mt-1 text-sm text-emerald-900">
          {turno.cliente_nombre} · {formatearFecha(turno.fecha)} · {horario(turno)} ({textoDuracion(turno.minutos)})
        </p>
        {sena > 0 && (
          <p className="cifras mt-1 text-xs text-emerald-800">
            Turno {formatearPesos(turno.precio)} − seña {formatearPesos(sena)}
          </p>
        )}
      </div>

      <FormPagos total={total} valor={pago} onCambio={setPago} clientes={clientes} onClienteCreado={recargarClientes} />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-palmera" checked={conTicket} onChange={(e) => setConTicket(e.target.checked)} />
        Imprimir el ticket para el cliente
      </label>

      <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
        <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
          Volver
        </button>
        <button type="button" className="boton bg-emerald-600 py-3 text-base text-white hover:bg-emerald-700" onClick={cobrar} disabled={guardando}>
          <IconoCheck className="size-5" /> {guardando ? "Registrando cobro…" : "Cobrar turno"}
        </button>
      </div>
      <p className="text-xs text-tinta-suave">El cobro queda en la caja abierta y en Finanzas como venta de la cancha.</p>
    </div>
  );
}

// Seña: una parte del precio, en efectivo o por transferencia (entra en la caja)
function SenarTurno({ turno, onCerrar, onSenado }) {
  const { caja } = useCaja();
  const resta = restaDe(turno);
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("transferencia");
  const [guardando, setGuardando] = useState(false);

  async function senar(e) {
    e.preventDefault();
    const valor = Number(monto);
    if (!(valor > 0)) return toast.error("Poné el monto de la seña.");
    if (valor >= resta) return toast.error(`La seña tiene que ser menor que ${formatearPesos(resta)}. Si paga todo, usá Cobrar.`);
    if (!caja) return toast.error("Abrí la caja para registrar la seña.");
    setGuardando(true);
    const { error } = await supabase.rpc("senar_turno_cancha", { turno_id: turno.id, monto: valor, metodo });
    setGuardando(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo registrar la seña."));
    toast.success(`Seña de ${formatearPesos(valor)} registrada. Falta cobrar ${formatearPesos(resta - valor)}.`);
    onSenado();
  }

  return (
    <form onSubmit={senar} className="space-y-4" noValidate>
      <div className="rounded-xl bg-fondo p-3 text-sm">
        <p className="font-semibold">
          {turno.cliente_nombre} · {formatearFecha(turno.fecha)} · {horario(turno)}
        </p>
        <p className="cifras text-tinta-suave">
          Turno {formatearPesos(turno.precio)}
          {pagadoDe(turno) > 0 && ` · ya señó ${formatearPesos(pagadoDe(turno))}`} · falta {formatearPesos(resta)}
        </p>
      </div>
      <label className="block">
        <span className="etiqueta">Monto de la seña</span>
        <input type="number" min="0" step="100" inputMode="decimal" className="campo cifras text-lg sm:w-56" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus />
      </label>
      <div>
        <span className="etiqueta">Cómo la pagó</span>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["transferencia", "Transferencia", IconoTransferencia],
            ["efectivo", "Efectivo", IconoEfectivo],
          ].map(([id, texto, Icono]) => (
            <button
              key={id}
              type="button"
              aria-pressed={metodo === id}
              onClick={() => setMetodo(id)}
              className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-semibold ${
                metodo === id ? "border-palmera bg-palmera/10" : "border-borde text-tinta-suave"
              }`}
            >
              <Icono className="size-4" /> {texto}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-borde pt-4">
        <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </button>
        <button type="submit" className="boton-primario" disabled={guardando}>
          {guardando ? "Registrando…" : "Registrar seña"}
        </button>
      </div>
      <p className="text-xs text-tinta-suave">La seña entra en la caja abierta. Cuando vengan, al cobrar se cobra solo lo que falta.</p>
    </form>
  );
}

// Alta o cambio de un turno fijo (todas las semanas el mismo día y hora)
function FormFijo({ inicial, precioHora, onCerrar, onGuardado }) {
  const editando = Boolean(inicial.id);
  const { esDueno } = useRol();
  const [v, setV] = useState(() => ({
    dia: inicial.dia_semana ?? new Date().getDay(),
    desde: String(inicial.desde ?? "20:00").slice(0, 5),
    minutos: inicial.minutos ?? 60,
    precioHora: inicial.precio ? porHoraDe(inicial.precio, inicial.minutos) : precioHora != null ? String(precioHora) : "",
    cliente: inicial.cliente_nombre ?? "",
    telefono: inicial.cliente_telefono ?? "",
    nota: inicial.nota ?? "",
    activo: inicial.activo ?? true,
  }));
  const [guardando, setGuardando] = useState(false);
  const set = (cambios) => setV((prev) => ({ ...prev, ...cambios }));
  const total = precioDe(!esDueno && precioHora != null ? precioHora : v.precioHora, v.minutos);

  async function guardar(e) {
    e.preventDefault();
    if (!v.cliente.trim()) return toast.error("Poné de quién es el turno fijo.");
    if (!(total > 0)) return toast.error("Poné el precio por hora.");
    const fila = {
      dia_semana: Number(v.dia),
      desde: v.desde,
      minutos: Number(v.minutos),
      cliente_nombre: v.cliente.trim(),
      cliente_telefono: v.telefono.trim() || null,
      nota: v.nota.trim() || null,
      precio: total,
      activo: v.activo,
    };
    setGuardando(true);
    const { error } = editando
      ? await supabase.from("cancha_fijos").update(fila).eq("id", inicial.id)
      : await supabase.from("cancha_fijos").insert(fila);
    setGuardando(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo guardar el turno fijo."));
    toast.success(editando ? "Turno fijo actualizado" : `Turno fijo anotado: ${DIAS[v.dia].toLowerCase()}s ${v.desde}`);
    onGuardado();
  }

  return (
    <form onSubmit={guardar} className="space-y-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-3">
        <label>
          <span className="etiqueta">Todos los</span>
          <select className="campo" value={v.dia} onChange={(e) => set({ dia: Number(e.target.value) })}>
            {DIAS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="etiqueta">Desde</span>
          <input type="time" className="campo" step="900" value={v.desde} onChange={(e) => set({ desde: e.target.value })} />
        </label>
        <label>
          <span className="etiqueta">Duración</span>
          <select className="campo" value={v.minutos} onChange={(e) => set({ minutos: Number(e.target.value) })}>
            {[...new Set([...DURACIONES, Number(v.minutos)])]
              .sort((a, b) => a - b)
              .map((m) => (
                <option key={m} value={m}>
                  {textoDuracion(m)}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="etiqueta">De quién es *</span>
          <input className="campo" maxLength={80} placeholder="Ej.: Los del martes" value={v.cliente} onChange={(e) => set({ cliente: e.target.value })} />
        </label>
        <label>
          <span className="etiqueta">Teléfono (opcional)</span>
          <input className="campo" maxLength={30} inputMode="tel" value={v.telefono} onChange={(e) => set({ telefono: e.target.value })} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoPrecio valor={v.precioHora} onCambio={(precio) => set({ precioHora: precio })} precioHora={precioHora} />
        <div className="rounded-xl bg-fondo p-3">
          <p className="text-xs text-tinta-suave">Cada turno</p>
          <p className="cifras text-2xl font-bold">{formatearPesos(total)}</p>
        </div>
      </div>
      <label className="block">
        <span className="etiqueta">Nota (opcional)</span>
        <input className="campo" maxLength={300} value={v.nota} onChange={(e) => set({ nota: e.target.value })} />
      </label>
      {editando && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-palmera" checked={v.activo} onChange={(e) => set({ activo: e.target.checked })} />
          Sigue vigente (destildalo si dejan de venir)
        </label>
      )}
      <p className="text-xs text-tinta-suave">
        Aparece solo en la grilla de cada {DIAS[v.dia].toLowerCase()}, desde hoy en adelante. Si un día no vienen, se libera ese día desde la
        lista de turnos.
      </p>
      <div className="flex justify-end gap-2 border-t border-borde pt-4">
        <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </button>
        <button type="submit" className="boton-primario" disabled={guardando}>
          {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Anotar turno fijo"}
        </button>
      </div>
    </form>
  );
}

// Lista de turnos fijos con alta, cambios y baja
function TurnosFijos({ precioHora, onCambio }) {
  const [fijos, setFijos] = useState(null);
  const [editando, setEditando] = useState(null); // null | {} (nuevo) | fijo
  const [aBorrar, setABorrar] = useState(null);
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    let activo = true;
    supabase
      .from("cancha_fijos")
      .select("*")
      .order("dia_semana")
      .order("desde")
      .then(({ data, error }) => {
        if (!activo) return;
        if (error) toast.error(mensajeDeError(error, "No se pudieron cargar los turnos fijos."));
        setFijos(data ?? []);
      });
    return () => {
      activo = false;
    };
  }, [vuelta]);

  const listo = () => {
    setEditando(null);
    setVuelta((n) => n + 1);
    onCambio();
  };

  async function borrar() {
    const { error } = await supabase.from("cancha_fijos").delete().eq("id", aBorrar.id);
    if (error) return toast.error(mensajeDeError(error, "No se pudo borrar el turno fijo."));
    toast.success(`Borraste el turno fijo de ${aBorrar.cliente_nombre}`);
    setABorrar(null);
    listo();
  }

  if (editando) {
    return (
      <FormFijo key={editando.id ?? "nuevo"} inicial={editando} precioHora={precioHora} onCerrar={() => setEditando(null)} onGuardado={listo} />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-tinta-suave">Los que vienen todas las semanas el mismo día y hora.</p>
        <button type="button" className="boton-primario" onClick={() => setEditando({})}>
          <IconoMas className="size-4" /> Nuevo turno fijo
        </button>
      </div>
      {fijos === null ? (
        <Cargando texto="Cargando turnos fijos…" />
      ) : fijos.length === 0 ? (
        <p className="rounded-xl bg-fondo p-6 text-center text-sm text-tinta-suave">Todavía no hay turnos fijos.</p>
      ) : (
        <ul className="divide-y divide-borde rounded-xl bg-fondo px-3">
          {fijos.map((f) => (
            <li key={f.id} className={`flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm ${f.activo ? "" : "opacity-60"}`}>
              <span className="min-w-0">
                <span className="block font-semibold">
                  {DIAS[f.dia_semana]} {horario(f)} · {f.cliente_nombre}
                </span>
                <span className="text-xs text-tinta-suave">
                  {formatearPesos(f.precio)} · {textoDuracion(f.minutos)}
                  {f.cliente_telefono && ` · ${f.cliente_telefono}`}
                  {!f.activo && " · ya no viene"}
                </span>
              </span>
              <span className="flex gap-2">
                <button type="button" className="boton-secundario px-3 py-1.5 text-xs" onClick={() => setEditando(f)}>
                  <IconoEditar className="size-4" /> Editar
                </button>
                <button type="button" className="boton-secundario px-2.5 py-1.5 hover:text-brasa" onClick={() => setABorrar(f)} aria-label={`Borrar el turno fijo de ${f.cliente_nombre}`}>
                  <IconoBasura className="size-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Confirmar
        abierto={Boolean(aBorrar)}
        titulo="Borrar turno fijo"
        mensaje={`¿Borrar el turno fijo de ${aBorrar?.cliente_nombre ?? ""}? Se liberan los días que vienen que no estén pagados ni señados. Lo ya cobrado queda.`}
        textoConfirmar="Borrar"
        onConfirmar={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </div>
  );
}

// Solo dueño: precio por hora de la cancha (el empleado cobra ese)
function PrecioCancha({ precioHora, onCerrar, onGuardado }) {
  const [valor, setValor] = useState(precioHora != null ? String(precioHora) : "");
  const [guardando, setGuardando] = useState(false);

  async function guardar(e) {
    e.preventDefault();
    if (!(Number(valor) > 0)) return toast.error("Poné el precio por hora.");
    setGuardando(true);
    const { error } = await supabase.from("ajustes").upsert({ clave: "cancha_precio_hora", valor: Number(valor) });
    setGuardando(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo guardar el precio."));
    toast.success(`Precio de la cancha: ${formatearPesos(valor)} por hora`);
    onGuardado();
  }

  return (
    <form onSubmit={guardar} className="space-y-4" noValidate>
      <label className="block">
        <span className="etiqueta">Precio por hora (ARS)</span>
        <input type="number" min="0" step="100" inputMode="decimal" className="campo cifras text-lg sm:w-56" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus />
      </label>
      <p className="text-xs text-tinta-suave">
        Los empleados reservan y cobran a este precio (1 h 30 = una hora y media). Vos podés poner otro precio en un turno o en un turno fijo.
        Los turnos que ya están anotados mantienen su precio.
      </p>
      <div className="flex justify-end gap-2 border-t border-borde pt-4">
        <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </button>
        <button type="submit" className="boton-primario" disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar precio"}
        </button>
      </div>
    </form>
  );
}

function TarjetaTurno({ turno, onCobrar, onSenar, onEditar, onBorrar, onAnular, onNoVino }) {
  const { esDueno } = useRol();
  const cobrado = estaCobrado(turno);
  const senado = estaSenado(turno);
  const pagos = turno.ventas?.pagos ?? [];
  return (
    <li className={`tarjeta grid gap-3 p-4 sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:items-center ${cobrado ? "" : "bg-cancha-suave/40"}`}>
      <div>
        <p className="cifras text-lg font-bold leading-tight">{horario(turno)}</p>
        <p className="text-xs text-tinta-suave">{textoDuracion(turno.minutos)}</p>
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-semibold">
          <span className="truncate">{turno.cliente_nombre}</span>
          {turno.fijo_id && <Etiqueta clase="border-cancha/40 bg-cancha-suave text-cancha">Fijo</Etiqueta>}
        </p>
        <p className="text-xs text-tinta-suave">{[turno.cliente_telefono, turno.nota].filter(Boolean).join(" · ") || "Sin notas"}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span className="cifras font-semibold">{formatearPesos(turno.precio)}</span>
          {cobrado ? (
            <Etiqueta clase="border-emerald-300 bg-emerald-100 text-emerald-900">
              Cobrado #{turno.ventas.numero} · {textoPagos(pagos, formatearPesos)}
            </Etiqueta>
          ) : senado ? (
            <Etiqueta clase="border-sky-300 bg-sky-100 text-sky-900">
              Señado {formatearPesos(pagadoDe(turno))} · falta {formatearPesos(restaDe(turno))}
            </Etiqueta>
          ) : (
            <Etiqueta clase="border-amber-300 bg-amber-100 text-amber-900">Falta cobrar</Etiqueta>
          )}
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {cobrado ? (
          <button type="button" className="boton-secundario px-3 py-2 text-xs" onClick={() => imprimirTicketDeVenta(turno.ventas.id)}>
            <IconoRecibo className="size-4" /> Ticket
          </button>
        ) : (
          <>
            <button type="button" className="boton bg-emerald-600 px-3 py-2 text-xs text-white hover:bg-emerald-700" onClick={onCobrar}>
              <IconoCheck className="size-4" /> Cobrar
            </button>
            <button type="button" className="boton-secundario px-3 py-2 text-xs" onClick={onSenar}>
              Señar
            </button>
          </>
        )}
        {esDueno && senado && (
          <button type="button" className="boton-secundario px-3 py-2 text-xs" onClick={onNoVino}>
            No vino
          </button>
        )}
        {esDueno && turno.venta_id && (
          <button type="button" className="boton-secundario px-3 py-2 text-xs" onClick={onAnular}>
            <IconoAnular className="size-4" /> {cobrado ? "Anular cobro" : "Anular seña"}
          </button>
        )}
        <button type="button" className="boton-secundario px-3 py-2 text-xs" onClick={onEditar}>
          <IconoEditar className="size-4" /> Editar
        </button>
        {!turno.venta_id && (
          <button
            type="button"
            className="boton-secundario px-3 py-2 text-xs hover:text-brasa"
            onClick={onBorrar}
            aria-label={turno.fijo_id ? `Liberar este día del turno fijo de ${turno.cliente_nombre}` : `Borrar el turno de ${turno.cliente_nombre}`}
          >
            <IconoBasura className="size-4" /> {turno.fijo_id ? "Liberar día" : ""}
          </button>
        )}
      </div>
    </li>
  );
}

// Cancha de fútbol: turnos de alquiler por hora, señas, turnos fijos y su cobro.
// Lo cobrado entra en la caja y en Finanzas como venta de la "Cancha".
export default function Cancha() {
  const { esDueno } = useRol();
  const [fecha, setFecha] = useState(hoyInput);
  const [recarga, setRecarga] = useState(0);
  const [resultado, setResultado] = useState({ clave: null, turnos: [], error: null });
  const [precioHora, setPrecioHora] = useState(null);
  const [formulario, setFormulario] = useState(null); // turno a editar o { fecha, desde } para uno nuevo
  const [aCobrar, setACobrar] = useState(null);
  const [aSenar, setASenar] = useState(null);
  const [aBorrar, setABorrar] = useState(null);
  const [aAnular, setAAnular] = useState(null);
  const [noVino, setNoVino] = useState(null);
  const [verFijos, setVerFijos] = useState(false);
  const [editarPrecio, setEditarPrecio] = useState(false);
  const [procesando, setProcesando] = useState(false);

  const recargar = useCallback(() => setRecarga((n) => n + 1), []);

  // Precio por hora que fijó el dueño (null = no lo cargó)
  useEffect(() => {
    let activo = true;
    supabase
      .from("ajustes")
      .select("valor")
      .eq("clave", "cancha_precio_hora")
      .maybeSingle()
      .then(({ data }) => activo && setPrecioHora(data ? Number(data.valor) : null));
    return () => {
      activo = false;
    };
  }, [recarga]);

  // Antes de leer el día, la base anota los turnos fijos que tocan ese día
  const clave = `${fecha}-${recarga}`;
  useEffect(() => {
    let activo = true;
    supabase
      .rpc("preparar_turnos_fijos", { fecha })
      .then(() => supabase.from("cancha_turnos").select(COLUMNAS).eq("fecha", fecha).order("desde"))
      .then(({ data, error }) => activo && setResultado({ clave, turnos: data ?? [], error }));
    return () => {
      activo = false;
    };
  }, [fecha, clave]);

  const cargando = resultado.clave !== clave && resultado.turnos.length === 0;
  const turnos = resultado.turnos;

  const resumen = useMemo(() => {
    const pendientes = turnos.filter((t) => !estaCobrado(t));
    return {
      horas: turnos.reduce((acc, t) => acc + t.minutos, 0) / 60,
      cobrado: turnos.reduce((acc, t) => acc + pagadoDe(t), 0),
      senas: turnos.filter(estaSenado).length,
      falta: pendientes.reduce((acc, t) => acc + restaDe(t), 0),
      pendientes: pendientes.length,
    };
  }, [turnos]);

  // Una hora está ocupada si algún turno la pisa, aunque sea en parte
  const ocupada = (hora) =>
    turnos.find((t) => {
      const inicio = aMinutos(t.desde);
      return inicio < (hora + 1) * 60 && hora * 60 < inicio + t.minutos;
    });

  async function accion(fn, exito, porDefecto) {
    setProcesando(true);
    const { error } = await fn();
    setProcesando(false);
    if (error) return toast.error(mensajeDeError(error, porDefecto));
    toast.success(exito);
    setABorrar(null);
    setAAnular(null);
    setNoVino(null);
    recargar();
  }

  const esHoy = fecha === hoyInput();
  const diaSemana = desdeInput(fecha).toLocaleDateString("es-AR", { weekday: "long" });
  const terminar = (setter) => () => {
    setter(null);
    recargar();
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cancha px-4 py-3 text-white">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-white/10">
            <IconoPelota className="size-6" />
          </span>
          <div>
            <p className="text-lg font-bold uppercase tracking-wide">Cancha</p>
            <p className="text-xs text-white/75">
              {precioHora != null ? `${formatearPesos(precioHora)} la hora` : "Precio por hora sin fijar"}
              {esDueno && (
                <button type="button" className="ml-2 underline hover:text-white" onClick={() => setEditarPrecio(true)}>
                  Cambiar
                </button>
              )}
              {" · "}Lo cobrado entra en la caja y en Finanzas.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-xl border border-white/40 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10" onClick={() => setVerFijos(true)}>
            <span className="flex items-center gap-1.5">
              <IconoCalendario className="size-4" /> Turnos fijos
            </span>
          </button>
          <button type="button" className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-cancha hover:bg-cancha-suave" onClick={() => setFormulario({ fecha })}>
            <span className="flex items-center gap-1.5">
              <IconoMas className="size-4" /> Nuevo turno
            </span>
          </button>
        </div>
      </div>

      {esDueno && precioHora == null && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Fijá el <strong>precio por hora de la cancha</strong> (botón "Cambiar" de arriba): así los empleados cobran siempre ese precio y no
          lo pueden cambiar.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="boton-secundario px-3 py-2" onClick={() => setFecha((f) => sumarDias(f, -1))} aria-label="Día anterior">
          ‹
        </button>
        <input type="date" className="campo w-auto" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} aria-label="Día" />
        <button type="button" className="boton-secundario px-3 py-2" onClick={() => setFecha((f) => sumarDias(f, 1))} aria-label="Día siguiente">
          ›
        </button>
        {!esHoy && (
          <button type="button" className="boton-secundario px-3 py-2 text-xs" onClick={() => setFecha(hoyInput())}>
            Hoy
          </button>
        )}
        <span className="text-sm font-medium capitalize text-tinta-suave">
          {esHoy ? "Hoy, " : ""}
          {diaSemana} {formatearFecha(fecha)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Resumen titulo="Turnos del día" valor={turnos.length} detalle={`${resumen.horas.toLocaleString("es-AR")} h reservadas`} />
        <Resumen titulo="Cobrado (con señas)" valor={formatearPesos(resumen.cobrado)} detalle={resumen.senas ? `${resumen.senas} señado${resumen.senas === 1 ? "" : "s"}` : null} />
        <Resumen titulo="Falta cobrar" valor={formatearPesos(resumen.falta)} detalle={resumen.pendientes ? `${resumen.pendientes} sin cobrar del todo` : "Todo cobrado"} />
        <Resumen titulo="Horas libres" valor={HORAS.filter((h) => !ocupada(h)).length} detalle="de 08:00 a 24:00" />
      </div>

      <div>
        <p className="etiqueta">Grilla del día (tocá una hora libre para reservarla)</p>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8 lg:grid-cols-16">
          {HORAS.map((h) => {
            const turno = ocupada(h);
            return (
              <button
                key={h}
                type="button"
                onClick={() => (turno ? setFormulario(turno) : setFormulario({ fecha, desde: aHora(h * 60) }))}
                title={turno ? `${horario(turno)} · ${turno.cliente_nombre}` : "Libre"}
                aria-label={turno ? `${aHora(h * 60)} ocupada: ${turno.cliente_nombre}` : `${aHora(h * 60)} libre: reservar`}
                className={`rounded-lg border px-1 py-2 text-center text-xs font-semibold transition ${
                  !turno
                    ? "border-borde bg-papel text-tinta-suave hover:border-cancha hover:text-cancha"
                    : estaCobrado(turno)
                      ? "border-cancha bg-cancha text-white"
                      : estaSenado(turno)
                        ? "border-cancha bg-cancha/60 text-white"
                        : "border-cancha bg-cancha-suave text-cancha"
                }`}
              >
                {aHora(h * 60)}
                <span className="block truncate text-[10px] font-normal">{turno ? turno.cliente_nombre : "Libre"}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-tinta-suave">Verde lleno: cobrado · Verde medio: señado · Verde claro: reservado, falta cobrar.</p>
      </div>

      {cargando ? (
        <Cargando texto="Cargando turnos…" />
      ) : resultado.error ? (
        <div className="tarjeta p-6 text-center text-sm">
          <p className="font-semibold">No pudimos cargar los turnos.</p>
          <p className="text-tinta-suave">{mensajeDeError(resultado.error, "Revisá la conexión. Si recién se actualizó el sistema, falta correr el SQL nuevo.")}</p>
          <button type="button" className="boton-primario mt-3" onClick={recargar}>
            Reintentar
          </button>
        </div>
      ) : turnos.length === 0 ? (
        <div className="tarjeta p-8 text-center text-tinta-suave">No hay turnos reservados para este día.</div>
      ) : (
        <ul className="space-y-2">
          {turnos.map((t) => (
            <TarjetaTurno
              key={t.id}
              turno={t}
              onCobrar={() => setACobrar(t)}
              onSenar={() => setASenar(t)}
              onEditar={() => setFormulario(t)}
              onBorrar={() => setABorrar(t)}
              onAnular={() => setAAnular(t)}
              onNoVino={() => setNoVino(t)}
            />
          ))}
        </ul>
      )}

      <Modal
        abierto={Boolean(formulario)}
        onCerrar={() => setFormulario(null)}
        titulo={formulario?.id ? `Turno de ${formulario.cliente_nombre}` : "Nuevo turno de cancha"}
        ancho="max-w-xl"
      >
        {formulario && (
          <FormTurno
            key={formulario.id ?? `${formulario.fecha}-${formulario.desde}`}
            inicial={formulario}
            precioHora={precioHora}
            onCerrar={() => setFormulario(null)}
            onGuardado={terminar(setFormulario)}
          />
        )}
      </Modal>

      <Modal abierto={Boolean(aCobrar)} onCerrar={() => setACobrar(null)} titulo="Cobrar turno de cancha" ancho="max-w-lg">
        {aCobrar && <CobrarTurno key={aCobrar.id} turno={aCobrar} onCerrar={() => setACobrar(null)} onCobrado={terminar(setACobrar)} />}
      </Modal>

      <Modal abierto={Boolean(aSenar)} onCerrar={() => setASenar(null)} titulo="Registrar seña" ancho="max-w-md">
        {aSenar && <SenarTurno key={aSenar.id} turno={aSenar} onCerrar={() => setASenar(null)} onSenado={terminar(setASenar)} />}
      </Modal>

      <Modal abierto={verFijos} onCerrar={() => setVerFijos(false)} titulo="Turnos fijos" ancho="max-w-xl">
        {verFijos && <TurnosFijos precioHora={precioHora} onCambio={recargar} />}
      </Modal>

      <Modal abierto={editarPrecio} onCerrar={() => setEditarPrecio(false)} titulo="Precio de la cancha" ancho="max-w-md">
        {editarPrecio && (
          <PrecioCancha
            precioHora={precioHora}
            onCerrar={() => setEditarPrecio(false)}
            onGuardado={() => {
              setEditarPrecio(false);
              recargar();
            }}
          />
        )}
      </Modal>

      <Confirmar
        abierto={Boolean(aBorrar)}
        titulo={aBorrar?.fijo_id ? "Liberar este día" : "Borrar turno"}
        mensaje={
          aBorrar?.fijo_id
            ? `¿${aBorrar.cliente_nombre} no viene este día (${horario(aBorrar)})? La hora queda libre solo hoy; el turno fijo sigue las otras semanas.`
            : `¿Borrar el turno de ${aBorrar?.cliente_nombre ?? ""} (${aBorrar ? horario(aBorrar) : ""})? La hora queda libre.`
        }
        textoConfirmar={aBorrar?.fijo_id ? "Liberar día" : "Borrar"}
        procesando={procesando}
        onConfirmar={() =>
          accion(
            () => supabase.from("cancha_turnos").delete().eq("id", aBorrar.id),
            aBorrar.fijo_id ? "Día liberado" : `Borraste el turno de ${aBorrar.cliente_nombre}`,
            "No se pudo borrar el turno."
          )
        }
        onCancelar={() => setABorrar(null)}
      />

      <Confirmar
        abierto={Boolean(aAnular)}
        titulo={aAnular && estaCobrado(aAnular) ? "Anular el cobro del turno" : "Anular la seña"}
        mensaje="Se borra lo cobrado del turno, señas incluidas (sale de la caja y de la cuenta corriente, si se había fiado), y el turno queda reservado sin cobrar. Si ya está en un arqueo cerrado, no se puede anular."
        textoConfirmar="Anular"
        procesando={procesando}
        onConfirmar={() => accion(() => supabase.rpc("anular_cobro_cancha", { turno_id: aAnular.id }), "Cobro anulado: el turno quedó sin cobrar", "No se pudo anular el cobro.")}
        onCancelar={() => setAAnular(null)}
      />

      <Confirmar
        abierto={Boolean(noVino)}
        titulo="No vino: queda la seña"
        mensaje={`Se cierra el turno de ${noVino?.cliente_nombre ?? ""} cobrando solo la seña (${noVino ? formatearPesos(pagadoDe(noVino)) : ""}). Lo que faltaba no se cobra.`}
        textoConfirmar="Cerrar con la seña"
        procesando={procesando}
        onConfirmar={() => accion(() => supabase.rpc("cerrar_turno_con_sena", { turno_id: noVino.id }), "Turno cerrado con la seña", "No se pudo cerrar el turno.")}
        onCancelar={() => setNoVino(null)}
      />
    </section>
  );
}
