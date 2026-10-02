// Datos del negocio. El WhatsApp y el Instagram se pueden cambiar con las
// variables de entorno (.env en local, o el panel de Vercel en producción);
// si no están, se usan los valores reales de abajo.
export const NEGOCIO = {
  nombre: "Las Palmeras Club",
  // Formato internacional sin "+": 549 + código de área + número (sin 0 ni 15)
  whatsapp: import.meta.env.VITE_WHATSAPP_NUMBER || "5493884131570",
  instagram: import.meta.env.VITE_INSTAGRAM_URL || "https://www.instagram.com/laspalmeras.club",
};

// Límites del pedido (los mismos que valida la base en crear_pedido)
export const LIMITES = {
  unidadesPorProducto: 50,
  unidadesPorPedido: 100,
  productosDistintos: 30,
};

// Desde cuántas unidades se muestra "Quedan N"
export const STOCK_BAJO = 5;

// Imágenes de comidas
export const IMAGENES = {
  bucket: "comidas",
  tamanoMaximo: 2 * 1024 * 1024, // 2 MB
  tipos: ["image/jpeg", "image/png", "image/webp"],
  ladoMaximo: 1200, // px
};
