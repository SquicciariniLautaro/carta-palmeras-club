import Modal from "../ui/Modal";
import { IconoWhatsApp } from "../ui/Iconos";
import { tieneOpciones } from "../../lib/opciones";
import ControlCantidad from "./ControlCantidad";
import Precio from "./Precio";
import { ImagenComida } from "./TarjetaProducto";

// Modal con la descripción completa de una comida
export default function DetalleProducto({ comida, categoria, cantidad, onCerrar, onAgregar, onSumar, onRestar, onPersonalizar, onConsultar }) {
  return (
    <Modal abierto={Boolean(comida)} onCerrar={onCerrar} titulo={comida?.nombre ?? ""}>
      {comida && (
        <div className="space-y-4">
          <ImagenComida comida={comida} className="aspect-[4/3] w-full rounded-xl" proporcion="4:3" ancho={900} />
          {categoria && <p className="text-xs font-medium uppercase tracking-wider text-palmera">{categoria}</p>}
          <p className="whitespace-pre-line text-sm text-tinta-suave">
            {comida.descripcion || "Sin descripción."}
          </p>
          <Precio comida={comida} grande />
          <div className="grid gap-2 sm:grid-cols-2">
            {tieneOpciones(comida) ? (
              <button type="button" className="boton-primario" onClick={onPersonalizar}>
                Armar mi pedido
              </button>
            ) : cantidad > 0 ? (
              <ControlCantidad cantidad={cantidad} onSumar={onSumar} onRestar={onRestar} nombre={comida.nombre} />
            ) : (
              <button type="button" className="boton-primario" onClick={onAgregar}>
                Agregar al pedido
              </button>
            )}
            <button type="button" className="boton-secundario" onClick={onConsultar}>
              <IconoWhatsApp className="size-4 text-whatsapp" /> Consultar
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
