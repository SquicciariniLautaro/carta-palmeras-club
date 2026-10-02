import { useEffect, useRef, useState } from "react";
import { formatearPrecio, precioFinal } from "../../lib/formato";
import { IconoBasura, IconoBolsa, IconoCerrar, IconoWhatsApp } from "../ui/Iconos";
import { DIRECCION_VACIA, ENTREGA } from "../../lib/whatsapp";
import ControlCantidad from "./ControlCantidad";

// Panel lateral del pedido. Se cierra con Escape o tocando el fondo.
export default function Carrito({
  abierto,
  onCerrar,
  lineas,
  total,
  onSumar,
  onRestar,
  onEliminar,
  onVaciar,
  onEnviar,
  enviando,
}) {
  const [cliente, setCliente] = useState("");
  const [nota, setNota] = useState("");
  const [entrega, setEntrega] = useState(ENTREGA.retiro);
  const [direccion, setDireccion] = useState(DIRECCION_VACIA);
  const cambiarDireccion = (campo) => (e) => setDireccion((d) => ({ ...d, [campo]: e.target.value }));
  const panelRef = useRef(null);

  useEffect(() => {
    if (!abierto) return;
    const alPresionar = (e) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alPresionar);
    // Bloquear el scroll de fondo y llevar el foco al panel
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", alPresionar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [abierto, onCerrar]);

  async function enviar(e) {
    e.preventDefault();
    const ok = await onEnviar({
      cliente: cliente.trim(),
      nota: nota.trim(),
      entrega,
      direccion: Object.fromEntries(Object.entries(direccion).map(([k, v]) => [k, v.trim()])),
    });
    if (ok) {
      setCliente("");
      setNota("");
      setEntrega(ENTREGA.retiro);
      setDireccion(DIRECCION_VACIA);
    }
  }

  return (
    <div className={`fixed inset-0 z-40 ${abierto ? "" : "pointer-events-none"}`} aria-hidden={!abierto}>
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity ${abierto ? "opacity-100" : "opacity-0"}`}
        onClick={onCerrar}
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Mi pedido"
        inert={!abierto}
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-papel shadow-2xl transition-transform duration-300 focus:outline-none ${
          abierto ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-borde px-4 py-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <IconoBolsa className="size-5 text-palmera" /> Mi pedido
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-full p-1.5 text-tinta-suave hover:bg-borde hover:text-tinta"
            aria-label="Cerrar pedido"
          >
            <IconoCerrar />
          </button>
        </div>

        {lineas.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-tinta-suave">
            <IconoBolsa className="size-12 opacity-40" />
            <p className="font-medium text-tinta">Tu pedido está vacío</p>
            <p className="text-sm">Agregá algo rico del menú para empezar.</p>
          </div>
        ) : (
          <form onSubmit={enviar} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <ul className="space-y-3">
                {lineas.map(({ comida, cantidad }) => (
                  <li key={comida.id} className="rounded-xl border border-borde bg-fondo/50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{comida.nombre}</p>
                        <p className="text-xs text-tinta-suave">
                          {formatearPrecio(precioFinal(comida))} c/u ·{" "}
                          <span className="font-semibold text-tinta">
                            {formatearPrecio(precioFinal(comida) * cantidad)}
                          </span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onEliminar(comida)}
                        className="rounded-lg p-1.5 text-tinta-suave hover:bg-borde hover:text-brasa"
                        aria-label={`Eliminar ${comida.nombre} del pedido`}
                      >
                        <IconoBasura className="size-4" />
                      </button>
                    </div>
                    <div className="mt-2 w-32">
                      <ControlCantidad
                        cantidad={cantidad}
                        onSumar={() => onSumar(comida)}
                        onRestar={() => onRestar(comida)}
                        nombre={comida.nombre}
                        chico
                      />
                    </div>
                  </li>
                ))}
              </ul>

              <button type="button" onClick={onVaciar} className="text-xs text-tinta-suave underline hover:text-brasa">
                Vaciar pedido
              </button>

              <div className="space-y-3 border-t border-borde pt-3">
                <div>
                  <label htmlFor="cliente" className="etiqueta">
                    Tu nombre
                  </label>
                  <input
                    id="cliente"
                    className="campo"
                    value={cliente}
                    onChange={(e) => setCliente(e.target.value)}
                    maxLength={80}
                    autoComplete="name"
                    placeholder="Insertar nombre"
                  />
                </div>
                <fieldset>
                  <legend className="etiqueta">¿Cómo lo recibís?</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      [ENTREGA.retiro, "Retiro en el local"],
                      [ENTREGA.envio, "Envío a domicilio"],
                    ].map(([valor, texto]) => (
                      <label
                        key={valor}
                        className={`cursor-pointer rounded-xl border px-3 py-2.5 text-center text-sm font-medium transition ${
                          entrega === valor
                            ? "border-palmera bg-palmera text-white"
                            : "border-borde bg-papel text-tinta hover:bg-borde"
                        }`}
                      >
                        <input
                          type="radio"
                          name="entrega"
                          value={valor}
                          checked={entrega === valor}
                          onChange={() => setEntrega(valor)}
                          className="sr-only"
                        />
                        {texto}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {entrega === ENTREGA.envio && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-[1fr_6rem] gap-2">
                      <div>
                        <label htmlFor="calle" className="etiqueta">
                          Calle
                        </label>
                        <input
                          id="calle"
                          className="campo"
                          value={direccion.calle}
                          onChange={cambiarDireccion("calle")}
                          maxLength={50}
                          required
                          autoComplete="address-line1"
                          placeholder="Ej.: Belgrano"
                        />
                      </div>
                      <div>
                        <label htmlFor="numero" className="etiqueta">
                          Número
                        </label>
                        <input
                          id="numero"
                          className="campo"
                          value={direccion.numero}
                          onChange={cambiarDireccion("numero")}
                          maxLength={8}
                          required
                          inputMode="numeric"
                          placeholder="123"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="barrio" className="etiqueta">
                        Barrio
                      </label>
                      <input
                        id="barrio"
                        className="campo"
                        value={direccion.barrio}
                        onChange={cambiarDireccion("barrio")}
                        maxLength={40}
                        required
                        placeholder="Ej.: Centro"
                      />
                    </div>
                    <div>
                      <label htmlFor="indicaciones" className="etiqueta">
                        Indicaciones para el delivery (opcional)
                      </label>
                      <input
                        id="indicaciones"
                        className="campo"
                        value={direccion.indicaciones}
                        onChange={cambiarDireccion("indicaciones")}
                        maxLength={70}
                        placeholder="Ej.: casa de rejas negras, timbre roto"
                      />
                    </div>
                  </div>
                )}
                <div>
                  <label htmlFor="nota" className="etiqueta">
                    Nota para el pedido (opcional)
                  </label>
                  <textarea
                    id="nota"
                    className="campo resize-none"
                    rows={2}
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    maxLength={entrega === ENTREGA.envio ? 80 : 150}
                    placeholder="Ej.: sin cebolla, para las 21"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3 border-t border-borde p-4">
              <div className="flex items-center justify-between text-lg font-bold">
                <span>Total</span>
                <span>{formatearPrecio(total)}</span>
              </div>
              <button type="submit" className="boton-whatsapp w-full py-3 text-base" disabled={enviando}>
                <IconoWhatsApp />
                {enviando ? "Registrando pedido…" : "Enviar pedido por WhatsApp"}
              </button>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}
