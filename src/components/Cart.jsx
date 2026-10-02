import { useState } from "react";
import { formatearPrecio, armarMensaje, linkWhatsApp } from "../utils/pedido";

function Cart({ items, abierto, onCerrar, onCambiarCantidad, onVaciar }) {
  const [datos, setDatos] = useState({
    nombre: "",
    entrega: "retiro",
    direccion: "",
    pago: "Efectivo",
    notas: "",
  });

  const total = items.reduce((suma, i) => suma + i.precio * i.cantidad, 0);

  // Una sola función para actualizar cualquier campo del formulario
  const cambiar = (e) => setDatos({ ...datos, [e.target.name]: e.target.value });

  const faltaDireccion = datos.entrega === "delivery" && !datos.direccion.trim();
  const puedeEnviar = items.length > 0 && datos.nombre.trim() && !faltaDireccion;

  const enviar = () => {
    const mensaje = armarMensaje({ items, datos, total });
    window.open(linkWhatsApp(mensaje), "_blank");
  };

  if (!abierto) return null;

  return (
    <div className="overlay" onClick={onCerrar}>
      <aside className="cart" onClick={(e) => e.stopPropagation()} aria-label="Tu pedido">
        <div className="cart__cabecera">
          <h2>Tu pedido</h2>
          <button className="cart__cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

        {items.length === 0 ? (
          <p className="cart__vacio">Todavía no agregaste nada. Elegí algo de la carta.</p>
        ) : (
          <>
            <ul className="cart__lista">
              {items.map((i) => (
                <li key={i.clave} className="cart__item">
                  <div>
                    <strong>{i.nombre}</strong>
                    {i.opcion !== "Único" && <span className="cart__opcion"> · {i.opcion}</span>}
                    <div className="cart__subtotal">{formatearPrecio(i.precio * i.cantidad)}</div>
                  </div>
                  <div className="cantidad">
                    <button onClick={() => onCambiarCantidad(i.clave, -1)} aria-label="Quitar uno">−</button>
                    <span>{i.cantidad}</span>
                    <button onClick={() => onCambiarCantidad(i.clave, 1)} aria-label="Agregar uno">+</button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="form">
              <label>
                Tu nombre
                <input name="nombre" value={datos.nombre} onChange={cambiar} placeholder="Ej: Juan Pérez" />
              </label>

              <label>
                ¿Cómo lo recibís?
                <select name="entrega" value={datos.entrega} onChange={cambiar}>
                  <option value="retiro">Retiro en el local</option>
                  <option value="delivery">Delivery</option>
                </select>
              </label>

              {datos.entrega === "delivery" && (
                <label>
                  Dirección
                  <input name="direccion" value={datos.direccion} onChange={cambiar} placeholder="Calle, número, barrio" />
                </label>
              )}

              <label>
                Forma de pago
                <select name="pago" value={datos.pago} onChange={cambiar}>
                  <option>Efectivo</option>
                  <option>Transferencia</option>
                </select>
              </label>

              <label>
                Aclaraciones (opcional)
                <textarea name="notas" value={datos.notas} onChange={cambiar} rows={2} placeholder="Sin cebolla, bien cocida..." />
              </label>
            </div>

            <div className="cart__total">
              <span>Total</span>
              <strong>{formatearPrecio(total)}</strong>
            </div>

            <button className="btn-enviar" onClick={enviar} disabled={!puedeEnviar}>
              Enviar pedido por WhatsApp
            </button>
            <button className="btn-vaciar" onClick={onVaciar}>Vaciar pedido</button>
          </>
        )}
      </aside>
    </div>
  );
}

export default Cart;
