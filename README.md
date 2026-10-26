# Las Palmeras Club · Catálogo + Panel de administración

> **¿Primera vez?** Seguí la [guía paso a paso para conectar Supabase](GUIA-SUPABASE.md).

Catálogo público donde los clientes arman su pedido y lo mandan por WhatsApp, más un panel privado (`/admin`) para administrar el negocio: venta noche (la carta) y venta mediodía (uso interno), cobros en efectivo, transferencia o cuenta corriente, caja con arqueos, cuentas corrientes de clientes, gastos y costos, finanzas, tickets para la ticketera y reportes en Excel para el contador.

**Stack:** React 19 + Vite · Tailwind CSS v4 · React Router · Supabase (Postgres, Auth, RLS) · Cloudinary (fotos en WebP) · Recharts · ExcelJS · react-hot-toast · Vercel.

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
  lib/                     supabase.js, formato.js, whatsapp.js, imagenes.js, opciones.js, opcionesForm.js,
                           impresion.js (ticketera), excel.js y reportes.js (planillas), mensajesCliente.js
  hooks/                   useSesion.js, useCarrito.js, usePedidosEnVivo.js, useCaja.js
  pages/                   Catalogo.jsx, Admin.jsx
  components/catalogo/     Navbar, Filtros, TarjetaProducto, DetalleProducto, Carrito,
                           CarritoProvider, ControlCantidad, Precio, BotonFlotante, Footer, Preloader
  components/admin/        Login, Panel, Turno (venta noche / mediodía), VentasTurno, TableroPedidos,
                           DetalleVenta, EditarVenta, VentaLocal, CobrarVenta, FormPagos, AvisoCliente,
                           MenuDia, ListaComidas, FormComida, OpcionesComida, SubirImagen, Categorias,
                           Horarios, Caja, CuentasCorrientes, Gastos, Finanzas, ConfigImpresora,
                           CajaProvider, EstadoPedido, GraficoVentas, ventasUtils, pagosUtils
  components/ui/           Logo, Modal, Confirmar, Cargando, Iconos
