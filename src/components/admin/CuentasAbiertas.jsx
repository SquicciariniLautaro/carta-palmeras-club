import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { fechaInput, formatearFecha, formatearHora, formatearPesos, normalizarTexto } from "../../lib/formato";
import { imprimirTicket } from "../../lib/impresion";
import { IconoActualizar, IconoBasura, IconoBuscar, IconoCheck, IconoEditar, IconoMas, IconoPelota, IconoRecibo, IconoRegalo, IconoReloj, IconoVaso } from "../ui/Iconos";
import Cargando from "../ui/Cargando";
import Confirmar from "../ui/Confirmar";
import Modal from "../ui/Modal";
import SumarACuenta from "./SumarACuenta";
import CobrarVenta from "./CobrarVenta";
import CobrarTurno from "./CobrarTurno";
import EditarVenta from "./EditarVenta";
import { ESTADOS_ABIERTOS, TURNOS, pagadoDeVenta, tiempoDesde, valorRegalos } from "./ventasUtils";
import { COLUMNAS_TURNO, aMinutos, estaCobrado, horario, pagadoDe, totalTurnoDe } from "./canchaUtils";

const COLUMNAS_VENTA = "*, venta_items(*), pagos(id, metodo, monto, cliente_id, usuario, clientes(nombre))";
// Turnos de cancha sin cobrar de los últimos días (los de más atrás se ven en Cancha)
const DIAS_CANCHA = 7;
// Un turno de hoy aparece desde un rato antes de empezar
const ANTES_DEL_TURNO_MIN = 30;

function inicioDeHoy() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function obtenerCuentas() {
  const hoy = fechaInput(new Date());
  const desde = fechaInput(Date.now() - (DIAS_CANCHA - 1) * 864e5);
  // Los turnos fijos de hoy se anotan solos (como en la grilla de Cancha)
  await supabase.rpc("preparar_turnos_fijos", { fecha: hoy });
  const [ventas, turnos, regalos] = await Promise.all([
    supabase.from("ventas").select(COLUMNAS_VENTA).eq("es_cuenta", true).in("estado", ESTADOS_ABIERTOS).order("created_at").limit(300),
    supabase.from("cancha_turnos").select(COLUMNAS_TURNO).gte("fecha", desde).lte("fecha", hoy).order("fecha").order("desde"),
    supabase
      .from("venta_items")
      .select("id, nombre, detalle, cantidad, precio_lista, ventas!inner(id, numero, cliente_nombre, created_at, turno, estado)")
      .eq("regalo", true)
      .gte("ventas.created_at", inicioDeHoy().toISOString())
      .limit(500),
  ]);
  const error = [ventas, turnos].find((r) => r.error)?.error;
  if (error) throw error;
  return { ventas: ventas.data, turnos: turnos.data, regalos: regalos.data ?? [] };
}

// Turno de cancha que ya es una cuenta para cobrar: de días anteriores, de hoy si ya
// está por empezar, o si ya tiene consumos o seña anotados
function turnoPendiente(t, ahora) {
  if (estaCobrado(t)) return false;
  const hoy = fechaInput(new Date(ahora));
  if (t.fecha < hoy || t.venta_id) return true;
  const minutosAhora = new Date(ahora).getHours() * 60 + new Date(ahora).getMinutes();
  return aMinutos(t.desde) - ANTES_DEL_TURNO_MIN <= minutosAhora;
}

// Mesas, barra y cancha en una sola lista con la misma forma
function armarCuentas(datos, ahora) {
  const mesas = datos.ventas.map((v) => ({
    clave: `v-${v.id}`,
    tipo: "mesa",
    nombre: v.cliente_nombre || `Cuenta #${v.numero}`,
    etiqueta: `${TURNOS[v.turno]?.corto ?? ""} · #${v.numero}`,
    desde: v.created_at,
    items: v.venta_items ?? [],
    total: Number(v.total),
    pagado: pagadoDeVenta(v),
    venta: v,
  }));
  const cancha = datos.turnos
    .filter((t) => turnoPendiente(t, ahora))
    .map((t) => ({
      clave: `t-${t.id}`,
      tipo: "cancha",
      nombre: t.cliente_nombre,
      etiqueta: `${t.fecha === fechaInput(new Date(ahora)) ? "Hoy" : formatearFecha(t.fecha)} · ${horario(t)}`,
      desde: null,
      items: t.ventas?.venta_items ?? [{ id: "alquiler", nombre: "Alquiler de cancha", cantidad: 1, subtotal: t.precio, comida_id: null }],
      total: totalTurnoDe(t),
      pagado: pagadoDe(t),
      turno: t,
      venta: t.ventas,
    }));
  return [...cancha, ...mesas].map((c) => ({ ...c, falta: Math.round((c.total - c.pagado) * 100) / 100 }));
}

