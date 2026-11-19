import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase, mensajeDeError } from "../../lib/supabase";
import { formatearPesos, formatearPrecio, normalizarTexto } from "../../lib/formato";
import { imprimirComanda } from "../../lib/impresion";
import { IconoBasura, IconoBuscar, IconoRegalo, IconoVaso } from "../ui/Iconos";
import Modal from "../ui/Modal";
import ControlCantidad from "../catalogo/ControlCantidad";
import { TURNOS, entradasDeComidas, idsDeKiosco, necesitaCocina, stockDe, turnoPorHora } from "./ventasUtils";

const MAX_POR_LINEA = 50;
const clave = (l) => `${l.valor}|${l.regalo ? 1 : 0}`;

// Para qué se abre:
//   { tipo: "nueva" }          → abrir una cuenta (mesa, barra) con lo primero que piden
//   { tipo: "venta", venta }   → sumar a una cuenta abierta
//   { tipo: "turno", turno }   → sumar a la cuenta de un turno de cancha
//   { tipo: "regalo" }         → regalo suelto, sin cuenta (queda cerrado en $ 0)
// destino.regalo = true: lo que se toca entra como regalo
function Contenido({ destino, comidas, categorias, onCerrar, onListo }) {
  const soloRegalo = destino.tipo === "regalo";
  const nueva = destino.tipo === "nueva" || soloRegalo;
  const turnoCuenta = destino.tipo === "venta" && destino.venta.turno !== "cancha" ? destino.venta.turno : null;
  const [carta, setCarta] = useState(() => turnoCuenta ?? turnoPorHora());
  const [lineas, setLineas] = useState([]); // [{ valor, cantidad, regalo }]
  const [regaloPorDefecto, setRegaloPorDefecto] = useState(Boolean(destino.regalo) || soloRegalo);
  const [busqueda, setBusqueda] = useState("");
  const [nombre, setNombre] = useState("");
  const [motivo, setMotivo] = useState("");
  const [comandaElegida, setComandaElegida] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const kiosco = useMemo(() => idsDeKiosco(categorias, comidas), [categorias, comidas]);
  // Todas las entradas (de las dos cartas): una cuenta puede tener cosas de las dos
  const todas = useMemo(() => entradasDeComidas(comidas), [comidas]);
  const porValor = useMemo(() => new Map(todas.map((e) => [e.valor, e])), [todas]);
  const deLaCarta = useMemo(() => todas.filter((e) => (e.comida.turno ?? "noche") === carta), [todas, carta]);
  // Botones rápidos: bebidas y golosinas disponibles de la carta elegida
  const rapidos = useMemo(() => deLaCarta.filter((e) => kiosco.has(e.comida.id) && e.comida.activo).slice(0, 15), [deLaCarta, kiosco]);
  const encontradas = useMemo(() => {
    const texto = normalizarTexto(busqueda);
    if (!texto) return [];
    return deLaCarta.filter((e) => normalizarTexto(e.nombre).includes(texto)).slice(0, 8);
  }, [deLaCarta, busqueda]);

  const precioDe = (l) => porValor.get(l.valor)?.precio ?? 0;
  const aCobrar = lineas.filter((l) => !l.regalo).reduce((acc, l) => acc + precioDe(l) * l.cantidad, 0);
  const regalado = lineas.filter((l) => l.regalo).reduce((acc, l) => acc + precioDe(l) * l.cantidad, 0);
  const hayRegalos = lineas.some((l) => l.regalo);
  const paraCocina = necesitaCocina(
    lineas.map((l) => ({ comida_id: porValor.get(l.valor)?.comida.id })),
    kiosco
  );
  const conComanda = comandaElegida ?? (lineas.length > 0 && paraCocina);

  // Stock que no alcanza (la venta se registra igual y queda en negativo)
  const pedidas = new Map();
  for (const l of lineas) {
    const c = porValor.get(l.valor)?.comida;
    if (c) pedidas.set(c.id, { comida: c, cantidad: (pedidas.get(c.id)?.cantidad ?? 0) + l.cantidad });
  }
  const sinStock = [...pedidas.values()].filter(({ comida, cantidad }) => stockDe(comida, kiosco) != null && cantidad > stockDe(comida, kiosco));

  function sumar(valor, regalo = regaloPorDefecto, delta = 1) {
    setLineas((prev) => {
      const k = clave({ valor, regalo });
      const existe = prev.find((l) => clave(l) === k);
      if (!existe) return delta > 0 ? [...prev, { valor, cantidad: delta, regalo }] : prev;
      return prev
        .map((l) => (clave(l) === k ? { ...l, cantidad: Math.min(MAX_POR_LINEA, l.cantidad + delta) } : l))
        .filter((l) => l.cantidad > 0);
    });
  }

  // Pasa una línea de "para cobrar" a "regalo" (o al revés), juntándola si ya había otra igual
  function alternarRegalo(linea) {
    setLineas((prev) => {
      const otra = { ...linea, regalo: !linea.regalo };
      const resto = prev.filter((l) => clave(l) !== clave(linea));
      const igual = resto.find((l) => clave(l) === clave(otra));
      if (!igual) return prev.map((l) => (clave(l) === clave(linea) ? otra : l));
      return resto.map((l) => (l === igual ? { ...l, cantidad: Math.min(MAX_POR_LINEA, l.cantidad + linea.cantidad) } : l));
    });
  }

  async function guardar() {
    if (lineas.length === 0) return toast.error("Agregá al menos un producto.");
    if (destino.tipo === "nueva" && !nombre.trim()) return toast.error("Poné la mesa o el nombre de la cuenta (ej.: Mesa 4, Barra · Juan).");
    const aclaracion = motivo.trim() || undefined;
    const items = lineas.map((l) => {
      const e = porValor.get(l.valor);
      return { comida_id: e.comida.id, cantidad: l.cantidad, variante: e.variante, regalo: l.regalo, aclaracion: l.regalo ? aclaracion : undefined };
    });

    setGuardando(true);
    let respuesta;
    if (destino.tipo === "venta") respuesta = await supabase.rpc("sumar_a_cuenta", { venta_id: destino.venta.id, items });
    else if (destino.tipo === "turno") respuesta = await supabase.rpc("sumar_a_turno_cancha", { turno_id: destino.turno.id, items });
    else
      respuesta = await supabase.rpc("registrar_venta_local", {
        items,
        turno: carta,
        cliente_nombre: (soloRegalo ? nombre.trim() || "Regalo de la casa" : nombre.trim()) || null,
        nota: null,
        pagos: soloRegalo ? [] : null, // regalo suelto: se cierra en $ 0; cuenta nueva: queda abierta
      });
    setGuardando(false);
    const { data, error } = respuesta;
    if (error) return toast.error(mensajeDeError(error, "No se pudo anotar."));

    // Comanda solo de lo que se sumó ahora
    if (conComanda) {
      const nombreCuenta =
        destino.tipo === "venta"
          ? destino.venta.cliente_nombre
          : destino.tipo === "turno"
            ? `Cancha · ${destino.turno.cliente_nombre}`
            : nombre.trim() || "Regalo de la casa";
      imprimirComanda({
        numero: data.numero,
        turno: destino.tipo === "turno" ? "cancha" : (turnoCuenta ?? carta),
        origen: "manual",
        created_at: new Date().toISOString(),
        cliente_nombre: nombreCuenta,
        nota: destino.tipo === "venta" || destino.tipo === "turno" ? "Se suma a la cuenta" : null,
        venta_items: lineas.map((l) => ({
          id: clave(l),
          cantidad: l.cantidad,
          nombre: porValor.get(l.valor).nombre,
          detalle: l.regalo ? ["Regalo", aclaracion].filter(Boolean).join(" · ") : null,
        })),
      });
    }

    const partes = [aCobrar > 0 && formatearPesos(aCobrar), hayRegalos && `regalo de ${formatearPesos(regalado)}`].filter(Boolean).join(" + ");
    toast.success(
      soloRegalo
        ? `Regalo anotado (${formatearPesos(regalado)} a precio de carta)`
        : destino.tipo === "nueva"
          ? `Cuenta "${nombre.trim()}" abierta: ${formatearPesos(data.total)}`
          : `Sumaste ${partes || "a la cuenta"}. Total de la cuenta: ${formatearPesos(data.total)}`
    );
    onListo();
  }

  return (
    <div className="space-y-4">
      {nueva && (
        <label className="block">
          <span className="etiqueta">{soloRegalo ? "Para quién o por qué (opcional)" : "Mesa o nombre *"}</span>
          <input
            className="campo"
            maxLength={80}
            placeholder={soloRegalo ? "Ej.: Amigos del club" : "Ej.: Mesa 4 · Barra Juan"}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            autoFocus
          />
        </label>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-xl bg-fondo p-1" role="radiogroup" aria-label="Carta">
          {["noche", "mediodia"].map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={carta === t}
              onClick={() => setCarta(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${carta === t ? "bg-papel text-tinta shadow-sm" : "text-tinta-suave"}`}
            >
              Carta {TURNOS[t].corto.toLowerCase()}
            </button>
          ))}
        </div>
        {!soloRegalo && (
          <div className="flex gap-1 rounded-xl bg-fondo p-1" role="radiogroup" aria-label="Lo que tocás entra">
            <button
              type="button"
              role="radio"
              aria-checked={!regaloPorDefecto}
              onClick={() => setRegaloPorDefecto(false)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${!regaloPorDefecto ? "bg-papel text-tinta shadow-sm" : "text-tinta-suave"}`}
            >
              Para cobrar
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={regaloPorDefecto}
              onClick={() => setRegaloPorDefecto(true)}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                regaloPorDefecto ? "bg-regalo text-white shadow-sm" : "text-tinta-suave"
              }`}
            >
              <IconoRegalo className="size-3.5" /> De regalo
            </button>
          </div>
        )}
      </div>

      {rapidos.length > 0 && (
        <div>
          <p className="etiqueta flex items-center gap-1.5">
            <IconoVaso className="size-4" /> Bebidas y kiosco (tocá para sumar{regaloPorDefecto ? " de regalo" : ""})
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {rapidos.map((e) => {
              const stock = stockDe(e.comida, kiosco);
              return (
                <button
                  key={e.valor}
                  type="button"
                  onClick={() => sumar(e.valor)}
                  className={`rounded-xl border bg-papel px-3 py-2.5 text-left text-sm ${
                    regaloPorDefecto ? "border-regalo/30 hover:border-regalo hover:bg-regalo-suave" : "border-borde hover:border-cuenta hover:bg-cuenta-suave"
                  }`}
                >
                  <span className="block font-semibold leading-tight">{e.nombre}</span>
                  <span className="cifras text-xs text-tinta-suave">
                    {formatearPrecio(e.precio)}
                    {stock != null && <span className={stock > 0 ? "" : "font-semibold text-brasa"}> · quedan {stock}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="relative">
        <label className="relative block">
          <span className="sr-only">Buscar producto</span>
          <IconoBuscar className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-suave" />
          <input
            type="search"
            className="campo pl-9"
            placeholder={`Buscar en la carta ${TURNOS[carta].corto.toLowerCase()}…`}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </label>
        {encontradas.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-borde bg-papel shadow-lg">
            {encontradas.map((e) => (
              <li key={e.valor}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-borde"
                  onClick={() => {
                    sumar(e.valor);
                    setBusqueda("");
                  }}
                >
                  <span>
                    {e.nombre}
                    {!e.comida.activo && <span className="ml-1 text-xs text-tinta-suave">(no disponible)</span>}
                  </span>
                  <span className="cifras shrink-0 text-tinta-suave">{formatearPrecio(e.precio)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {busqueda && encontradas.length === 0 && <p className="mt-1 text-xs text-tinta-suave">No hay productos con ese nombre en esta carta.</p>}
      </div>

      {lineas.length === 0 ? (
        <p className="rounded-xl bg-fondo p-4 text-center text-sm text-tinta-suave">Todavía no agregaste nada.</p>
      ) : (
        <ul className="divide-y divide-borde rounded-xl bg-fondo px-3">
          {lineas.map((l) => {
            const e = porValor.get(l.valor);
            if (!e) return null;
            return (
              <li key={clave(l)} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  {e.nombre}
                  {l.regalo && (
                    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-regalo-suave px-1.5 py-0.5 text-[11px] font-semibold text-regalo">
                      <IconoRegalo className="size-3" /> Regalo
                    </span>
                  )}
                  <span className="cifras block text-xs text-tinta-suave">
                    {l.regalo ? `vale ${formatearPrecio(e.precio)} c/u · no se cobra` : `${formatearPrecio(e.precio)} c/u`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="w-28">
                    <ControlCantidad cantidad={l.cantidad} onSumar={() => sumar(l.valor, l.regalo)} onRestar={() => sumar(l.valor, l.regalo, -1)} nombre={e.nombre} chico />
                  </span>
                  <span className="cifras w-20 text-right font-semibold">{l.regalo ? "$ 0" : formatearPrecio(e.precio * l.cantidad)}</span>
                  {!soloRegalo && (
                    <button
                      type="button"
                      className={`rounded p-1.5 hover:bg-borde ${l.regalo ? "text-regalo" : "text-tinta-suave hover:text-regalo"}`}
                      onClick={() => alternarRegalo(l)}
                      aria-label={l.regalo ? `Cobrar ${e.nombre}` : `Pasar ${e.nombre} a regalo`}
                      title={l.regalo ? "Pasar a cobrar" : "Pasar a regalo"}
                    >
                      <IconoRegalo className="size-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded p-1.5 text-tinta-suave hover:bg-borde hover:text-rojo"
                    onClick={() => setLineas((prev) => prev.filter((x) => clave(x) !== clave(l)))}
                    aria-label={`Quitar ${e.nombre}`}
                  >
                    <IconoBasura className="size-4" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {hayRegalos && (
        <label className="block">
          <span className="etiqueta">Motivo del regalo (opcional)</span>
          <input
            className="campo"
            maxLength={80}
            placeholder="Ej.: con el alquiler de la cancha · de la casa"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </label>
      )}

      {sinStock.length > 0 && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          Según el sistema no alcanza el stock de {sinStock.map(({ comida }) => `${comida.nombre} (quedan ${stockDe(comida, kiosco)})`).join(", ")}. Se anota
          igual y el stock queda en negativo: avisale al dueño para que lo corrija en Stock.
        </p>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-palmera" checked={conComanda} onChange={(e) => setComandaElegida(e.target.checked)} />
        Imprimir comanda de lo que se suma
        {lineas.length > 0 && !paraCocina && <span className="text-xs text-tinta-suave">(solo bebidas o golosinas: es opcional)</span>}
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borde pt-4">
        <div className="cifras">
          {!soloRegalo && <p className="text-xl font-bold">{destino.tipo === "nueva" ? "Total" : "Suma"}: {formatearPesos(aCobrar)}</p>}
          {hayRegalos && <p className="text-xs font-semibold text-regalo">Regalo: {formatearPesos(regalado)} a precio de carta (no se cobra)</p>}
        </div>
        <div className="flex gap-2">
          <button type="button" className="boton-secundario" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button
            type="button"
            className={soloRegalo ? "boton bg-regalo text-white hover:brightness-110" : "boton-primario"}
            disabled={guardando || lineas.length === 0}
            onClick={guardar}
          >
            {guardando ? "Anotando…" : soloRegalo ? "Anotar regalo" : destino.tipo === "nueva" ? "Abrir cuenta" : "Sumar a la cuenta"}
          </button>
        </div>
      </div>
      <p className="text-xs text-tinta-suave">
        {soloRegalo
          ? "El regalo descuenta el stock y queda anotado con lo que vale en la carta (Finanzas → Regalos). No pasa por la caja."
          : "Los precios los toma la base de datos con los valores actuales. Los regalos descuentan stock y quedan anotados con lo que valen."}
      </p>
    </div>
  );
}

function titulo(destino) {
  if (!destino) return "";
  if (destino.tipo === "nueva") return "Nueva cuenta (paga al final)";
  if (destino.tipo === "regalo") return "Anotar un regalo";
  const de = destino.tipo === "turno" ? `cancha · ${destino.turno.cliente_nombre}` : (destino.venta.cliente_nombre ?? `#${destino.venta.numero}`);
  return destino.regalo ? `Regalo · ${de}` : `Sumar a la cuenta · ${de}`;
}

export default function SumarACuenta({ destino, comidas, categorias, onCerrar, onListo }) {
  return (
    <Modal abierto={Boolean(destino)} onCerrar={onCerrar} titulo={titulo(destino)} ancho="max-w-2xl">
      {destino && (
        <Contenido
          key={`${destino.tipo}-${destino.venta?.id ?? destino.turno?.id ?? ""}-${destino.regalo ? 1 : 0}`}
          destino={destino}
          comidas={comidas}
          categorias={categorias}
          onCerrar={onCerrar}
          onListo={onListo}
        />
      )}
    </Modal>
  );
}
