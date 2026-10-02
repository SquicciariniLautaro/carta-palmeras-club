// Por ahora el menú vive acá, en un archivo. Más adelante lo vamos a
// leer desde la base de datos (Supabase) y este archivo desaparece.

// Helpers para no repetir código
const simpleDoble = (simple, doble) => [
  { nombre: "Simple", precio: simple },
  { nombre: "Doble", precio: doble },
];
const unico = (precio) => [{ nombre: "Único", precio }];

export const categorias = [
  { id: "burguers", nombre: "Burguers" },
  { id: "promos", nombre: "Promos" },
  { id: "pizzas", nombre: "Pizzas" },
  { id: "sandwiches", nombre: "Sandwiches" },
  { id: "papas", nombre: "Papas" },
  { id: "napolitanas", nombre: "Napolitanas" },
  { id: "bebidas", nombre: "Bebidas" },
];

// "imagen" queda vacía hasta que el cliente suba las fotos desde el panel.
export const productos = [
  // BURGUERS
  { id: "cheese", categoria: "burguers", nombre: "Burguer Cheese", descripcion: "Medallones de carne y cheddar.", opciones: simpleDoble(7500, 11000), imagen: "" },
  { id: "big-mac", categoria: "burguers", nombre: "Burguer Big Mac", descripcion: "Carne, salsa Big Mac, cheddar, pepinillos, lechuga y cebolla.", opciones: simpleDoble(8500, 11000), imagen: "" },
  { id: "big-bang", categoria: "burguers", nombre: "Burguer Big Bang", descripcion: "Carne, salsa de la casa, cheddar, cebolla y bacon.", opciones: simpleDoble(8500, 11000), imagen: "" },
  { id: "texas", categoria: "burguers", nombre: "Burguer Texas", descripcion: "Carne, cheddar, bacon, barbacoa y aros de cebolla.", opciones: simpleDoble(8500, 11000), imagen: "" },
  { id: "milwaukee", categoria: "burguers", nombre: "Burguer Milwaukee", descripcion: "Carne, cheddar, bacon, cebolla crispy, lechuga, tomate y mayonesa.", opciones: simpleDoble(8500, 11000), imagen: "" },
  { id: "cuarto", categoria: "burguers", nombre: "Cuarto de Libra", descripcion: "Carne, cheddar, extra bacon y cebolla en cubos.", opciones: simpleDoble(8500, 11000), imagen: "" },
  { id: "americana", categoria: "burguers", nombre: "Burguer Americana", descripcion: "Carne, cheddar, extra bacon, pepinillos, cebolla morada, ketchup y alioli.", opciones: simpleDoble(8500, 11000), imagen: "" },
  { id: "alabama", categoria: "burguers", nombre: "Burguer Alabama", descripcion: "Carne, cheddar, pepinillos, cebolla crispy, lechuga, tomate y mayonesa.", opciones: simpleDoble(8500, 11000), imagen: "" },
  { id: "cbh", categoria: "burguers", nombre: "Burguer CBH", descripcion: "Carne, cheddar, extra bacon, manteca y miel.", opciones: simpleDoble(8500, 11000), imagen: "" },

  // PROMOS
  { id: "promo-cheese", categoria: "promos", nombre: "Promo Cheese Simples", descripcion: "3 burguers cheese simples con papas.", opciones: unico(17000), imagen: "" },
  { id: "promo-burritos", categoria: "promos", nombre: "Promo Burritos Burguer", descripcion: "2 burritos a elección (Texas o Milwaukee) con papas.", opciones: unico(16000), imagen: "" },

  // PIZZAS
  { id: "muzza-clasica", categoria: "pizzas", nombre: "Muzzarella clásica", descripcion: "", opciones: unico(9000), imagen: "" },
  { id: "muzza-especial", categoria: "pizzas", nombre: "Muzzarella especial", descripcion: "", opciones: unico(9000), imagen: "" },
  { id: "pizza-napolitana", categoria: "pizzas", nombre: "Napolitana", descripcion: "", opciones: unico(9000), imagen: "" },
  { id: "pizza-huevo", categoria: "pizzas", nombre: "Huevo", descripcion: "", opciones: unico(9000), imagen: "" },
  { id: "pizza-choclo", categoria: "pizzas", nombre: "Choclo", descripcion: "", opciones: unico(9000), imagen: "" },
  { id: "pizza-provenzal", categoria: "pizzas", nombre: "Provenzal", descripcion: "", opciones: unico(9000), imagen: "" },
  { id: "pizza-americana", categoria: "pizzas", nombre: "Americana", descripcion: "", opciones: unico(10000), imagen: "" },
  { id: "fugazzeta", categoria: "pizzas", nombre: "Fugazzeta", descripcion: "", opciones: unico(9000), imagen: "" },

  // SANDWICHES
  { id: "lomito-especial", categoria: "sandwiches", nombre: "Lomito especial", descripcion: "", opciones: unico(9500), imagen: "" },
  { id: "lomito-criollo", categoria: "sandwiches", nombre: "Lomito criollo", descripcion: "", opciones: unico(9500), imagen: "" },
  { id: "lomito-americano", categoria: "sandwiches", nombre: "Lomito americano", descripcion: "", opciones: unico(9500), imagen: "" },
  { id: "mila-especial", categoria: "sandwiches", nombre: "Milanesa especial", descripcion: "", opciones: unico(9500), imagen: "" },
  { id: "mila-criolla", categoria: "sandwiches", nombre: "Milanesa criolla", descripcion: "", opciones: unico(9500), imagen: "" },
  { id: "mila-casa", categoria: "sandwiches", nombre: "Milanesa de la casa", descripcion: "", opciones: unico(9500), imagen: "" },

  // PAPAS
  { id: "papas-salchicha", categoria: "papas", nombre: "Papas con salchicha", descripcion: "", opciones: unico(8500), imagen: "" },
  { id: "papas-caballo", categoria: "papas", nombre: "Papas tradicionales a caballo", descripcion: "", opciones: unico(9000), imagen: "" },
  { id: "papas-americana", categoria: "papas", nombre: "Papas americana", descripcion: "", opciones: unico(10000), imagen: "" },
  { id: "papas-revuelto", categoria: "papas", nombre: "Papas con huevo revuelto", descripcion: "", opciones: unico(8500), imagen: "" },
  { id: "papas-simples", categoria: "papas", nombre: "Papas simples", descripcion: "", opciones: unico(8000), imagen: "" },

  // NAPOLITANAS
  { id: "napo-1", categoria: "napolitanas", nombre: "Napolitana para 1 persona", descripcion: "", opciones: unico(10000), imagen: "" },
  { id: "napo-2", categoria: "napolitanas", nombre: "Napolitana para 2 personas", descripcion: "", opciones: unico(19000), imagen: "" },
  { id: "napo-3", categoria: "napolitanas", nombre: "Napolitana para 3 personas", descripcion: "", opciones: unico(28000), imagen: "" },

  // BEBIDAS
  { id: "coca-500", categoria: "bebidas", nombre: "Coca Cola 500 ml", descripcion: "", opciones: unico(3000), imagen: "" },
  { id: "aquarius-15", categoria: "bebidas", nombre: "Aquarius 1.5 L", descripcion: "", opciones: unico(3500), imagen: "" },
  { id: "coca-15", categoria: "bebidas", nombre: "Coca Cola 1.5 L", descripcion: "", opciones: unico(4500), imagen: "" },
  { id: "agua-500", categoria: "bebidas", nombre: "Agua mineral 500 ml", descripcion: "", opciones: unico(2000), imagen: "" },
];
