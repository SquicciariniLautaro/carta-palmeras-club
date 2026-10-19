import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { formatearFechaHora, formatearPesos, normalizarTexto } from "../../lib/formato";
import { descargarExcel } from "../../lib/excel";
import { hojaCuentas, hojaEstadoCuenta } from "../../lib/reportes";
import { useCaja, useClientes } from "../../hooks/useCaja";
import { IconoBuscar, IconoCheck, IconoEditar, IconoExcel, IconoMas, IconoOjo, IconoUsuario } from "../ui/Iconos";
import Cargando from "../ui/Cargando";
import Confirmar from "../ui/Confirmar";
import Modal from "../ui/Modal";
import { AvisoCajaCerrada } from "./FormPagos";
import { TURNOS } from "./ventasUtils";

const CLIENTE_VACIO = { nombre: "", telefono: "", documento: "", limite_credito: "", notas: "" };

function FormCliente({ cliente, onCerrar, onGuardado }) {
  const [v, setV] = useState(() =>
    cliente
      ? {
          nombre: cliente.nombre,
          telefono: cliente.telefono ?? "",
          documento: cliente.documento ?? "",
          limite_credito: cliente.limite_credito != null ? String(Number(cliente.limite_credito)) : "",
          notas: cliente.notas ?? "",
        }
      : CLIENTE_VACIO
  );
  const [guardando, setGuardando] = useState(false);
  const cambiar = (campo) => (e) => setV((x) => ({ ...x, [campo]: e.target.value }));

  async function guardar(e) {
    e.preventDefault();
    if (!v.nombre.trim()) return toast.error("Escribí el nombre del cliente.");
    if (v.limite_credito !== "" && !(Number(v.limite_credito) >= 0)) return toast.error("El límite de crédito no es válido.");
    const fila = {
      nombre: v.nombre.trim(),
      telefono: v.telefono.trim() || null,
      documento: v.documento.trim() || null,
      limite_credito: v.limite_credito === "" ? null : Number(v.limite_credito),
      notas: v.notas.trim() || null,
    };
    setGuardando(true);
    const { error } = cliente
      ? await supabase.from("clientes").update(fila).eq("id", cliente.id)
      : await supabase.from("clientes").insert(fila);
    setGuardando(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo guardar el cliente."));
    toast.success(cliente ? "Cliente actualizado" : `Cuenta de ${fila.nombre} creada`);
    onGuardado();
  }

  return (
    <form onSubmit={guardar} className="space-y-3" noValidate>
      <label className="block">
        <span className="etiqueta">Nombre y apellido *</span>
        <input className="campo" maxLength={80} value={v.nombre} onChange={cambiar("nombre")} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="etiqueta">Teléfono</span>
          <input className="campo" maxLength={30} inputMode="tel" value={v.telefono} onChange={cambiar("telefono")} />
        </label>
        <label className="block">
          <span className="etiqueta">DNI / CUIT</span>
          <input className="campo" maxLength={20} value={v.documento} onChange={cambiar("documento")} />
        </label>
      </div>
      <label className="block">
        <span className="etiqueta">Límite de crédito (opcional)</span>
        <input type="number" min="0" step="0.01" inputMode="decimal" className="campo cifras" placeholder="Sin límite" value={v.limite_credito} onChange={cambiar("limite_credito")} />
        <span className="mt-1 block text-xs text-tinta-suave">Si lo ponés, no se le puede fiar por encima de ese monto.</span>
      </label>
      <label className="block">
        <span className="etiqueta">Notas</span>
        <input className="campo" maxLength={300} value={v.notas} onChange={cambiar("notas")} placeholder="Ej.: paga los viernes" />
      </label>
      <div className="flex justify-end gap-2 border-t border-borde pt-3">
        <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </button>
        <button type="submit" className="boton-primario" disabled={guardando}>
          {guardando ? "Guardando…" : cliente ? "Guardar cambios" : "Crear cuenta"}
        </button>
      </div>
    </form>
  );
}

// Movimientos con saldo acumulado (del más viejo al más nuevo)
function armarMovimientos(pagos) {
  let saldo = 0;
  return [...pagos]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((p) => {
      const debe = p.metodo === "cuenta_corriente" ? Number(p.monto) : 0;
      const haber = p.concepto === "cobro_cuenta" ? Number(p.monto) : 0;
      saldo += debe - haber;
      const venta = p.ventas;
      return {
        id: p.id,
        fecha: p.created_at,
        concepto: haber
          ? `Pago (${p.metodo === "efectivo" ? "efectivo" : "transferencia"})${p.nota ? ` · ${p.nota}` : ""}`
          : `Consumo · cuenta #${venta?.numero ?? "—"}${venta?.turno ? ` · ${TURNOS[venta.turno]?.corto}` : ""}`,
        debe,
        haber,
        saldo,
        venta,
      };
    });
}

function DetalleCuenta({ cliente, onCerrar, onCambio, onEditar }) {
  const { caja } = useCaja();
  const [resultado, setResultado] = useState({ vuelta: null, pagos: [], error: null });
  const [vuelta, setVuelta] = useState(0);
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("efectivo");
  const [nota, setNota] = useState("");
  const [abierta, setAbierta] = useState(null);
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let activo = true;
    supabase
      .from("pagos")
      .select("id, created_at, metodo, monto, concepto, nota, ventas(numero, created_at, total, turno, venta_items(id, cantidad, nombre, detalle, subtotal))")
      .eq("cliente_id", cliente.id)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => activo && setResultado({ vuelta, pagos: data ?? [], error }));
    return () => {
      activo = false;
    };
  }, [cliente.id, vuelta]);

  const movimientos = useMemo(() => armarMovimientos(resultado.pagos), [resultado.pagos]);
  const saldo = movimientos.length ? movimientos[movimientos.length - 1].saldo : 0;

  async function cobrar(importe) {
    if (!(importe > 0)) return toast.error("Escribí cuánto paga.");
    setOcupado(true);
    const { data, error } = await supabase.rpc("cobrar_cuenta_corriente", {
      cliente_id: cliente.id,
      monto: importe,
      metodo,
      nota: nota.trim() || null,
    });
    setOcupado(false);
    setConfirmarCierre(false);
    if (error) return toast.error(mensajeDeError(error, "No se pudo registrar el pago."));
    toast.success(Number(data.saldo) === 0 ? `Cuenta de ${cliente.nombre} saldada` : `Pago registrado. Saldo: ${formatearPesos(data.saldo)}`);
    setMonto("");
    setNota("");
    setVuelta((n) => n + 1);
    onCambio();
  }

  async function exportar() {
    try {
      await descargarExcel(`estado-de-cuenta_${normalizarTexto(cliente.nombre).replace(/\s+/g, "-")}`, [hojaEstadoCuenta(cliente, movimientos)]);
      toast.success("Estado de cuenta descargado");
    } catch (error) {
      console.error(error);
      toast.error("No se pudo generar el Excel.");
    }
  }

  async function cambiarActivo() {
    const { error } = await supabase.from("clientes").update({ activo: !cliente.activo }).eq("id", cliente.id);
    if (error) return toast.error(mensajeDeError(error, "No se pudo actualizar el cliente."));
    toast.success(cliente.activo ? "Cliente dado de baja: ya no se le puede fiar" : "Cliente reactivado");
    onCambio();
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{cliente.nombre}</p>
          <p className="text-xs text-tinta-suave">
            {[cliente.documento && `DNI/CUIT ${cliente.documento}`, cliente.telefono && `Tel. ${cliente.telefono}`, cliente.limite_credito != null && `Límite ${formatearPesos(cliente.limite_credito)}`]
              .filter(Boolean)
              .join(" · ") || "Sin datos de contacto"}
          </p>
          {cliente.notas && <p className="mt-1 text-xs">{cliente.notas}</p>}
        </div>
        <div className="flex gap-2">
          <button type="button" className="boton-secundario px-3 py-2 text-xs" onClick={onEditar}>
            <IconoEditar className="size-4" /> Editar
          </button>
          <button type="button" className="boton-secundario px-3 py-2 text-xs" onClick={exportar}>
            <IconoExcel className="size-4" /> Excel
          </button>
        </div>
      </div>

      <div className={`rounded-2xl border-2 p-4 text-center ${saldo > 0 ? "border-brasa bg-brasa/5" : "border-emerald-500 bg-emerald-50"}`}>
        <p className="text-xs font-semibold uppercase tracking-wider text-tinta-suave">{saldo > 0 ? "Saldo adeudado" : "Cuenta al día"}</p>
        <p className={`cifras mt-1 text-3xl font-bold ${saldo > 0 ? "text-brasa" : "text-emerald-800"}`}>{formatearPesos(saldo)}</p>
      </div>

      {saldo > 0 && (
        <div className="space-y-3 rounded-xl border border-borde p-3">
          <p className="font-semibold">Registrar pago</p>
          {!caja ? (
            <AvisoCajaCerrada texto="La caja está cerrada. Abrila para registrar el pago del cliente." />
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="campo cifras"
                  placeholder={`Hasta ${formatearPesos(saldo)}`}
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  aria-label="Monto que paga"
                />
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-fondo p-1">
                  {[
                    ["efectivo", "Efectivo"],
                    ["transferencia", "Transferencia"],
                  ].map(([id, texto]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={metodo === id}
                      onClick={() => setMetodo(id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${metodo === id ? "bg-papel shadow-sm" : "text-tinta-suave"}`}
                    >
                      {texto}
                    </button>
                  ))}
                </div>
              </div>
              <input className="campo" maxLength={200} placeholder="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" className="boton-secundario" onClick={() => cobrar(Number(monto))} disabled={ocupado}>
                  Registrar pago parcial
                </button>
                <button type="button" className="boton bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setConfirmarCierre(true)} disabled={ocupado}>
                  <IconoCheck className="size-4" /> Cerrar cuenta ({formatearPesos(saldo)})
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div>
        <p className="mb-2 font-semibold">Estado de cuenta</p>
        {resultado.vuelta !== vuelta ? (
          <Cargando texto="Cargando movimientos…" />
        ) : movimientos.length === 0 ? (
          <p className="rounded-xl bg-fondo p-4 text-center text-tinta-suave">Todavía no tiene movimientos.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-borde">
            <table className="cifras w-full min-w-[560px] text-left">
              <thead className="bg-fondo text-xs text-tinta-suave">
                <tr>
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="px-3 py-2 font-medium">Concepto</th>
                  <th className="px-3 py-2 text-right font-medium">Debe</th>
                  <th className="px-3 py-2 text-right font-medium">Haber</th>
                  <th className="px-3 py-2 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {[...movimientos].reverse().map((m) => (
                  <FilaMovimiento key={m.id} m={m} abierta={abierta === m.id} onAlternar={() => setAbierta(abierta === m.id ? null : m.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-wrap justify-between gap-2 border-t border-borde pt-3">
        <button type="button" className="text-xs text-tinta-suave underline hover:text-tinta" onClick={cambiarActivo}>
          {cliente.activo ? "Dar de baja (no fiarle más)" : "Reactivar cliente"}
        </button>
        <button type="button" className="boton-secundario" onClick={onCerrar}>
          Listo
        </button>
      </div>

      <Confirmar
        abierto={confirmarCierre}
        titulo={`Cerrar la cuenta de ${cliente.nombre}`}
        mensaje={`Se registra un pago de ${formatearPesos(saldo)} en ${metodo === "efectivo" ? "efectivo" : "transferencia"} y la cuenta queda en cero.`}
        textoConfirmar="Cobrar y cerrar cuenta"
        peligro={false}
        procesando={ocupado}
        onConfirmar={() => cobrar(saldo)}
        onCancelar={() => setConfirmarCierre(false)}
      />
    </div>
  );
}

// Una fila del estado de cuenta. Los consumos se despliegan para ver su comanda.
function FilaMovimiento({ m, abierta, onAlternar }) {
  return (
    <>
      <tr className="border-t border-borde/60 align-top">
        <td className="px-3 py-2 whitespace-nowrap text-xs">{formatearFechaHora(m.fecha)}</td>
        <td className="px-3 py-2">
          {m.venta ? (
            <button type="button" className="text-left underline-offset-2 hover:underline" onClick={onAlternar} aria-expanded={abierta}>
              {m.concepto} <span className="text-xs text-tinta-suave">{abierta ? "(ocultar comanda)" : "(ver comanda)"}</span>
            </button>
          ) : (
            m.concepto
          )}
        </td>
        <td className="px-3 py-2 text-right">{m.debe ? formatearPesos(m.debe) : ""}</td>
        <td className="px-3 py-2 text-right text-emerald-700">{m.haber ? formatearPesos(m.haber) : ""}</td>
        <td className="px-3 py-2 text-right font-semibold">{formatearPesos(m.saldo)}</td>
      </tr>
      {abierta && m.venta && (
        <tr>
          <td />
          <td colSpan={4} className="px-3 pb-3">
            <ul className="space-y-0.5 rounded-lg bg-fondo p-2.5 text-xs">
              {(m.venta.venta_items ?? []).map((i) => (
                <li key={i.id} className="flex justify-between gap-3">
                  <span>
                    <strong>{i.cantidad}x</strong> {i.nombre}
                    {i.detalle && <span className="text-tinta-suave"> · {i.detalle}</span>}
                  </span>
                  <span>{formatearPesos(i.subtotal)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-3 border-t border-borde pt-1 font-semibold">
                <span>Total de la cuenta #{m.venta.numero}</span>
                <span>{formatearPesos(m.venta.total)}</span>
              </li>
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

const FILTROS = [
  { id: "deuda", nombre: "Con deuda" },
  { id: "activos", nombre: "Activos" },
  { id: "todos", nombre: "Todos" },
];

// Cuentas corrientes de clientes (fiado): saldo, estado de cuenta y cobros
export default function CuentasCorrientes() {
  const { clientes, cargando, recargar } = useClientes();
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("activos");
  const [verId, setVerId] = useState(null);
  const [editando, setEditando] = useState(null); // null | "nuevo" | cliente

  const lista = useMemo(() => {
    const texto = normalizarTexto(busqueda);
    return clientes
      .filter((c) => (filtro === "deuda" ? Number(c.saldo) > 0 : filtro === "activos" ? c.activo : true))
      .filter((c) => !texto || normalizarTexto(`${c.nombre} ${c.documento ?? ""} ${c.telefono ?? ""}`).includes(texto))
      .sort((a, b) => Number(b.saldo) - Number(a.saldo) || a.nombre.localeCompare(b.nombre, "es"));
  }, [clientes, busqueda, filtro]);

  const totalDeuda = clientes.reduce((acc, c) => acc + Math.max(0, Number(c.saldo)), 0);
  const conDeuda = clientes.filter((c) => Number(c.saldo) > 0).length;
  const ver = clientes.find((c) => c.id === verId) ?? null;

  async function exportar() {
    if (clientes.length === 0) return toast.error("Todavía no hay cuentas corrientes.");
    try {
      const hoy = new Date().toLocaleDateString("es-AR");
      await descargarExcel(`cuentas-corrientes_${new Date().toISOString().slice(0, 10)}`, [hojaCuentas(clientes, `Saldos al ${hoy}`)]);
      toast.success("Excel de cuentas corrientes descargado");
    } catch (error) {
      console.error(error);
      toast.error("No se pudo generar el Excel.");
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Cuentas corrientes</h1>
          <p className="text-sm text-tinta-suave">Clientes a los que se les fía: lo que consumieron, lo que pagaron y lo que deben.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="boton-secundario" onClick={exportar}>
            <IconoExcel className="size-4" /> Descargar Excel
          </button>
          <button type="button" className="boton-primario" onClick={() => setEditando("nuevo")}>
            <IconoMas className="size-4" /> Nueva cuenta
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="tarjeta border-2 border-brasa p-4">
          <p className="text-xs text-tinta-suave">Total a cobrar</p>
          <p className="cifras mt-1 text-2xl font-bold text-brasa">{formatearPesos(totalDeuda)}</p>
        </div>
        <div className="tarjeta p-4">
          <p className="text-xs text-tinta-suave">Clientes que deben</p>
          <p className="cifras mt-1 text-2xl font-bold">{conDeuda}</p>
        </div>
        <div className="tarjeta col-span-2 p-4 lg:col-span-1">
          <p className="text-xs text-tinta-suave">Cuentas activas</p>
          <p className="cifras mt-1 text-2xl font-bold">{clientes.filter((c) => c.activo).length}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Buscar cliente</span>
          <IconoBuscar className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-suave" />
          <input type="search" className="campo pl-9" placeholder="Buscar por nombre, DNI o teléfono…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </label>
        <div className="flex gap-1" role="group" aria-label="Filtrar">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filtro === f.id}
              onClick={() => setFiltro(f.id)}
              className={`rounded-full px-3 py-2 text-xs font-medium ${filtro === f.id ? "bg-tinta text-fondo" : "bg-papel text-tinta-suave hover:text-tinta"}`}
            >
              {f.nombre}
            </button>
          ))}
        </div>
      </div>

      {cargando ? (
        <Cargando texto="Cargando cuentas…" />
      ) : lista.length === 0 ? (
        <div className="tarjeta p-8 text-center text-tinta-suave">
          {clientes.length === 0 ? "Todavía no hay cuentas corrientes. Creá una o elegí Cuenta corriente al cobrar una venta." : "No hay clientes con ese filtro."}
        </div>
      ) : (
        <div className="tarjeta overflow-x-auto">
          <table className="cifras w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-tinta-suave">
              <tr className="border-b border-borde">
                <th className="px-3 py-2.5 font-medium">Cliente</th>
                <th className="px-3 py-2.5 font-medium">Teléfono</th>
                <th className="px-3 py-2.5 font-medium">Último movimiento</th>
                <th className="px-3 py-2.5 text-right font-medium">Saldo</th>
                <th className="px-3 py-2.5 text-right font-medium">Cuenta</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className={`border-b border-borde/60 last:border-0 hover:bg-borde/30 ${c.activo ? "" : "opacity-60"}`}>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2 font-semibold">
                      <IconoUsuario className="size-4 text-tinta-suave" /> {c.nombre}
                    </span>
                    {!c.activo && <span className="text-xs text-tinta-suave">De baja</span>}
                  </td>
                  <td className="px-3 py-2.5 text-tinta-suave">{c.telefono || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-tinta-suave">{c.ultimo_movimiento ? formatearFechaHora(c.ultimo_movimiento) : "—"}</td>
                  <td className={`px-3 py-2.5 text-right font-bold ${Number(c.saldo) > 0 ? "text-brasa" : "text-emerald-700"}`}>{formatearPesos(c.saldo)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button type="button" className="boton-secundario px-3 py-1.5 text-xs" onClick={() => setVerId(c.id)}>
                      <IconoOjo className="size-4" /> Ver cuenta
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal abierto={Boolean(ver)} onCerrar={() => setVerId(null)} titulo="Cuenta corriente" ancho="max-w-3xl">
        {ver && (
          <DetalleCuenta
            key={ver.id}
            cliente={ver}
            onCerrar={() => setVerId(null)}
            onCambio={recargar}
            onEditar={() => {
              setEditando(ver);
              setVerId(null);
            }}
          />
        )}
      </Modal>

      <Modal abierto={Boolean(editando)} onCerrar={() => setEditando(null)} titulo={editando === "nuevo" ? "Nueva cuenta corriente" : "Editar cliente"} ancho="max-w-lg">
        {editando && (
          <FormCliente
            key={editando === "nuevo" ? "nuevo" : editando.id}
            cliente={editando === "nuevo" ? null : editando}
            onCerrar={() => setEditando(null)}
            onGuardado={() => {
              setEditando(null);
              recargar();
            }}
          />
        )}
      </Modal>
    </section>
  );
}
