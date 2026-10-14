# Las Palmeras Club · Catálogo + Panel de administración

> **¿Primera vez?** Seguí la [guía paso a paso para conectar Supabase](GUIA-SUPABASE.md).

Catálogo público donde los clientes arman su pedido y lo mandan por WhatsApp, más un panel privado (`/admin`) para cargar comidas, seguir los pedidos hasta cerrarlos y ver el historial de ventas.

**Stack:** React 19 + Vite · Tailwind CSS v4 · React Router · Supabase (Postgres, Auth, RLS) · Cloudinary (fotos en WebP) · Recharts · react-hot-toast · Vercel.

Casi no hay backend propio: el navegador habla directo con Supabase usando la clave **anónima**. La seguridad la ponen las políticas RLS y las funciones RPC de `supabase/schema.sql` (los precios del pedido se calculan siempre en la base). Lo único del lado del servidor es `api/cloudinary.js`, una función de Vercel que firma las subidas de fotos y borra las viejas (solo para administradores), para que la clave secreta de Cloudinary nunca llegue al navegador.

## Estructura

```
supabase/schema.sql        tablas, funciones RPC, RLS, bucket y políticas de Storage
api/cloudinary.js          función de Vercel: firma subidas y borra fotos en Cloudinary
vercel.json                reescritura SPA, cabeceras de seguridad y caché
src/
  main.jsx                 BrowserRouter + Toaster
  App.jsx                  rutas: /, /admin (carga diferida) y redirección
  index.css                Tailwind + colores de marca en @theme
  config.js                nombre, WhatsApp, Instagram y límites
  lib/                     supabase.js, formato.js, whatsapp.js, imagenes.js, opciones.js, opcionesForm.js
  hooks/                   useSesion.js, useCarrito.js
  pages/                   Catalogo.jsx, Admin.jsx
  components/catalogo/     Navbar, Filtros, TarjetaProducto, DetalleProducto, Carrito,
                           CarritoProvider, ControlCantidad, Precio, BotonFlotante, Footer, Preloader
  components/admin/        Login, Panel, ListaComidas, FormComida, OpcionesComida, SubirImagen, Categorias,
                           HistorialVentas, PedidosAbiertos, EstadoPedido, DetalleVenta, EditarVenta,
                           VentaManual, GraficoVentas, ventasUtils
  components/ui/           Logo, Modal, Confirmar, Cargando, Iconos
```

## Requisitos

