import { useState } from "react";
import Header from "./components/Header";
import CategoryTabs from "./components/CategoryTabs";
import ProductCard from "./components/ProductCard";
import Cart from "./components/Cart";
import { categorias, productos } from "./data/menu";
import { formatearPrecio } from "./utils/pedido";

function App() {
  // ESTADO: el carrito vive acá porque lo necesitan varios componentes
  // (las tarjetas lo modifican, el carrito lo muestra, la barra de abajo lo resume).
  const [carrito, setCarrito] = useState([]);
  const [carritoAbierto, setCarritoAbierto] = useState(false);

  const agregar = (producto, opcion) => {
    const clave = `${producto.id}-${opcion.nombre}`;
    setCarrito((actual) => {
      const existe = actual.find((i) => i.clave === clave);
      if (existe) {
        return actual.map((i) => (i.clave === clave ? { ...i, cantidad: i.cantidad + 1 } : i));
      }
      return [...actual, { clave, nombre: producto.nombre, opcion: opcion.nombre, precio: opcion.precio, cantidad: 1 }];
    });
  };

  const cambiarCantidad = (clave, cambio) => {
    setCarrito((actual) =>
      actual
        .map((i) => (i.clave === clave ? { ...i, cantidad: i.cantidad + cambio } : i))
        .filter((i) => i.cantidad > 0)
    );
  };

  const cantidadTotal = carrito.reduce((s, i) => s + i.cantidad, 0);
  const total = carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);

  return (
    <>
      <Header />
      <CategoryTabs categorias={categorias} />

      <main className="menu">
        {categorias.map((cat) => (
          <section key={cat.id} id={cat.id} className="seccion">
            <h2 className="seccion__titulo">{cat.nombre}</h2>
            <div className="grilla">
              {productos
                .filter((p) => p.categoria === cat.id)
                .map((p) => (
                  <ProductCard key={p.id} producto={p} onAgregar={agregar} />
                ))}
            </div>
          </section>
        ))}
      </main>

      {cantidadTotal > 0 && !carritoAbierto && (
        <button className="barra-carrito" onClick={() => setCarritoAbierto(true)}>
          <span>Ver pedido ({cantidadTotal})</span>
          <strong>{formatearPrecio(total)}</strong>
        </button>
      )}

      <Cart
        items={carrito}
        abierto={carritoAbierto}
        onCerrar={() => setCarritoAbierto(false)}
        onCambiarCantidad={cambiarCantidad}
        onVaciar={() => setCarrito([])}
      />
    </>
  );
}

export default App;
