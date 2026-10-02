import { useState } from "react";
import { formatearPrecio } from "../utils/pedido";

// Props = datos que le pasa el componente padre (App).
// useState = memoria propia de ESTA tarjeta: recuerda si el cliente eligió Simple o Doble.
function ProductCard({ producto, onAgregar }) {
  const [indice, setIndice] = useState(0);
  const opcion = producto.opciones[indice];

  return (
    <article className="card">
      <div className="card__img">
        {producto.imagen ? <img src={producto.imagen} alt={producto.nombre} /> : <span aria-hidden="true">🍽️</span>}
      </div>

      <div className="card__body">
        <h3 className="card__titulo">{producto.nombre}</h3>
        {producto.descripcion && <p className="card__desc">{producto.descripcion}</p>}

        {producto.opciones.length > 1 && (
          <div className="chips">
            {producto.opciones.map((o, i) => (
              <button
                key={o.nombre}
                className={`chip ${i === indice ? "chip--activo" : ""}`}
                onClick={() => setIndice(i)}
              >
                {o.nombre}
              </button>
            ))}
          </div>
        )}

        <div className="card__pie">
          <strong className="card__precio">{formatearPrecio(opcion.precio)}</strong>
          <button className="btn-agregar" onClick={() => onAgregar(producto, opcion)}>
            Agregar
          </button>
        </div>
      </div>
    </article>
  );
}

export default ProductCard;