- Node.js 20 o superior y npm.
- Una cuenta gratuita en [Supabase](https://supabase.com), otra en [Cloudinary](https://cloudinary.com) y otra en [Vercel](https://vercel.com).

## 1. Crear la base en Supabase

1. Creá un proyecto nuevo en Supabase (región más cercana: São Paulo).
2. Andá a **SQL Editor → New query**, pegá todo `supabase/schema.sql` y tocá **Run**. Crea las tablas, las funciones, las políticas RLS, el bucket `comidas` (solo para las fotos viejas) y el menú inicial (categorías y productos del menú impreso). Se puede volver a correr sin romper nada; en una base existente también migra a esta versión (saca el stock, pasa los estados de los pedidos y une las napolitanas).
3. **Desactivá el registro público:** Authentication → Sign In / Providers → desactivá **"Allow new users to sign up"**. Así nadie más puede crearse una cuenta.
4. **Creá el usuario del dueño:** Authentication → Users → **Add user → Create new user**, con correo y contraseña (marcá "Auto Confirm User").
5. **Hacelo administrador:** en el SQL Editor corré (con su correo):

   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'dueño@ejemplo.com';
   ```

6. Copiá la **Project URL** y la **anon public key** (Project Settings → API). **Nunca** uses la clave `service_role` en el frontend.

## 2. Variables de entorno

Copiá `.env.example` como `.env` y completalo:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_WHATSAPP_NUMBER=5493884131570     # internacional, sin +, sin 0 ni 15
VITE_INSTAGRAM_URL=https://www.instagram.com/laspalmeras.club   # opcional

# Cloudinary → Settings → API Keys. Sin VITE_: solo las lee api/cloudinary.js
CLOUDINARY_CLOUD_NAME=tu-cloud-name
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=xxxxxxxx
```

`npm run dev` también sirve `/api/cloudinary` (lo hace `vite.config.js`), así que las fotos se pueden subir en la compu con el mismo `.env`.

## 3. Correr en tu compu

```bash
npm install
npm run dev       # http://localhost:5173  (panel en /admin)
npm run build     # corre ESLint (0 advertencias) y genera dist/
npm run preview   # sirve dist/ para probar el build
```

## 4. Publicar en Vercel

1. Subí el proyecto a un repositorio de GitHub (el `.env` no se sube: está en `.gitignore`).
2. En Vercel: **Add New → Project**, importá el repositorio. Detecta Vite solo.
3. En **Environment Variables** cargá las mismas variables del `.env` (incluidas las de Cloudinary).
4. **Deploy.** `vercel.json` ya resuelve que `/admin` funcione al recargar, agrega las cabeceras de seguridad (CSP, HSTS, etc.) y el caché largo de `/assets`.
5. Si cambiás una variable de entorno, hacé **Redeploy** (Vite las incorpora al compilar).

## Cómo funciona

**Pedido web:** el cliente arma el carrito (se guarda en el navegador y se revalida contra las opciones actuales al entrar), opcionalmente pone nombre y nota, y toca "Enviar pedido por WhatsApp". La app llama a `crear_pedido`, que toma los precios de la base, valida límites (máx. 30 productos distintos, 50 unidades por producto, 100 por pedido, 20 pedidos web por minuto) y guarda la venta como **pendiente**. Después se abre WhatsApp con el mensaje y el número de pedido. No se maneja stock: lo que no hay se desactiva.

**Pedidos:** estados `pendiente → en_preparacion → enviado → entregado → cerrado` (o `cancelado`), elegibles desde un menú desplegable. **Cerrado** = entregado y cobrado: solo esos cuentan en la facturación. Los pedidos sin cerrar (de cualquier fecha) se muestran arriba de todo en Ventas, con un botón grande para cerrarlos y una confirmación que muestra el total a cobrar. Cada pedido se puede **editar** (`editar_venta`: cantidades, sumar o sacar productos, cliente y nota; lo que ya estaba conserva su precio) o **borrar**. Las **ventas manuales** quedan cerradas al registrarse.

**Pedidos en vivo:** `usePedidosEnVivo` escucha la tabla `ventas` con Supabase Realtime (y revisa cada 30 s por las dudas). Con un pedido web nuevo suena un aviso (`lib/sonido.js`), aparece un toast y, si la pestaña no está a la vista y se dieron permisos, una notificación del navegador. La pestaña Ventas muestra el contador de pedidos sin cerrar.

**Horario de atención:** tabla `horarios` (un turno por día, hora de Argentina; si `desde > hasta` cruza la medianoche, si son iguales es todo el día). `crear_pedido` rechaza pedidos cuando `local_abierto()` da falso, y la carta muestra el cartel de cerrado y bloquea el botón (`lib/horarios.js`, misma regla). Se edita en el panel, pestaña Horarios.

**Imágenes:** se achican a 1200 px y se comprimen en el navegador, se suben a Cloudinary con una firma que da `api/cloudinary.js` (con `format=webp`, así siempre quedan en WebP) y se borra la anterior al reemplazarla o al borrar la comida. En la carta se piden recortadas con `c_fill,g_auto` (la comida queda centrada) al tamaño de cada recuadro.

## Personalizar

- **Colores:** `src/index.css`, bloque `@theme`. Están tomados del menú impreso: negro (`--color-noche`), amarillo queso (`--color-queso`), naranja para promos (`--color-naranja`) y crema para el texto. El borde de queso derretido está en `src/components/ui/QuesoDerretido.jsx`.
- **Tipografías:** Poppins para el texto y Yellowtail (script, como los títulos del menú impreso) para los títulos.
- **Logo:** `src/assets/logo-blanco.png` (el que se usa sobre fondo negro) y `src/assets/logo-negro.png`. El favicon está en `public/`.
- **WhatsApp e Instagram:** ya vienen cargados en `src/config.js` (3884 13-1570 y @laspalmeras.club); las variables de entorno los pueden pisar.
- **Menú inicial:** el SQL carga las 7 categorías y los productos del menú impreso (cada burguer con variantes Simple / Doble y la Napolitana con variantes para 1, 2 o 3 personas). Subí las fotos desde el panel.
- **Límites del carrito:** `src/config.js` (si cambiás los límites, cambialos también en `_agregar_items` y `_recalcular_venta` del SQL).
