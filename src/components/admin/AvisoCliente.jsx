import { useState } from "react";
import toast from "react-hot-toast";
import { PLANTILLAS, linkWhatsAppCliente, mostrarTelefono, normalizarTelefono } from "../../lib/mensajesCliente";
import { IconoWhatsApp } from "../ui/Iconos";
import Modal from "../ui/Modal";

const DEMORAS = [20, 30, 45, 60];

function Contenido({ venta, plantillaInicial, onCerrar }) {
  const [plantilla, setPlantilla] = useState(plantillaInicial);
  const [demora, setDemora] = useState(30);
  const [texto, setTexto] = useState(() => PLANTILLAS[plantillaInicial].texto(venta, { demora: 30 }));
  const [telefono, setTelefono] = useState(venta.cliente_telefono ?? "");

  function elegir(id, nuevaDemora = demora) {
    setPlantilla(id);
    setDemora(nuevaDemora);
    setTexto(PLANTILLAS[id].texto(venta, { demora: nuevaDemora }));
  }

  function enviar() {
    const numero = venta.cliente_telefono || normalizarTelefono(telefono);
    if (!numero) return toast.error("Escribí el WhatsApp del cliente con código de área.");
    if (!texto.trim()) return toast.error("El mensaje está vacío.");
    window.open(linkWhatsAppCliente(numero, texto.trim()), "_blank", "noopener,noreferrer");
    onCerrar();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-fondo px-3 py-2.5 text-sm">
        <span className="text-tinta-suave">Cliente: </span>
        <strong>{venta.cliente_nombre || "Sin nombre"}</strong>
        {venta.cliente_telefono ? (
          <span className="ml-2 text-tinta-suave">{mostrarTelefono(venta.cliente_telefono)}</span>
        ) : (
          <label className="mt-2 block">
            <span className="etiqueta">Este pedido no tiene WhatsApp cargado. Escribilo:</span>
            <input
              className="campo"
              inputMode="tel"
              placeholder="Ej.: 388 4131570"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
            />
          </label>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo de mensaje">
        {Object.entries(PLANTILLAS).map(([id, p]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={plantilla === id}
            onClick={() => elegir(id)}
            className={`rounded-xl border-2 px-2 py-2.5 text-xs font-semibold sm:text-sm ${
              plantilla === id ? "border-whatsapp bg-whatsapp/10 text-tinta" : "border-borde text-tinta-suave hover:border-tinta-suave"
            }`}
          >
            {p.nombre}
          </button>
        ))}
      </div>

      {plantilla === "confirmado" && (
        <div>
          <span className="etiqueta">Tiempo estimado</span>
          <div className="flex flex-wrap gap-2">
            {DEMORAS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => elegir("confirmado", m)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${demora === m ? "bg-tinta text-fondo" : "bg-borde text-tinta"}`}
              >
                {m} min
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="block">
        <span className="etiqueta">Mensaje (lo podés cambiar antes de enviarlo)</span>
        <textarea className="campo resize-none" rows={4} maxLength={600} value={texto} onChange={(e) => setTexto(e.target.value)} />
      </label>

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="boton-secundario" onClick={onCerrar}>
          Ahora no
        </button>
        <button type="button" className="boton-whatsapp" onClick={enviar}>
          <IconoWhatsApp /> Enviar por WhatsApp
        </button>
      </div>
    </div>
  );
}

// Responder al cliente por WhatsApp: pedido recibido, confirmado o en camino
export default function AvisoCliente({ aviso, onCerrar }) {
  return (
    <Modal abierto={Boolean(aviso)} onCerrar={onCerrar} titulo={aviso ? `Avisar al cliente · pedido #${aviso.venta.numero}` : ""} ancho="max-w-lg">
      {aviso && <Contenido key={`${aviso.venta.id}-${aviso.plantilla}`} venta={aviso.venta} plantillaInicial={aviso.plantilla} onCerrar={onCerrar} />}
    </Modal>
  );
}