```

## Requisitos

- Node.js 20 o superior y npm.
- Una cuenta gratuita en [Supabase](https://supabase.com), otra en [Cloudinary](https://cloudinary.com) y otra en [Vercel](https://vercel.com).

## 1. Crear la base en Supabase

1. Creá un proyecto nuevo en Supabase (región más cercana: São Paulo).
2. Andá a **SQL Editor → New query**, pegá todo `supabase/schema.sql` y tocá **Run**. **Si ya tenías la base de la versión anterior, volvé a correrlo entero**: agrega turnos, cobros, caja, gastos y cuentas corrientes sin perder datos (borra los pedidos cancelados). Crea las tablas, las funciones, las políticas RLS, el bucket `comidas` (solo para las fotos viejas) y el menú inicial (categorías y productos del menú impreso). Se puede volver a correr sin romper nada; en una base existente también migra a esta versión (saca el stock, pasa los estados de los pedidos y une las napolitanas).
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

**Dos ventas separadas:** el panel tiene **Venta noche** (la carta online: pedidos por WhatsApp y ventas en caja de la noche) y **Venta mediodía** (menú del mediodía, solo de uso interno: no aparece en la carta y sus platos no llevan foto). Cada una tiene sus ventas, comidas, categorías y horarios; el mediodía suma el **Menú del día**, un cronograma semanal de qué platos salen cada día. Las categorías, comidas, ventas y horarios tienen la columna `turno` (`noche` / `mediodia`).

**Pedido web:** el cliente arma el carrito, pone su nombre, su **WhatsApp** (obligatorio, para poder confirmarle el pedido) y la entrega, y toca "Enviar pedido por WhatsApp". `crear_pedido` toma los precios de la base, valida límites (máx. 30 productos distintos, 50 unidades por producto, 100 por pedido, 20 pedidos web por minuto) y guarda la venta como **nueva**. Solo acepta comidas activas de la noche.

**Tablero de pedidos:** una columna por estado (`pendiente → en_preparacion → enviado → entregado`), cada pedido avanza con un solo botón y cada estado tiene su animación (los nuevos laten, en preparación muestra una barra en movimiento, en camino una moto que va y viene, entregado hace brillar el botón de cobrar). Los pedidos demorados se marcan en rojo y una franja arriba del panel avisa los pedidos nuevos sin confirmar. Al **confirmar** un pedido web se imprime la comanda (si está configurado) y se abre el mensaje para el cliente. Los pedidos **cancelados se eliminan** (un trigger también borra cualquier venta que pase a `cancelado`).

**Respuestas al cliente:** desde cada pedido web se abre WhatsApp en el chat del cliente con el mensaje escrito: *pedido recibido*, *pedido confirmado* (con tiempo estimado) o *en camino / listo para retirar*. Se puede editar antes de enviarlo.

**Cobros (cerrar cuenta):** una venta solo pasa a `cerrado` (cobrada) registrando cómo se pagó: efectivo (con cálculo de vuelto), transferencia, cuenta corriente o una combinación (`cobrar_venta`, tabla `pagos`). Efectivo y transferencia necesitan la caja abierta. Una venta cobrada no se edita: primero se anula el cobro (`anular_cobro`), salvo que ya esté en un arqueo cerrado. Las **ventas en caja** (`registrar_venta_local`) se cobran en el momento o quedan como cuenta abierta (mesa) en el tablero.

**Caja:** cada apertura es un arqueo (`abrir_caja`, solo uno abierto). Muestra el efectivo que tiene que haber (inicial + ventas en efectivo + pagos de cuentas corrientes + ingresos − retiros − gastos pagados con la caja), lo vendido por forma de pago y por turno, y los movimientos. Se cierra con el conteo de billetes (`cerrar_caja`): queda guardado con una copia de los totales, la diferencia (faltante o sobrante) y se imprime. **Un arqueo cerrado no se puede editar** (lo bloquean triggers, también sus cobros, movimientos y gastos); si hubo un error se borra, y sus cobros se pueden sumar a la próxima caja.

**Cuentas corrientes:** clientes con DNI/CUIT, teléfono y límite de crédito opcional. Estado de cuenta con debe, haber y saldo, y la comanda de cada consumo. Se registran pagos parciales o se **cierra la cuenta** cobrando el saldo completo (`cobrar_cuenta_corriente`). Vista `clientes_saldos`.

**Gastos y costos:** categorías contables, costo fijo o variable, proveedor, comprobante, pagado o pendiente (con vencimiento y aviso de vencidos) y si se pagó con la plata de la caja.

**Finanzas:** ganancia del período (ventas − gastos), dinero que entró y que quedó, por cobrar, por pagar y **libre para gastar** (lo cobrado menos lo pagado y menos las facturas pendientes), con gráfico y explicación de cada número.

**Excel para el contador:** cada sección descarga su planilla `.xlsx` (ventas, detalle de productos, arqueos, cuentas corrientes, estado de cuenta, gastos) y Finanzas arma el **reporte contable** completo en un solo archivo (resumen, ventas, productos, cobros, gastos, arqueos y cuentas corrientes), con importes en pesos, fechas reales, filtros y totales con fórmula. ExcelJS se descarga recién al exportar.

**Ticketera:** botón *Ticketera* en el panel. Imprime la **comanda** para la cocina (grande, sin precios), el **ticket** del cliente (no fiscal) y el **resumen del arqueo**, en papel de 80 o 58 mm. Se puede imprimir la comanda sola al llegar cada pedido web y/o al confirmarlo. Si en la vista previa el ticket sale chiquito en una hoja A4, Windows no tiene instalada la ticketera (está imprimiendo en "Microsoft Print to PDF"): hay que instalar el driver de la marca (3nStar: 3nstar.com → Soporte → Drivers; por red, la IP sale en la hoja de autotest que imprime al prenderla con FEED apretado). Para que salga directo sin el cuadro de diálogo: destildar "Permitir que Windows administre mi impresora predeterminada", dejar la ticketera como predeterminada y abrir el panel con un acceso directo de Chrome con `--kiosk-printing` (con Chrome cerrado del todo). La ventana *Ticketera* tiene la guía paso a paso y un botón para copiar el acceso directo.

**Pedidos en vivo:** `usePedidosEnVivo` escucha la tabla `ventas` con Supabase Realtime (y revisa cada 30 s por las dudas). Con un pedido web nuevo suena un aviso (`lib/sonido.js`), aparece un aviso en el panel y, si la pestaña no está a la vista y se dieron permisos, una notificación del navegador.

**Horario de atención:** tabla `horarios` (un horario por turno y por día, hora de Argentina; el de la noche es el que controla la carta; si `desde > hasta` cruza la medianoche, si son iguales es todo el día). `crear_pedido` rechaza pedidos cuando `local_abierto()` da falso, y la carta muestra el cartel de cerrado y bloquea el botón (`lib/horarios.js`, misma regla). Se edita en el panel, pestaña Horarios.

**Imágenes:** se achican a 1200 px y se comprimen en el navegador, se suben a Cloudinary con una firma que da `api/cloudinary.js` (con `format=webp`, así siempre quedan en WebP) y se borra la anterior al reemplazarla o al borrar la comida. En la carta se piden recortadas con `c_fill,g_auto` (la comida queda centrada) al tamaño de cada recuadro.

## Personalizar

- **Colores:** `src/index.css`, bloque `@theme`. Están tomados del menú impreso: negro (`--color-noche`), amarillo queso (`--color-queso`), naranja para promos (`--color-naranja`) y crema para el texto. El borde de queso derretido está en `src/components/ui/QuesoDerretido.jsx`.
- **Tipografías:** Poppins para el texto y Yellowtail (script, como los títulos del menú impreso) para los títulos.
- **Logo:** `src/assets/logo-blanco.png` (el que se usa sobre fondo negro) y `src/assets/logo-negro.png`. El favicon está en `public/`.
- **WhatsApp e Instagram:** ya vienen cargados en `src/config.js` (3884 13-1570 y @laspalmeras.club); las variables de entorno los pueden pisar.
- **Menú inicial:** el SQL carga las 7 categorías y los productos del menú impreso (cada burguer con variantes Simple / Doble y la Napolitana con variantes para 1, 2 o 3 personas). Subí las fotos desde el panel.
- **Límites del carrito:** `src/config.js` (si cambiás los límites, cambialos también en `_agregar_items` y `_recalcular_venta` del SQL).
