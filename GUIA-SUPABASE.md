# Guía: conectar la carta con Supabase

Esta guía te lleva de cero a tener el catálogo y el panel de administración funcionando con datos reales. No hace falta programar: todo se hace desde la web de Supabase y copiando tres valores.

Tiempo estimado: 15 minutos.

## Antes de empezar

Vas a necesitar:
- Una cuenta en [supabase.com](https://supabase.com) (se entra con GitHub).
- El correo con el que va a entrar el dueño al panel.
- El proyecto abierto en VS Code (esta carpeta).

## Paso 1. Crear el proyecto en Supabase

1. Entrá a [supabase.com/dashboard](https://supabase.com/dashboard) y tocá **New project**.
2. Completá:
   - **Name:** `palmeras-club`
   - **Database password:** generá una y guardala en un lugar seguro (no se usa en la app, pero la vas a necesitar si algún día te conectás directo a la base).
   - **Region:** `South America (São Paulo)`, la más cercana a Argentina.
3. Tocá **Create new project** y esperá un par de minutos hasta que termine de prepararse.

## Paso 2. Cargar las tablas y el menú

1. En el menú de la izquierda abrí **SQL Editor** y tocá **New query**.
2. Abrí en VS Code el archivo `supabase/schema.sql`, copiá **todo** su contenido y pegalo en el editor de Supabase.
3. Tocá **Run** (abajo a la derecha). Tiene que aparecer **"Success. No rows returned"**.

Esto crea las tablas, las funciones, la seguridad, el espacio para las fotos y carga las 7 categorías y los productos del menú impreso.

Para comprobarlo: **Table Editor → comidas**. Tenés que ver los productos.

> Si lo corrés dos veces no pasa nada: el archivo está preparado para eso y no duplica productos.

## Paso 3. Desactivar el registro público

Así nadie más puede crearse una cuenta.

1. **Authentication → Sign In / Providers** (en algunas versiones: **Authentication → Providers → Email**).
2. Desactivá **"Allow new users to sign up"**.
3. Guardá con **Save**.

## Paso 4. Crear el usuario del dueño

1. **Authentication → Users → Add user → Create new user**.
2. Poné el correo y una contraseña segura.
3. Marcá **Auto Confirm User** (así no hace falta confirmar por mail).
4. Tocá **Create user**.

## Paso 5. Darle permisos de administrador

Crear el usuario no alcanza: hay que anotarlo en la lista de administradores.

1. Volvé a **SQL Editor → New query**.
2. Pegá esto cambiando el correo por el del usuario que acabás de crear:

   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'CORREO-DEL-DUEÑO@ejemplo.com';
   ```

3. **Run.** Tiene que decir "Success. 1 row affected" (o similar). Si dice "0 rows", el correo está mal escrito.

## Paso 6. Copiar las claves del proyecto

1. Abrí **Project Settings** (el engranaje abajo a la izquierda) **→ API Keys** (o tocá el botón **Connect** de arriba).
2. Copiá dos valores:
   - **Project URL**: algo como `https://abcdefgh.supabase.co`.
   - **anon public key**. En los proyectos nuevos se llama **Publishable key** y empieza con `sb_publishable_`. Sirve igual.
3. **No copies la `service_role` / `secret`.** Esa clave nunca se usa en esta app.

## Paso 7. Conectar el proyecto (variables de entorno)

1. En VS Code, en la raíz del proyecto, copiá el archivo `.env.example` y llamalo `.env`.
2. Completalo así (con tus valores):

   ```
   VITE_SUPABASE_URL=https://abcdefgh.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxxxxxxxx
   VITE_WHATSAPP_NUMBER=5493884131570
   VITE_INSTAGRAM_URL=https://www.instagram.com/laspalmeras.club
   ```

3. Para las fotos, sumá también las tres claves de Cloudinary (ver "Paso 7 bis").
4. El archivo `.env` **no se sube a GitHub** (ya está ignorado). Guardalo.

## Paso 7 bis. Conectar Cloudinary (fotos de las comidas)

Las fotos se guardan en [Cloudinary](https://cloudinary.com), siempre en formato **WebP** (livianas y rápidas). En la carta se muestran recortadas con la comida centrada.

1. Creá una cuenta gratis en [cloudinary.com](https://cloudinary.com).
2. Entrá a **Settings → API Keys** y copiá **Cloud name**, **API Key** y **API Secret**.
3. Agregalas al `.env` (y después a Vercel), **sin** `VITE_` adelante:

   ```
   CLOUDINARY_CLOUD_NAME=tu-cloud-name
   CLOUDINARY_API_KEY=123456789012345
   CLOUDINARY_API_SECRET=xxxxxxxxxxxxxxxx
   ```

   Sin `VITE_` esas claves se quedan en el servidor (la función `api/cloudinary.js`) y nunca llegan al navegador. El **API Secret** no se comparte con nadie.

Las fotos que ya estaban cargadas en Supabase siguen funcionando. Cuando cambies una, la nueva ya va a Cloudinary.

## Paso 8. Probar en tu compu

En la terminal de VS Code:

```bash
npm install
npm run dev
```

Abrí `http://localhost:5173` y comprobá:

- [ ] El catálogo muestra las categorías y los productos.
- [ ] Al agregar productos y tocar **Enviar pedido por WhatsApp** se abre WhatsApp con el mensaje.
- [ ] Entrá a `http://localhost:5173/admin` (o al link **Acceso administrador** del final de la página) e iniciá sesión con el correo y la contraseña del Paso 4.
- [ ] En **Ventas**, arriba de todo en **Pedidos sin cerrar**, aparece el pedido que acabás de enviar como **Pendiente**.
- [ ] En **Comidas → Editar** subí una foto: tiene que guardarse sin errores (eso confirma que Cloudinary está bien conectado).

Después de hacer cambios en el `.env`, cortá el servidor (Ctrl + C) y volvé a correr `npm run dev`.

## Paso 9. Publicar en Vercel

1. En [vercel.com](https://vercel.com) tocá **Add New → Project** e importá el repositorio `carta-palmeras-club`.
2. Vercel detecta Vite solo. Antes de desplegar, abrí **Environment Variables** y cargá **todas** las variables del `.env` (las cuatro de la página y las tres de Cloudinary).
3. Tocá **Deploy**.
4. Cuando termine, probá de nuevo la lista de arriba, pero en la dirección que te da Vercel.

Si más adelante cambiás una variable, hay que hacer **Redeploy** en Vercel para que se aplique.

## Publicar en GitHub Pages (para que el cliente lo pruebe)

El repositorio ya trae un workflow (`.github/workflows/pages.yml`) que compila la app y la publica solo cada vez que subís código a `main` o a `app-completa-supabase`.

1. En GitHub: **Settings → Pages → Build and deployment → Source**, elegí **GitHub Actions** (no "Deploy from a branch": esa opción muestra el código sin compilar y la página queda en blanco).
2. Entrá a la pestaña **Actions** y esperá a que "Publicar en GitHub Pages" termine con el tilde verde (1 o 2 minutos). Si no arrancó, tocá **Run workflow**.
3. La dirección es `https://TU-USUARIO.github.io/carta-palmeras-club/`. El panel está en `/admin` y también se llega con el candado del final de la página.

Los datos de Supabase y WhatsApp ya van dentro del workflow (son valores públicos). Si algún día cambian, se pueden pisar en **Settings → Secrets and variables → Actions → Variables** con los nombres `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WHATSAPP_NUMBER` y `VITE_INSTAGRAM_URL`.

## Opciones de las comidas (simple, doble, sin cebolla, extras)

Cada comida puede tener opciones para que el cliente arme su pedido. Se cargan desde el panel: **Comidas → Editar → Opciones para el cliente**.

- **Variantes:** tamaños o versiones con su precio (Simple, Doble, Triple…). Si hay variantes, el precio de la comida sale de ellas y en el catálogo aparece "Desde $X".
- **Ingredientes que se pueden sacar:** se cargan solos con los ingredientes que escribas en la **descripción** (separados por coma o "y"). Tocá los que **no** se pueden sacar para desmarcarlos, o sumá otros a mano. Sacar un ingrediente no cambia el precio.
- **Pregunta de las variantes:** el título que ve el cliente arriba de las variantes. Por defecto es "¿Cómo la querés?"; en la Napolitana dice "¿Para cuántas personas?".
- **Extras con costo:** cosas que se suman al precio (carne extra, huevo…). Vienen cargados con precio 0: el cliente ve "Precio a confirmar" y el local le confirma el valor por WhatsApp. Poné el precio real cuando lo quieran fijo, o borrá el extra para que no aparezca.

El cliente además puede escribir una aclaración (por ejemplo "bien cocida"). Todo llega en el mensaje de WhatsApp y se ve en el detalle de cada venta del panel.

**Si ya habías corrido `supabase/schema.sql` antes de esta versión**, volvé a correrlo completo en el SQL Editor. Se puede correr las veces que haga falta, y en una base que ya está andando:
- pasa las ventas "confirmadas" a **Cerrado** y las "canceladas" a **Cancelado**,
- une las tres napolitanas en una sola **Napolitana** con opción para 1, 2 o 3 personas (conserva sus precios y la foto),
- agrega la función para editar pedidos desde el panel,
- crea la tabla **horarios** (arranca con todos los días "todo el día") y hace que la base rechace pedidos fuera de horario,
- activa el **tiempo real** de la tabla `ventas`, para que el panel se entere solo de los pedidos nuevos.

## Actualización del 29/10/2026: cancha y stock de kiosco

En la base que ya está andando **no hace falta volver a correr todo `schema.sql`**: corré solo `supabase/actualizacion-2026-10-29-cancha-y-stock.sql` (SQL Editor → New query → pegar todo → Run). Agrega, sin tocar lo que ya hay:

- la tabla de **turnos de la cancha** y las funciones para cobrarlos (lo cobrado entra en la caja y en Finanzas como "Cancha"),
- el **stock** solo para las categorías de kiosco: marca solas Bebidas y Golosinas (crea Golosinas en la carta, que no se ve hasta tener productos),
- que cada venta descuente el stock de esas comidas (y lo devuelva si se cancela o se borra), y que la carta oculte las que llegan a 0.

Al final muestra las categorías con stock y la cantidad de turnos de cancha (0). Hay que correrlo **antes** de publicar el código nuevo: mientras no se corra, la sección Cancha dice que no pudo cargar los turnos.

## Usuarios empleados (sin Gastos ni Finanzas)

El panel tiene dos tipos de usuario. El empleado hace lo del turno; lo que toca precios, plata ya cobrada o los números del negocio es solo del dueño:

| El empleado **sí** puede | Solo el **dueño** |
|---|---|
| Tomar y avanzar pedidos, cancelar los que no se cobraron | Borrar una venta cobrada o anular un cobro (también de la cancha) |
| Vender en caja y cobrar (efectivo, transferencia, cuenta corriente) | Cambiar precios, productos, categorías, horarios y el menú del día |
| Abrir y cerrar la caja, cargar ingresos y retiros | Borrar un arqueo o un ingreso/retiro, cambiar el efectivo inicial |
| Reservar, señar y cobrar turnos de la cancha; anotar y liberar turnos fijos | Fijar el precio por hora de la cancha (el empleado cobra ese) y cerrar un turno "no vino" con la seña |
| Cargar la mercadería que entra y marcar si hay o no hay un producto | Ajustar el stock (corregir el conteo) |
| Crear cuentas corrientes y cobrarlas | Cambiar el límite de crédito o dar de baja una cuenta |
| | Gastos y costos, Finanzas y el registro de **Actividad** |

No es solo que no ve los botones: la base rechaza esas acciones aunque alguien las intente por otro lado. En la Caja el empleado ve los gastos que se pagaron con la plata de la caja (para que el arqueo cierre), pero no los demás.

**Registro de actividad** (pestaña *Actividad*, solo el dueño): quién hizo cada cosa y cuándo (pedidos, cobros, señas, anulaciones, caja, retiros, cambios de precios, mercadería, ajustes de stock, turnos), con filtro por usuario y para ver solo anulaciones, borrados y retiros. Nadie lo puede editar ni borrar. En la caja y en cada venta también se ve qué usuario cobró.

**Una sola vez:** corré `supabase/actualizacion-2026-10-29-empleados.sql` (SQL Editor → New query → pegar todo → Run). Los usuarios que ya entraban quedan como dueño, y la consulta del final lo muestra.

**Para cada empleado:**
1. **Authentication → Users → Add user → Create new user**: correo y contraseña, con **Auto Confirm User** tildado. El correo no tiene que existir de verdad (por ejemplo `caja1@laspalmeras.club`); es el usuario con el que entra.
2. En el SQL Editor, con sus correos:

   ```sql
   insert into public.admins (user_id, rol)
   select id, 'empleado' from auth.users
    where email in ('caja1@laspalmeras.club', 'caja2@laspalmeras.club')
   on conflict (user_id) do update set rol = excluded.rol;
   ```

Para **sacarle el acceso** a alguien: `delete from public.admins where user_id = (select id from auth.users where email = 'caja1@laspalmeras.club');` (o borrá el usuario en Authentication → Users). Para pasar un empleado a dueño, el mismo insert de arriba con `'dueno'`.

## Actualización del 29/10/2026 (3): permisos, actividad, stock y cancha

Corré `supabase/actualizacion-2026-10-29-permisos-stock-cancha.sql` (SQL Editor → New query → pegar todo → Run), **después** de las dos anteriores del 29/10. Agrega, sin borrar datos:

- los permisos del empleado y el **registro de actividad** (tabla de arriba),
- el **historial de stock**, la carga de mercadería y el aviso de stock bajo (cada producto tiene "avisar cuando queden…", por defecto 5),
- las **señas** y los **turnos fijos** de la cancha, y el precio por hora que fija el dueño.

Al final muestra 5 tablas con su cantidad de filas (todas en 0 la primera vez). **Después de correrlo, el dueño tiene que fijar el precio de la cancha** (pestaña Cancha → "Cambiar", arriba): mientras no lo haga, los empleados pueden poner cualquier precio.

## Si algo no anda

| Qué ves | Qué pasa | Cómo se arregla |
|---|---|---|
| "Uy, no pudimos cargar el menú" | Faltan o están mal las claves | Revisá `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` y reiniciá `npm run dev` |
| El catálogo carga pero está vacío | No se corrió el SQL, o falló a la mitad | Volvé a correr `supabase/schema.sql` completo |
| Entrás a `/admin` y dice "No tenés permisos" | Falta el Paso 5 | Corré el `insert into public.admins` con el correo correcto |
| "Correo o contraseña incorrectos" | Usuario o clave mal | Authentication → Users: restablecé la contraseña |
| Al subir una foto dice "No tenés permisos" | El usuario no es administrador | Paso 5 |
| Pedido enviado pero no aparece en Ventas | Mirá el filtro de fechas y de estado | Probá **Últimos 30 días** y estado **Todos** |

## Cosas que conviene saber

- **Los pedidos:** uno de la web llega como **Pendiente**. Desde el menú desplegable de cada pedido se pasa a **En preparación → Enviado → Entregado → Cerrado** (o **Cancelado**). **Cerrado** quiere decir entregado y cobrado: solo los cerrados cuentan en la facturación. Los que falta cerrar quedan arriba de todo en Ventas, de cualquier fecha, hasta que alguien los cierre. Cada pedido se puede ver, editar (cantidades, sumar o sacar productos, cliente y nota) o borrar.
- **Pedidos en vivo:** con el panel abierto, los pedidos se actualizan solos. Cuando entra uno nuevo suena un aviso, aparece un cartel con botón **Ver** y la pestaña **Ventas** muestra cuántos quedan sin cerrar (late en rojo si hay pendientes). El navegador solo deja sonar después de tocar algo en el panel: con el primer toque ya queda listo. El botón **🔔 Activar avisos** del encabezado permite que llegue una notificación aunque el panel esté en otra pestaña.
  Si los pedidos nuevos tardan hasta 30 segundos en aparecer, el tiempo real no está activo: en Supabase andá a **Database → Publications → supabase_realtime** y activá la tabla `ventas` (el SQL ya lo intenta hacer solo).
- **Horario de atención:** se carga en el panel, pestaña **Horarios**. Fuera de horario la carta muestra "Ahora estamos cerrados · Abrimos hoy a las 20:00 hs" y no deja mandar el pedido (la base también lo rechaza). Si cierran después de medianoche, poné por ejemplo 20:00 a 01:00. Misma hora en los dos campos = todo el día.
- **Stock:** solo lo llevan las categorías marcadas como **Kiosco** (Bebidas y Golosinas; se marca en Categorías). Se maneja en la pestaña **Stock** de cada turno: "Cargar mercadería" suma lo que entra (empleado o dueño) y "Ajustar" corrige con lo que se contó (solo el dueño). Cada venta lo descuenta sola y todo queda en el historial, con quién lo hizo. Arriba del panel aparece un aviso cuando algo llega al mínimo. Con stock 0 la comida deja de verse en la carta; en el local se puede vender igual (queda en negativo para que se vea la diferencia). Las comidas de cocina no llevan stock: si un día no hay algo, desactivala (interruptor **Activo**).
- **Cancha:** pestaña **Cancha** del panel. Se reservan turnos por hora (no deja pisar dos turnos) y se cobran como cualquier venta: efectivo, transferencia o cuenta corriente, con la caja abierta. Si dejan **seña** se registra con "Señar" (entra en la caja) y al cobrar se cobra solo lo que falta; si no vienen, el dueño lo cierra con "No vino" y queda la seña. Los **turnos fijos** ("Turnos fijos") se anotan solos cada semana; si un día no vienen, "Liberar día".
- **Fotos:** se suben desde el panel (Comidas → Editar). Se achican solas a 1200 px, se guardan en Cloudinary en WebP y en la carta se ven centradas en la comida.
- **Seguridad:** la clave que usa la página es pública a propósito. Lo que protege los datos son las reglas (RLS) del archivo SQL: cualquiera puede ver el menú y mandar un pedido, pero solo el administrador puede cambiar productos o ver las ventas.
- **Copias de seguridad:** el plan gratuito de Supabase pausa los proyectos sin uso durante una semana. Si pasa, entrá al panel de Supabase y tocá **Restore project**.
