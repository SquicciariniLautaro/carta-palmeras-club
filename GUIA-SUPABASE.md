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

Esto crea las tablas, las funciones, la seguridad, el espacio para las fotos y carga las 7 categorías y los 46 productos del menú impreso (con stock 20 cada uno).

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

3. El archivo `.env` **no se sube a GitHub** (ya está ignorado). Guardalo.

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
- [ ] En **Ventas** aparece el pedido que acabás de enviar como **Pendiente**.

Después de hacer cambios en el `.env`, cortá el servidor (Ctrl + C) y volvé a correr `npm run dev`.

## Paso 9. Publicar en Vercel

1. En [vercel.com](https://vercel.com) tocá **Add New → Project** e importá el repositorio `carta-palmeras-club`.
2. Vercel detecta Vite solo. Antes de desplegar, abrí **Environment Variables** y cargá las **mismas cuatro variables** del `.env`.
3. Tocá **Deploy**.
4. Cuando termine, probá de nuevo la lista de arriba, pero en la dirección que te da Vercel.

Si más adelante cambiás una variable, hay que hacer **Redeploy** en Vercel para que se aplique.

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

- **El stock:** un pedido de la web queda **pendiente** y no descuenta stock. Se descuenta cuando el dueño toca **Confirmar** en el panel. Si cancela una venta confirmada, el stock vuelve.
- **Fotos:** se suben desde el panel (Comidas → Editar). Se achican solas a 1200 px.
- **Seguridad:** la clave que usa la página es pública a propósito. Lo que protege los datos son las reglas (RLS) del archivo SQL: cualquiera puede ver el menú y mandar un pedido, pero solo el administrador puede cambiar productos o ver las ventas.
- **Copias de seguridad:** el plan gratuito de Supabase pausa los proyectos sin uso durante una semana. Si pasa, entrá al panel de Supabase y tocá **Restore project**.