function Resumen({ titulo, valor, detalle, tono = "" }) {
  return (
    <div className="tarjeta p-4">
      <p className="text-xs text-tinta-suave">{titulo}</p>
      <p className={`cifras mt-1 text-xl font-bold sm:text-2xl ${tono}`}>{valor}</p>
      {detalle && <p className="text-xs text-tinta-suave">{detalle}</p>}
    </div>
  );
}

function TarjetaCuenta({ cuenta, ahora, onSumar, onRegalo, onCobrar, onTicket, onEditar, onBorrar }) {
  const esCancha = cuenta.tipo === "cancha";
  const regalos = valorRegalos(cuenta.items);
  return (
    <li className={`tarjeta animate-entrar flex flex-col gap-3 border-l-4 p-4 shadow-sm ${esCancha ? "border-l-cancha" : "border-l-cuenta"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold leading-tight">{cuenta.nombre}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                esCancha ? "bg-cancha-suave text-cancha" : "bg-cuenta-suave text-cuenta"
              }`}
            >
              {esCancha ? <IconoPelota className="size-3.5" /> : <IconoVaso className="size-3.5" />}
              {esCancha ? "Cancha" : "Mesa / barra"}
            </span>
            <span className="text-tinta-suave">{cuenta.etiqueta}</span>
          </p>
        </div>
        {cuenta.desde && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-tinta-suave" title={`Abierta a las ${formatearHora(cuenta.desde)}`}>
            <IconoReloj className="size-3.5" /> {tiempoDesde(cuenta.desde, ahora)}
          </span>
        )}
      </div>

      {cuenta.items.length === 0 ? (
        <p className="text-sm text-tinta-suave">Sin consumos todavía.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {cuenta.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3">
              <span className="min-w-0">
                <strong>{i.cantidad}x</strong> {i.nombre}
                {i.regalo ? (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-regalo-suave px-1.5 text-[11px] font-semibold text-regalo">
                    <IconoRegalo className="size-3" /> regalo
                  </span>
                ) : (
                  i.detalle && <span className="block pl-5 text-xs text-tinta-suave">{i.detalle}</span>
                )}
              </span>
              <span className="cifras shrink-0">{i.regalo ? "$ 0" : formatearPesos(i.subtotal)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto space-y-2 border-t border-borde pt-3">
        {(cuenta.pagado > 0 || regalos > 0) && (
          <div className="cifras space-y-0.5 text-xs text-tinta-suave">
            <p className="flex justify-between">
              <span>Total de la cuenta</span>
              <span>{formatearPesos(cuenta.total)}</span>
            </p>
            {cuenta.pagado > 0 && (
              <p className="flex justify-between">
                <span>Ya pagó (seña)</span>
                <span>− {formatearPesos(cuenta.pagado)}</span>
              </p>
            )}
            {regalos > 0 && (
              <p className="flex justify-between font-semibold text-regalo">
                <span>Regalado (no se cobra)</span>
                <span>{formatearPesos(regalos)}</span>
              </p>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">Falta cobrar</span>
          <span className="cifras text-2xl font-bold">{formatearPesos(cuenta.falta)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="boton-secundario py-2.5" onClick={onSumar}>
            <IconoMas className="size-4" /> Sumar
          </button>
          <button type="button" className="boton-secundario py-2.5 text-regalo" onClick={onRegalo}>
            <IconoRegalo className="size-4" /> Regalo
          </button>
        </div>
        <button type="button" className="boton w-full bg-emerald-600 py-3 text-base text-white shadow-md hover:bg-emerald-700" onClick={onCobrar}>
          <IconoCheck className="size-5" /> Cobrar y cerrar
        </button>
        <div className="flex flex-wrap items-center justify-end gap-0.5">
          <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-tinta-suave hover:bg-borde hover:text-tinta" onClick={onTicket}>
            <IconoRecibo className="size-4" /> Precuenta
          </button>
          {cuenta.venta && (
            <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-tinta-suave hover:bg-borde hover:text-tinta" onClick={onEditar}>
              <IconoEditar className="size-4" /> Corregir
            </button>
          )}
          {!esCancha && cuenta.pagado === 0 && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-tinta-suave hover:bg-borde hover:text-rojo"
              onClick={onBorrar}
              aria-label={`Cancelar la cuenta ${cuenta.nombre}`}
            >
              <IconoBasura className="size-4" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// Cuentas que pagan al final: mesas y barra (se van sumando cosas y se cobra todo
// junto) y los turnos de cancha que todavía no se cobraron, con lo que consumieron.
// Aparte del tablero de pedidos (delivery y carta online).
export default function CuentasAbiertas({ comidas, categorias, actualizacion = 0, onCambio }) {
  const [recarga, setRecarga] = useState(0);
  const [resultado, setResultado] = useState({ vuelta: null, datos: null, error: null });
  const [ahora, setAhora] = useState(() => Date.now());
  const [busqueda, setBusqueda] = useState("");
  const [aSumar, setASumar] = useState(null);
  const [aCobrar, setACobrar] = useState(null); // cuenta
  const [aEditar, setAEditar] = useState(null); // venta
  const [aBorrar, setABorrar] = useState(null); // cuenta
  const [borrando, setBorrando] = useState(false);

  const vuelta = `${recarga}-${actualizacion}`;
  useEffect(() => {
    let activo = true;
    obtenerCuentas()
      .then((datos) => activo && setResultado({ vuelta, datos, error: null }))
      .catch((error) => activo && setResultado({ vuelta, datos: null, error }));
    return () => {
      activo = false;
    };
  }, [vuelta]);

  // Reloj para el "hace X" y para que los turnos de cancha aparezcan cuando empiezan
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const recargar = () => {
    setRecarga((n) => n + 1);
    setAhora(() => Date.now());
    onCambio?.();
  };
  const listo = (setter) => () => {
    setter(null);
    recargar();
  };

  const cuentas = useMemo(() => (resultado.datos ? armarCuentas(resultado.datos, ahora) : []), [resultado.datos, ahora]);
  const visibles = useMemo(() => {
    const texto = normalizarTexto(busqueda);
    return texto ? cuentas.filter((c) => normalizarTexto(c.nombre).includes(texto)) : cuentas;
  }, [cuentas, busqueda]);
  const regalosHoy = useMemo(
    () =>
      (resultado.datos?.regalos ?? [])
        .map((r) => ({ ...r, valor: Number(r.precio_lista ?? 0) * r.cantidad }))
        .sort((a, b) => b.ventas.created_at.localeCompare(a.ventas.created_at)),
    [resultado.datos]
  );
  const totalRegalado = regalosHoy.reduce((acc, r) => acc + r.valor, 0);
  const unidadesRegaladas = regalosHoy.reduce((acc, r) => acc + r.cantidad, 0);
  const falta = cuentas.reduce((acc, c) => acc + c.falta, 0);

  function precuenta(cuenta) {
    imprimirTicket(
      cuenta.venta
        ? { ...cuenta.venta, venta_items: cuenta.items }
        : { numero: "—", created_at: new Date().toISOString(), cliente_nombre: `Cancha · ${cuenta.nombre}`, total: cuenta.total, venta_items: cuenta.items },
      cuenta.venta?.pagos ?? []
    );
  }

  async function borrar() {
    setBorrando(true);
    const { error } = await supabase.from("ventas").delete().eq("id", aBorrar.venta.id);
    setBorrando(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo cancelar la cuenta."));
    toast.success(`Cancelaste la cuenta ${aBorrar.nombre}. Lo que tenía vuelve al stock.`);
    setABorrar(null);
    recargar();
  }

  const cargando = resultado.vuelta !== vuelta && !resultado.datos;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cuenta px-4 py-3 text-white">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-white/10">
            <IconoVaso className="size-6" />
          </span>
          <div>
            <p className="text-lg font-bold uppercase tracking-wide">Cuentas abiertas</p>
            <p className="text-xs text-white/75">Mesas, barra y cancha: van sumando lo que piden y pagan al final. Aparte de los pedidos de delivery.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-xl border border-white/40 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10" onClick={recargar} aria-label="Actualizar">
            <IconoActualizar className="size-4" />
          </button>
          <button
            type="button"
            className="rounded-xl border border-white/40 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
            onClick={() => setASumar({ tipo: "regalo" })}
          >
            <span className="flex items-center gap-1.5">
              <IconoRegalo className="size-4" /> Anotar regalo
            </span>
          </button>
          <button type="button" className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-cuenta hover:bg-cuenta-suave" onClick={() => setASumar({ tipo: "nueva" })}>
            <span className="flex items-center gap-1.5">
              <IconoMas className="size-4" /> Nueva cuenta
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Resumen
          titulo="Cuentas abiertas"
          valor={cuentas.length}
          detalle={`${cuentas.filter((c) => c.tipo === "mesa").length} de mesa o barra · ${cuentas.filter((c) => c.tipo === "cancha").length} de cancha`}
        />
        <Resumen titulo="Falta cobrar" valor={formatearPesos(falta)} detalle="Suma de todas las cuentas abiertas" />
        <Resumen
          titulo="Regalado hoy"
          valor={formatearPesos(totalRegalado)}
          tono="text-regalo"
          detalle={unidadesRegaladas ? `${unidadesRegaladas} unidad${unidadesRegaladas === 1 ? "" : "es"} · a precio de carta` : "Nada por ahora"}
        />
      </div>

      {cuentas.length > 6 && (
        <label className="relative block sm:max-w-sm">
          <span className="sr-only">Buscar cuenta</span>
          <IconoBuscar className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-suave" />
          <input type="search" className="campo pl-9" placeholder="Buscar mesa o nombre…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </label>
      )}

      {cargando ? (
        <Cargando texto="Cargando cuentas…" />
      ) : resultado.error ? (
        <div className="tarjeta p-6 text-center text-sm">
          <p className="font-semibold">No pudimos cargar las cuentas.</p>
          <p className="text-tinta-suave">{mensajeDeError(resultado.error, "Revisá la conexión. Si recién se actualizó el sistema, falta correr el SQL nuevo.")}</p>
          <button type="button" className="boton-primario mt-3" onClick={recargar}>
            Reintentar
          </button>
        </div>
      ) : cuentas.length === 0 ? (
        <div className="tarjeta p-8 text-center">
          <p className="font-semibold">No hay cuentas abiertas.</p>
          <p className="mt-1 text-sm text-tinta-suave">
            Cuando una mesa o alguien en la barra pide y paga al final, tocá "Nueva cuenta". Los turnos de cancha sin cobrar aparecen solos.
          </p>
        </div>
      ) : visibles.length === 0 ? (
        <p className="tarjeta p-6 text-center text-sm text-tinta-suave">No hay cuentas con ese nombre.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibles.map((c) => (
            <TarjetaCuenta
              key={c.clave}
              cuenta={c}
              ahora={ahora}
              onSumar={() => setASumar(c.tipo === "cancha" ? { tipo: "turno", turno: c.turno } : { tipo: "venta", venta: c.venta })}
              onRegalo={() =>
                setASumar(c.tipo === "cancha" ? { tipo: "turno", turno: c.turno, regalo: true } : { tipo: "venta", venta: c.venta, regalo: true })
              }
              onCobrar={() => setACobrar(c)}
              onTicket={() => precuenta(c)}
              onEditar={() => setAEditar(c.venta)}
              onBorrar={() => setABorrar(c)}
            />
          ))}
        </ul>
      )}

      {regalosHoy.length > 0 && (
        <div className="tarjeta p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <IconoRegalo className="size-4 text-regalo" /> Regalos de hoy
          </h2>
          <ul className="divide-y divide-borde text-sm">
            {regalosHoy.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span className="min-w-0">
                  <strong>{r.cantidad}x</strong> {r.nombre}
                  <span className="text-xs text-tinta-suave">
                    {" "}
                    · {r.ventas.cliente_nombre || `#${r.ventas.numero}`}
                    {r.detalle && r.detalle !== "Regalo" ? ` · ${r.detalle.replace(/^Regalo · /, "")}` : ""}
                  </span>
                </span>
                <span className="cifras shrink-0 text-regalo">{formatearPesos(r.valor)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-tinta-suave">
            Valen lo que cuestan en la carta. Descuentan el stock y se ven en Finanzas → Regalos. El dueño ve quién anotó cada uno en Actividad.
          </p>
        </div>
      )}

      <SumarACuenta destino={aSumar} comidas={comidas} categorias={categorias} onCerrar={() => setASumar(null)} onListo={listo(setASumar)} />

      <CobrarVenta venta={aCobrar?.tipo === "mesa" ? aCobrar.venta : null} onCerrar={() => setACobrar(null)} onCobrada={listo(setACobrar)} />

      <Modal abierto={aCobrar?.tipo === "cancha"} onCerrar={() => setACobrar(null)} titulo="Cobrar turno de cancha" ancho="max-w-lg">
        {aCobrar?.tipo === "cancha" && (
          <CobrarTurno key={aCobrar.turno.id} turno={aCobrar.turno} onCerrar={() => setACobrar(null)} onCobrado={listo(setACobrar)} />
        )}
      </Modal>

      <EditarVenta venta={aEditar} comidas={comidas} onCerrar={() => setAEditar(null)} onGuardada={listo(setAEditar)} />

      <Confirmar
        abierto={Boolean(aBorrar)}
        titulo={`Cancelar la cuenta ${aBorrar?.nombre ?? ""}`}
        mensaje="Se borra la cuenta con todo lo anotado (no queda en el historial) y lo que tenía de bebidas o golosinas vuelve al stock. Si ya pagaron, cobrala en vez de cancelarla."
        textoConfirmar="Cancelar cuenta"
        procesando={borrando}
        onConfirmar={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </section>
  );
}

