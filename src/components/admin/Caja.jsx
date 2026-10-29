import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { formatearFechaHora, formatearPesos } from "../../lib/formato";
import { descargarExcel } from "../../lib/excel";
import { hojaArqueos } from "../../lib/reportes";
import { imprimirArqueo } from "../../lib/impresion";
import { useCaja } from "../../hooks/useCaja";
import { nombreUsuario, useRol } from "../../hooks/useRol";
import { IconoAlerta, IconoBasura, IconoCaja, IconoCandado, IconoExcel, IconoImpresora, IconoMas, IconoOjo } from "../ui/Iconos";
import Cargando from "../ui/Cargando";
import Confirmar from "../ui/Confirmar";
import Modal from "../ui/Modal";
import { ESTADOS_ABIERTOS, METODOS_PAGO, RANGOS_MES, TURNOS, calcularRango, sufijoArchivo, textoPeriodo } from "./ventasUtils";

// Billetes y monedas en circulación (pesos argentinos)
const DENOMINACIONES = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10];

function totalConteo(conteo) {
  return DENOMINACIONES.reduce((acc, d) => acc + d * (Number(conteo[d]) || 0), 0) + (Number(conteo.monedas) || 0);
}

function Fila({ texto, valor, signo = "", fuerte = false, claro = false }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 ${fuerte ? "border-t border-borde pt-2.5 text-base font-bold" : "text-sm"}`}>
      <span className={claro ? "text-tinta-suave" : ""}>{texto}</span>
      <span className="cifras whitespace-nowrap">
        {signo}
        {formatearPesos(valor)}
      </span>
    </div>
  );
}

// Desglose del efectivo y de lo vendido en un arqueo
function DesgloseArqueo({ r }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl bg-fondo p-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-tinta-suave">Efectivo en la caja</p>
        <Fila texto="Efectivo inicial" valor={r.monto_inicial} />
        <Fila texto="Ventas en efectivo" valor={r.ventas_efectivo} signo="+ " />
        <Fila texto="Pagos de cuentas corrientes" valor={r.cobros_cuenta_efectivo} signo="+ " />
        <Fila texto="Ingresos de efectivo" valor={r.ingresos} signo="+ " />
        <Fila texto="Retiros" valor={r.retiros} signo="− " />
        <Fila texto="Gastos pagados con la caja" valor={r.gastos_efectivo} signo="− " />
        <Fila texto="Efectivo que tiene que haber" valor={r.efectivo_esperado} fuerte />
      </div>
      <div className="rounded-xl bg-fondo p-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-tinta-suave">Ventas del arqueo</p>
        <Fila texto="En efectivo" valor={r.ventas_efectivo} />
        <Fila texto="Por transferencia" valor={r.ventas_transferencia} />
        <Fila texto="A cuenta corriente (fiado)" valor={r.ventas_cuenta_corriente} />
        <Fila texto={`Total vendido · ${r.cantidad_ventas ?? 0} ventas`} valor={r.total_vendido} fuerte />
        <Fila texto="Venta noche" valor={r.vendido_noche} claro />
        <Fila texto="Venta mediodía" valor={r.vendido_mediodia} claro />
        {Number(r.vendido_cancha) > 0 && <Fila texto="Cancha" valor={r.vendido_cancha} claro />}
        <Fila texto="Transferencias recibidas (ventas + cuentas)" valor={r.total_transferencias} claro />
      </div>
    </div>
  );
}

function AbrirCaja({ onAbierta }) {
  const [inicial, setInicial] = useState("");
  const [turno, setTurno] = useState("");
  const [nota, setNota] = useState("");
  const [abriendo, setAbriendo] = useState(false);

  async function abrir(e) {
    e.preventDefault();
    setAbriendo(true);
    const { data, error } = await supabase.rpc("abrir_caja", {
      monto_inicial: Number(inicial) || 0,
      turno: turno || null,
      nota: nota.trim() || null,
    });
    setAbriendo(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo abrir la caja."));
    toast.success(`Caja abierta · arqueo N° ${data.numero}`);
    onAbierta();
  }

  return (
    <form onSubmit={abrir} className="tarjeta mx-auto max-w-lg space-y-4 p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-amber-100 text-amber-900">
          <IconoCandado className="size-6" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">La caja está cerrada</h2>
          <p className="text-sm text-tinta-suave">Abrila para empezar el arqueo y poder cobrar en efectivo o por transferencia.</p>
        </div>
      </div>
      <label className="block">
        <span className="etiqueta">Efectivo inicial (cambio con el que arranca la caja)</span>
        <input type="number" min="0" step="0.01" inputMode="decimal" className="campo cifras text-lg" placeholder="0" value={inicial} onChange={(e) => setInicial(e.target.value)} />
      </label>
      <label className="block">
        <span className="etiqueta">Turno (opcional)</span>
        <select className="campo" value={turno} onChange={(e) => setTurno(e.target.value)}>
          <option value="">Todo el día</option>
          <option value="mediodia">Mediodía</option>
          <option value="noche">Noche</option>
        </select>
      </label>
      <label className="block">
        <span className="etiqueta">Nota (opcional)</span>
        <input className="campo" maxLength={500} value={nota} onChange={(e) => setNota(e.target.value)} />
      </label>
      <button type="submit" className="boton-primario w-full py-3 text-base" disabled={abriendo}>
        <IconoCaja className="size-5" /> {abriendo ? "Abriendo…" : "Abrir caja"}
      </button>
    </form>
  );
}

function CajaAbierta({ caja, actualizacion, onCambio }) {
  const { recargar: recargarCaja } = useCaja();
  const { esDueno } = useRol();
  const [datos, setDatos] = useState({ clave: null, resumen: null, movimientos: [], huerfanos: [], pendientes: 0, error: null });
  const [vuelta, setVuelta] = useState(0);
  const [movimiento, setMovimiento] = useState({ tipo: "retiro", concepto: "", monto: "" });
  const [conteo, setConteo] = useState(() => ({ ...(caja.conteo ?? {}) }));
  const [contadoDirecto, setContadoDirecto] = useState(() => (caja.efectivo_contado != null && !Object.keys(caja.conteo ?? {}).length ? String(caja.efectivo_contado) : ""));
  const [notaCierre, setNotaCierre] = useState("");
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const clave = `${caja.id}-${vuelta}-${actualizacion}`;

  useEffect(() => {
    let activo = true;
    Promise.all([
      supabase.rpc("resumen_caja", { caja_id: caja.id }),
      supabase.from("pagos").select("id, created_at, metodo, monto, concepto, nota, usuario, ventas(numero, turno), clientes(nombre)").eq("caja_id", caja.id).order("created_at", { ascending: false }),
      supabase.from("caja_movimientos").select("*").eq("caja_id", caja.id).order("created_at", { ascending: false }),
      supabase.from("gastos").select("id, created_at, descripcion, categoria, monto").eq("caja_id", caja.id).order("created_at", { ascending: false }),
      supabase.from("pagos").select("id, monto").is("caja_id", null),
      supabase.from("ventas").select("id", { count: "exact", head: true }).in("estado", ESTADOS_ABIERTOS),
    ]).then(([resumen, pagos, movs, gastos, huerfanos, pendientes]) => {
      if (!activo) return;
      const error = resumen.error || pagos.error || movs.error || gastos.error;
      const movimientos = [
        ...(pagos.data ?? []).map((p) => ({
          id: `p-${p.id}`,
          fecha: p.created_at,
          texto: p.concepto === "cobro_cuenta" ? `Pago de cuenta corriente · ${p.clientes?.nombre ?? ""}` : `Venta #${p.ventas?.numero ?? "—"} · ${TURNOS[p.ventas?.turno]?.corto ?? ""}`,
          detalle:
            (p.nota === "Seña" ? "Seña · " : "") +
            METODOS_PAGO[p.metodo]?.nombre +
            (p.clientes?.nombre && p.concepto === "venta" ? ` · ${p.clientes.nombre}` : "") +
            ` · cobró ${nombreUsuario(p.usuario)}`,
          monto: Number(p.monto),
          signo: p.metodo === "cuenta_corriente" ? "" : "+",
        })),
        ...(movs.data ?? []).map((m) => ({
          id: `m-${m.id}`,
          idMovimiento: m.id,
          fecha: m.created_at,
          texto: m.concepto,
          detalle: `${m.tipo === "ingreso" ? "Ingreso de efectivo" : "Retiro de efectivo"} · ${nombreUsuario(m.usuario)}`,
          monto: Number(m.monto),
          signo: m.tipo === "ingreso" ? "+" : "−",
        })),
        ...(gastos.data ?? []).map((g) => ({
          id: `g-${g.id}`,
          fecha: g.created_at,
          texto: g.descripcion,
          detalle: `Gasto · ${g.categoria}`,
          monto: Number(g.monto),
          signo: "−",
        })),
      ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      setDatos({ clave, resumen: resumen.data, movimientos, huerfanos: huerfanos.data ?? [], pendientes: pendientes.count ?? 0, error });
    });
    return () => {
      activo = false;
    };
  }, [caja.id, clave]);

  const r = datos.resumen;
  const contado = Object.values(conteo).some((v) => Number(v) > 0) ? totalConteo(conteo) : contadoDirecto === "" ? null : Number(contadoDirecto);
  const diferencia = r && contado != null ? contado - Number(r.efectivo_esperado) : null;
  const totalHuerfanos = datos.huerfanos.reduce((acc, p) => acc + Number(p.monto), 0);

  const refrescar = () => setVuelta((n) => n + 1);

  async function agregarMovimiento(e) {
    e.preventDefault();
    if (!movimiento.concepto.trim()) return toast.error("Escribí el concepto (por ejemplo: retiro del dueño, cambio).");
    if (!(Number(movimiento.monto) > 0)) return toast.error("El monto tiene que ser mayor a 0.");
    setOcupado(true);
    const { error } = await supabase.from("caja_movimientos").insert({
      caja_id: caja.id,
      tipo: movimiento.tipo,
      concepto: movimiento.concepto.trim(),
      monto: Number(movimiento.monto),
    });
    setOcupado(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo registrar el movimiento."));
    toast.success(movimiento.tipo === "ingreso" ? "Ingreso registrado" : "Retiro registrado");
    setMovimiento({ tipo: movimiento.tipo, concepto: "", monto: "" });
    refrescar();
  }

  async function borrarMovimiento(id) {
    const { error } = await supabase.from("caja_movimientos").delete().eq("id", id);
    if (error) return toast.error(mensajeDeError(error, "No se pudo borrar el movimiento."));
    toast.success("Movimiento borrado");
    refrescar();
  }

  async function asignarHuerfanos() {
    const { data, error } = await supabase.rpc("asignar_cobros_sin_caja");
    if (error) return toast.error(mensajeDeError(error, "No se pudieron sumar los cobros."));
    toast.success(`Sumaste ${data} cobros a esta caja`);
    refrescar();
  }

  async function guardarBorrador() {
    setOcupado(true);
    const { error } = await supabase
      .from("cajas")
      .update({ conteo, efectivo_contado: contado, nota: notaCierre.trim() || caja.nota })
      .eq("id", caja.id);
    setOcupado(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo guardar el conteo."));
    toast.success("Conteo guardado. La caja sigue abierta.");
    recargarCaja();
  }

  async function cerrar() {
    setOcupado(true);
    const { data, error } = await supabase.rpc("cerrar_caja", {
      caja_id: caja.id,
      efectivo_contado: contado,
      conteo,
      nota: notaCierre.trim() || null,
    });
    setOcupado(false);
    setConfirmarCierre(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo cerrar el arqueo."));
    toast.success(`Arqueo N° ${data.numero} cerrado y guardado`);
    imprimirArqueo(data);
    await recargarCaja();
    onCambio();
  }

  if (datos.clave === null) return <Cargando texto="Cargando la caja…" />;
  if (datos.error) return <p className="tarjeta p-6 text-center text-sm text-brasa">{mensajeDeError(datos.error, "No se pudo cargar la caja.")}</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-emerald-500 bg-emerald-50 px-4 py-3">
        <div>
          <p className="text-lg font-bold text-emerald-900">Caja abierta · arqueo N° {caja.numero}</p>
          <p className="text-xs text-emerald-900/80">
            Abierta el {formatearFechaHora(caja.abierta_at)}
            {caja.abierta_por && ` por ${caja.abierta_por}`}
            {caja.turno && ` · ${TURNOS[caja.turno]?.corto}`}
          </p>
        </div>
        <button type="button" className="boton-secundario" onClick={() => imprimirArqueo(caja, r)}>
          <IconoImpresora className="size-4" /> Imprimir parcial
        </button>
      </div>

      {datos.huerfanos.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="flex items-center gap-2">
            <IconoAlerta className="size-4 shrink-0" />
            Hay {datos.huerfanos.length} cobros sin arqueo (de un arqueo borrado) por {formatearPesos(totalHuerfanos)}.
          </p>
          <button type="button" className="boton-secundario py-1.5 text-xs" onClick={asignarHuerfanos}>
            Sumarlos a esta caja
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="tarjeta border-2 border-tinta p-4">
          <p className="text-xs text-tinta-suave">Efectivo que tiene que haber</p>
          <p className="cifras mt-1 text-2xl font-bold">{formatearPesos(r.efectivo_esperado)}</p>
        </div>
        <div className="tarjeta p-4">
          <p className="text-xs text-tinta-suave">Total vendido</p>
          <p className="cifras mt-1 text-xl font-bold">{formatearPesos(r.total_vendido)}</p>
          <p className="text-xs text-tinta-suave">{r.cantidad_ventas} ventas</p>
        </div>
        <div className="tarjeta p-4">
          <p className="text-xs text-tinta-suave">Transferencias recibidas</p>
          <p className="cifras mt-1 text-xl font-bold">{formatearPesos(r.total_transferencias)}</p>
        </div>
        <div className="tarjeta p-4">
          <p className="text-xs text-tinta-suave">Fiado (cuenta corriente)</p>
          <p className="cifras mt-1 text-xl font-bold">{formatearPesos(r.ventas_cuenta_corriente)}</p>
        </div>
      </div>

      <DesgloseArqueo r={r} />

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <section className="tarjeta space-y-3 p-4">
          <h3 className="font-semibold">Movimientos de este arqueo</h3>
          <form onSubmit={agregarMovimiento} className="grid gap-2 sm:grid-cols-[8rem_1fr_8rem_auto]">
            <select className="campo" value={movimiento.tipo} onChange={(e) => setMovimiento((m) => ({ ...m, tipo: e.target.value }))} aria-label="Tipo de movimiento">
              <option value="retiro">Retiro</option>
              <option value="ingreso">Ingreso</option>
            </select>
            <input
              className="campo"
              maxLength={120}
              placeholder={movimiento.tipo === "retiro" ? "Ej.: retiro del dueño" : "Ej.: cambio agregado"}
              value={movimiento.concepto}
              onChange={(e) => setMovimiento((m) => ({ ...m, concepto: e.target.value }))}
              aria-label="Concepto"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className="campo cifras"
              placeholder="Monto"
              value={movimiento.monto}
              onChange={(e) => setMovimiento((m) => ({ ...m, monto: e.target.value }))}
              aria-label="Monto"
            />
            <button type="submit" className="boton-secundario" disabled={ocupado}>
              <IconoMas className="size-4" /> Agregar
            </button>
          </form>
          <p className="text-xs text-tinta-suave">
            Los gastos pagados con la plata de la caja los carga el dueño en Gastos y costos (quedan acá solos). Para sacar plata por otro
            motivo, usá Retiro.
          </p>
          {datos.movimientos.length === 0 ? (
            <p className="rounded-xl bg-fondo p-4 text-center text-sm text-tinta-suave">Todavía no hay movimientos.</p>
          ) : (
            <ul className="max-h-[28rem] divide-y divide-borde overflow-y-auto rounded-xl bg-fondo px-3">
              {datos.movimientos.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{m.texto}</span>
                    <span className="text-xs text-tinta-suave">
                      {formatearFechaHora(m.fecha)} · {m.detalle}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className={`cifras font-semibold ${m.signo === "−" ? "text-rojo" : m.signo === "+" ? "text-emerald-700" : "text-tinta-suave"}`}>
                      {m.signo} {formatearPesos(m.monto)}
                    </span>
                    {m.idMovimiento && esDueno && (
                      <button
                        type="button"
                        className="rounded p-1 text-tinta-suave hover:bg-borde hover:text-rojo"
                        onClick={() => borrarMovimiento(m.idMovimiento)}
                        aria-label={`Borrar ${m.texto}`}
                      >
                        <IconoBasura className="size-4" />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="tarjeta space-y-3 p-4">
          <h3 className="font-semibold">Cerrar arqueo</h3>
          <p className="text-xs text-tinta-suave">Contá los billetes de la caja. Podés guardar el conteo y seguir; al cerrar, el arqueo queda guardado y ya no se puede editar.</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {DENOMINACIONES.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm">
                <span className="cifras w-16 shrink-0 text-right text-tinta-suave">{formatearPesos(d).replace(",00", "")}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  className="campo cifras px-2 py-1.5"
                  value={conteo[d] ?? ""}
                  onChange={(e) => setConteo((c) => ({ ...c, [d]: e.target.value }))}
                  aria-label={`Cantidad de billetes de ${d}`}
                />
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <span className="w-16 shrink-0 text-right text-tinta-suave">Monedas</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="campo cifras px-2 py-1.5"
                value={conteo.monedas ?? ""}
                onChange={(e) => setConteo((c) => ({ ...c, monedas: e.target.value }))}
                aria-label="Total en monedas"
              />
            </label>
          </div>
          {!Object.values(conteo).some((v) => Number(v) > 0) && (
            <label className="block">
              <span className="etiqueta">…o escribí el total contado</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" className="campo cifras" value={contadoDirecto} onChange={(e) => setContadoDirecto(e.target.value)} />
            </label>
          )}
          <div className="rounded-xl bg-fondo p-3">
            <Fila texto="Efectivo que tiene que haber" valor={r.efectivo_esperado} />
            <Fila texto="Efectivo contado" valor={contado ?? 0} />
            {diferencia != null && (
              <div
                className={`mt-2 flex items-center justify-between rounded-lg px-3 py-2 text-sm font-bold ${
                  Math.abs(diferencia) < 0.01 ? "bg-emerald-100 text-emerald-900" : diferencia < 0 ? "bg-rojo/10 text-rojo" : "bg-sky-100 text-sky-900"
                }`}
              >
                <span>{Math.abs(diferencia) < 0.01 ? "La caja cierra justa" : diferencia < 0 ? "Faltante" : "Sobrante"}</span>
                <span className="cifras">{formatearPesos(Math.abs(diferencia))}</span>
              </div>
            )}
          </div>
          <label className="block">
            <span className="etiqueta">Nota del cierre (opcional)</span>
            <input className="campo" maxLength={500} value={notaCierre} onChange={(e) => setNotaCierre(e.target.value)} placeholder="Ej.: faltante por vuelto mal dado" />
          </label>
          {datos.pendientes > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950">
              <IconoAlerta className="mt-0.5 size-4 shrink-0" />
              Hay {datos.pendientes} pedidos sin cobrar. Si los cobrás después del cierre, van a quedar en el próximo arqueo.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="boton-secundario" onClick={guardarBorrador} disabled={ocupado}>
              Guardar conteo
            </button>
            <button
              type="button"
              className="boton bg-tinta text-fondo hover:bg-tinta/90"
              onClick={() => (contado == null ? toast.error("Contá el efectivo antes de cerrar.") : setConfirmarCierre(true))}
              disabled={ocupado}
            >
              <IconoCandado className="size-4" /> Cerrar arqueo definitivo
            </button>
          </div>
        </section>
      </div>

      <Confirmar
        abierto={confirmarCierre}
        titulo={`Cerrar el arqueo N° ${caja.numero}`}
        mensaje={`Efectivo contado: ${formatearPesos(contado ?? 0)}${
          diferencia != null && Math.abs(diferencia) >= 0.01 ? ` (${diferencia < 0 ? "faltan" : "sobran"} ${formatearPesos(Math.abs(diferencia))})` : ""
        }. Una vez cerrado, el arqueo queda guardado y no se puede editar. Si te equivocaste, lo vas a poder borrar desde el historial.`}
        textoConfirmar="Cerrar y guardar arqueo"
        peligro={false}
        procesando={ocupado}
        onConfirmar={cerrar}
        onCancelar={() => setConfirmarCierre(false)}
      />
    </div>
  );
}

function HistorialArqueos({ vuelta, onCambio }) {
  const { esDueno } = useRol();
  const [rango, setRango] = useState("mes");
  const periodo = useMemo(() => calcularRango(rango), [rango]);
  const [resultado, setResultado] = useState({ clave: null, cajas: [], error: null });
  const [verId, setVerId] = useState(null);
  const [aBorrar, setABorrar] = useState(null);
  const [borrando, setBorrando] = useState(false);
  const clave = `${rango}-${vuelta}`;

  useEffect(() => {
    let activo = true;
    supabase
      .from("cajas")
      .select("*")
      .gte("abierta_at", periodo.desde.toISOString())
      .lt("abierta_at", periodo.hasta.toISOString())
      .order("abierta_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => activo && setResultado({ clave, cajas: data ?? [], error }));
    return () => {
      activo = false;
    };
  }, [periodo, clave]);

  const cerradas = resultado.cajas.filter((c) => c.estado === "cerrada");
  const ver = resultado.cajas.find((c) => c.id === verId) ?? null;

  async function borrar() {
    setBorrando(true);
    const { error } = await supabase.from("cajas").delete().eq("id", aBorrar.id);
    setBorrando(false);
    setABorrar(null);
    if (error) return toast.error(mensajeDeError(error, "No se pudo borrar el arqueo."));
    toast.success(`Borraste el arqueo N° ${aBorrar.numero}`);
    setVerId(null);
    onCambio();
  }

  async function exportar() {
    if (cerradas.length === 0) return toast.error("No hay arqueos cerrados en este período.");
    try {
      await descargarExcel(`arqueos_${sufijoArchivo(periodo)}`, [hojaArqueos(cerradas, textoPeriodo(periodo))]);
      toast.success("Excel de arqueos descargado");
    } catch (error) {
      console.error(error);
      toast.error("No se pudo generar el Excel.");
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Historial de arqueos</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select className="campo w-auto py-2" value={rango} onChange={(e) => setRango(e.target.value)} aria-label="Período">
            {RANGOS_MES.filter((r) => r.id !== "personalizado").map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}
              </option>
            ))}
          </select>
          <button type="button" className="boton-secundario" onClick={exportar}>
            <IconoExcel className="size-4" /> Descargar Excel
          </button>
        </div>
      </div>
      {resultado.clave !== clave ? (
        <Cargando texto="Cargando arqueos…" />
      ) : cerradas.length === 0 ? (
        <p className="tarjeta p-6 text-center text-sm text-tinta-suave">No hay arqueos cerrados en este período.</p>
      ) : (
        <div className="tarjeta overflow-x-auto">
          <table className="cifras w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs text-tinta-suave">
              <tr className="border-b border-borde">
                <th className="px-3 py-2.5 font-medium">N°</th>
                <th className="px-3 py-2.5 font-medium">Apertura</th>
                <th className="px-3 py-2.5 font-medium">Cierre</th>
                <th className="px-3 py-2.5 text-right font-medium">Vendido</th>
                <th className="px-3 py-2.5 text-right font-medium">Esperado</th>
                <th className="px-3 py-2.5 text-right font-medium">Contado</th>
                <th className="px-3 py-2.5 text-right font-medium">Diferencia</th>
                <th className="px-3 py-2.5 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cerradas.map((c) => {
                const dif = Number(c.resumen?.diferencia ?? 0);
                return (
                  <tr key={c.id} className="border-b border-borde/60 last:border-0 hover:bg-borde/30">
                    <td className="px-3 py-2.5 font-semibold">{c.numero}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{formatearFechaHora(c.abierta_at)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{formatearFechaHora(c.cerrada_at)}</td>
                    <td className="px-3 py-2.5 text-right">{formatearPesos(c.resumen?.total_vendido)}</td>
                    <td className="px-3 py-2.5 text-right">{formatearPesos(c.resumen?.efectivo_esperado)}</td>
                    <td className="px-3 py-2.5 text-right">{formatearPesos(c.efectivo_contado)}</td>
                    <td className={`px-3 py-2.5 text-right font-semibold ${Math.abs(dif) < 0.01 ? "text-emerald-700" : dif < 0 ? "text-rojo" : "text-sky-700"}`}>
                      {Math.abs(dif) < 0.01 ? "Justa" : `${dif < 0 ? "−" : "+"} ${formatearPesos(Math.abs(dif))}`}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button type="button" className="boton-secundario px-2.5 py-1.5" onClick={() => setVerId(c.id)} aria-label={`Ver arqueo ${c.numero}`} title="Ver">
                          <IconoOjo className="size-4" />
                        </button>
                        <button type="button" className="boton-secundario px-2.5 py-1.5" onClick={() => imprimirArqueo(c)} aria-label={`Imprimir arqueo ${c.numero}`} title="Imprimir">
                          <IconoImpresora className="size-4" />
                        </button>
                        {esDueno && (
                          <button type="button" className="boton-secundario px-2.5 py-1.5 hover:text-rojo" onClick={() => setABorrar(c)} aria-label={`Borrar arqueo ${c.numero}`} title="Borrar">
                            <IconoBasura className="size-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal abierto={Boolean(ver)} onCerrar={() => setVerId(null)} titulo={ver ? `Arqueo N° ${ver.numero} · cerrado` : ""} ancho="max-w-3xl">
        {ver && (
          <div className="space-y-4 text-sm">
            <p className="flex items-center gap-2 rounded-xl bg-fondo px-3 py-2 text-xs text-tinta-suave">
              <IconoCandado className="size-4" /> Arqueo cerrado: no se puede editar. Abierto el {formatearFechaHora(ver.abierta_at)}
              {ver.abierta_por && ` por ${ver.abierta_por}`} · cerrado el {formatearFechaHora(ver.cerrada_at)}
              {ver.cerrada_por && ` por ${ver.cerrada_por}`}.
            </p>
            <DesgloseArqueo r={ver.resumen ?? {}} />
            <div className="rounded-xl bg-fondo p-3">
              <Fila texto="Efectivo contado" valor={ver.efectivo_contado} fuerte />
              <Fila texto={Number(ver.resumen?.diferencia) < 0 ? "Faltante" : "Sobrante"} valor={Math.abs(Number(ver.resumen?.diferencia ?? 0))} />
            </div>
            {ver.nota && <p className="rounded-xl bg-fondo p-3">Nota: {ver.nota}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="boton-secundario" onClick={() => imprimirArqueo(ver)}>
                <IconoImpresora className="size-4" /> Imprimir
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Confirmar
        abierto={Boolean(aBorrar)}
        titulo={`Borrar el arqueo N° ${aBorrar?.numero ?? ""}`}
        mensaje="Se borra el arqueo con sus ingresos y retiros de efectivo. Las ventas, los cobros y los gastos no se borran: quedan sin arqueo y los podés sumar a la próxima caja que abras."
        textoConfirmar="Borrar arqueo"
        procesando={borrando}
        onConfirmar={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </section>
  );
}

// Caja: apertura, movimientos y cierre del arqueo, más el historial de arqueos
export default function Caja({ actualizacion = 0 }) {
  const { caja, cargando, recargar } = useCaja();
  const [vuelta, setVuelta] = useState(0);
  const cambio = () => setVuelta((n) => n + 1);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Caja y arqueos</h1>
        <p className="text-sm text-tinta-suave">Todo lo que entra y sale de la caja: ventas, pagos de cuentas, retiros, gastos y el cierre de cada turno.</p>
      </div>
      {cargando ? (
        <Cargando texto="Cargando la caja…" />
      ) : caja ? (
        <CajaAbierta key={caja.id} caja={caja} actualizacion={actualizacion} onCambio={cambio} />
      ) : (
        <AbrirCaja
          onAbierta={() => {
            recargar();
            cambio();
          }}
        />
      )}
      <HistorialArqueos vuelta={vuelta} onCambio={cambio} />
    </section>
  );
}
