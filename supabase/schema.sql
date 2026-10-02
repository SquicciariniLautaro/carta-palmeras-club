-- =====================================================================
-- Las Palmeras Club · Esquema completo de Supabase
-- Pegá este archivo entero en Supabase → SQL Editor → New query → Run.
-- Se puede volver a correr: usa "if not exists" / "create or replace"
-- y borra las políticas antes de crearlas de nuevo.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------

create table if not exists public.categorias (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null unique check (length(btrim(nombre)) between 1 and 60),
  orden  int  not null default 0
);

create table if not exists public.comidas (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null check (length(btrim(nombre)) between 1 and 120),
  descripcion  text check (descripcion is null or length(descripcion) <= 1000),
  precio       numeric(12,2) not null check (precio > 0),
  precio_promo numeric(12,2) check (precio_promo is null or (precio_promo > 0 and precio_promo < precio)),
  -- "restrict": no se puede borrar una categoría que todavía tiene comidas
  categoria_id uuid not null references public.categorias (id) on delete restrict,
  imagen_url   text,
  imagen_path  text,          -- ruta dentro del bucket "comidas", para poder borrarla
  destacado    boolean not null default false,
  activo       boolean not null default true,
  stock        int not null default 0 check (stock >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists comidas_categoria_idx on public.comidas (categoria_id);

create table if not exists public.ventas (
  id             uuid primary key default gen_random_uuid(),
  numero         bigint generated always as identity unique,  -- número de pedido legible
  created_at     timestamptz not null default now(),
  estado         text not null default 'pendiente' check (estado in ('pendiente', 'confirmada', 'cancelada')),
  total          numeric(12,2) not null default 0 check (total >= 0),
  cliente_nombre text check (cliente_nombre is null or length(cliente_nombre) <= 80),
  nota           text check (nota is null or length(nota) <= 300),
  origen         text not null default 'web' check (origen in ('web', 'manual'))
);

create index if not exists ventas_created_at_idx on public.ventas (created_at desc);
create index if not exists ventas_estado_idx on public.ventas (estado);

create table if not exists public.venta_items (
  id              uuid primary key default gen_random_uuid(),
  venta_id        uuid not null references public.ventas (id) on delete cascade,
  comida_id       uuid references public.comidas (id) on delete set null,
  nombre          text not null,              -- copia del nombre al momento de la venta
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  cantidad        int not null check (cantidad > 0),
  subtotal        numeric(12,2) not null check (subtotal >= 0)
);

create index if not exists venta_items_venta_idx on public.venta_items (venta_id);
create index if not exists venta_items_comida_idx on public.venta_items (comida_id);

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- ---------------------------------------------------------------------
-- 2. Trigger de updated_at
-- ---------------------------------------------------------------------

create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists comidas_updated_at on public.comidas;
create trigger comidas_updated_at
  before update on public.comidas
  for each row execute function public.tocar_updated_at();

-- ---------------------------------------------------------------------
-- 3. es_admin()
-- security definer: lee "admins" sin pasar por RLS (evita recursión).
-- ---------------------------------------------------------------------

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- 4. Funciones internas (no se pueden llamar desde el cliente)
-- ---------------------------------------------------------------------

-- Crea una venta con sus ítems tomando los precios de la base.
-- p_items: [{ "comida_id": "<uuid>", "cantidad": 2 }, ...]
create or replace function public._crear_venta(
  p_items jsonb,
  p_cliente_nombre text,
  p_nota text,
  p_origen text,
  p_solo_activas boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venta_id uuid;
  v_total    numeric(12,2) := 0;
  v_unidades int := 0;
  v_cliente  text := nullif(btrim(coalesce(p_cliente_nombre, '')), '');
  v_nota     text := nullif(btrim(coalesce(p_nota, '')), '');
  r          record;
  c          public.comidas%rowtype;
  v_precio   numeric(12,2);
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido está vacío.';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'El pedido tiene demasiados productos (máximo 30 distintos).';
  end if;
  if v_cliente is not null and length(v_cliente) > 80 then
    raise exception 'El nombre es demasiado largo (máximo 80 caracteres).';
  end if;
  if v_nota is not null and length(v_nota) > 300 then
    raise exception 'La nota es demasiado larga (máximo 300 caracteres).';
  end if;

  insert into public.ventas (estado, total, cliente_nombre, nota, origen)
  values ('pendiente', 0, v_cliente, v_nota, p_origen)
  returning id into v_venta_id;

  begin
    for r in
      select x.comida_id, sum(x.cantidad)::int as cantidad
      from jsonb_to_recordset(p_items) as x (comida_id uuid, cantidad int)
      group by x.comida_id
    loop
      if r.comida_id is null or r.cantidad is null or r.cantidad <= 0 then
        raise exception 'Hay un producto con datos inválidos en el pedido.';
      end if;
      if r.cantidad > 50 then
        raise exception 'Se pueden pedir hasta 50 unidades de cada producto.';
      end if;

      select * into c from public.comidas where id = r.comida_id;
      if not found or (p_solo_activas and not c.activo) then
        raise exception 'Un producto del pedido ya no está disponible. Actualizá la página e intentá de nuevo.';
      end if;
      if c.stock < r.cantidad then
        if c.stock = 0 then
          raise exception '"%" está agotado.', c.nombre;
        end if;
        raise exception 'No hay stock suficiente de "%": quedan %.', c.nombre, c.stock;
      end if;

      v_precio   := coalesce(c.precio_promo, c.precio);   -- el precio sale de la base, nunca del cliente
      v_unidades := v_unidades + r.cantidad;
      v_total    := v_total + v_precio * r.cantidad;

      insert into public.venta_items (venta_id, comida_id, nombre, precio_unitario, cantidad, subtotal)
      values (v_venta_id, c.id, c.nombre, v_precio, r.cantidad, v_precio * r.cantidad);
    end loop;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'El formato del pedido no es válido.';
  end;

  if v_unidades > 100 then
    raise exception 'El pedido supera el máximo de 100 unidades.';
  end if;

  update public.ventas set total = v_total where id = v_venta_id;
  return v_venta_id;
end;
$$;

-- Descuenta el stock de todos los ítems de una venta. Falla (y deshace
-- todo) si algún producto no alcanza.
create or replace function public._descontar_stock(p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_stock int;
begin
  for r in
    select vi.comida_id, sum(vi.cantidad)::int as cantidad, max(vi.nombre) as nombre
    from public.venta_items vi
    where vi.venta_id = p_venta_id and vi.comida_id is not null
    group by vi.comida_id
    order by vi.comida_id            -- orden fijo para evitar bloqueos cruzados
  loop
    update public.comidas
       set stock = stock - r.cantidad
     where id = r.comida_id and stock >= r.cantidad;

    if not found then
      select stock into v_stock from public.comidas where id = r.comida_id;
      raise exception 'No hay stock suficiente de "%": quedan % y la venta lleva %.',
        r.nombre, coalesce(v_stock, 0), r.cantidad;
    end if;
  end loop;
end;
$$;

-- Devuelve al stock lo que se había descontado (al cancelar una confirmada).
create or replace function public._devolver_stock(p_venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.comidas c
     set stock = c.stock + t.cantidad
    from (
      select vi.comida_id, sum(vi.cantidad)::int as cantidad
      from public.venta_items vi
      where vi.venta_id = p_venta_id and vi.comida_id is not null
      group by vi.comida_id
    ) t
   where c.id = t.comida_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Funciones RPC (las que llama el frontend)
-- ---------------------------------------------------------------------

-- La llama el catálogo (anónimo) justo antes de abrir WhatsApp.
-- Devuelve { numero, total, items: [{ nombre, cantidad, precio_unitario, subtotal }] }
create or replace function public.crear_pedido(
  items jsonb,
  cliente_nombre text default null,
  nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Freno simple contra abuso: como mucho 20 pedidos web por minuto en total.
  if (select count(*) from public.ventas
       where origen = 'web' and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Estamos recibiendo muchos pedidos en este momento. Probá de nuevo en un minuto.';
  end if;

  v_id := public._crear_venta(crear_pedido.items, crear_pedido.cliente_nombre, crear_pedido.nota, 'web', true);

  return (
    select jsonb_build_object(
      'numero', v.numero,
      'total',  v.total,
      'items',  coalesce((
        select jsonb_agg(jsonb_build_object(
                 'nombre', vi.nombre,
                 'cantidad', vi.cantidad,
                 'precio_unitario', vi.precio_unitario,
                 'subtotal', vi.subtotal) order by vi.nombre)
        from public.venta_items vi where vi.venta_id = v.id), '[]'::jsonb)
    )
    from public.ventas v where v.id = v_id
  );
end;
$$;

-- Solo admin: pasa un pedido pendiente a confirmado y descuenta stock.
create or replace function public.confirmar_venta(venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;

  select v.estado into v_estado from public.ventas v where v.id = confirmar_venta.venta_id for update;
  if not found then
    raise exception 'La venta no existe.';
  end if;
  if v_estado <> 'pendiente' then
    raise exception 'Solo se pueden confirmar pedidos pendientes (este está %).', v_estado;
  end if;

  perform public._descontar_stock(confirmar_venta.venta_id);
  update public.ventas v set estado = 'confirmada' where v.id = confirmar_venta.venta_id;
end;
$$;

-- Solo admin: cancela. Si estaba confirmada, devuelve el stock.
create or replace function public.cancelar_venta(venta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;

  select v.estado into v_estado from public.ventas v where v.id = cancelar_venta.venta_id for update;
  if not found then
    raise exception 'La venta no existe.';
  end if;
  if v_estado = 'cancelada' then
    raise exception 'La venta ya estaba cancelada.';
  end if;

  if v_estado = 'confirmada' then
    perform public._devolver_stock(cancelar_venta.venta_id);
  end if;
  update public.ventas v set estado = 'cancelada' where v.id = cancelar_venta.venta_id;
end;
$$;

-- Solo admin: venta en el local. Queda confirmada y descuenta stock.
-- Permite vender comidas inactivas (ocultas en el catálogo).
create or replace function public.registrar_venta_manual(
  items jsonb,
  cliente_nombre text default null,
  nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.es_admin() then
    raise exception 'No tenés permisos para hacer esto.';
  end if;

  v_id := public._crear_venta(registrar_venta_manual.items, registrar_venta_manual.cliente_nombre,
                              registrar_venta_manual.nota, 'manual', false);
  perform public._descontar_stock(v_id);
  update public.ventas v set estado = 'confirmada' where v.id = v_id;

  return (select jsonb_build_object('numero', v.numero, 'total', v.total)
          from public.ventas v where v.id = v_id);
end;
$$;

-- Permisos de ejecución: por defecto Postgres deja ejecutar a todos.
revoke execute on function public._crear_venta(jsonb, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public._descontar_stock(uuid) from public, anon, authenticated;
revoke execute on function public._devolver_stock(uuid) from public, anon, authenticated;
revoke execute on function public.confirmar_venta(uuid) from public, anon;
revoke execute on function public.cancelar_venta(uuid) from public, anon;
revoke execute on function public.registrar_venta_manual(jsonb, text, text) from public, anon;

grant execute on function public.es_admin() to anon, authenticated;   -- lo usan las políticas RLS
grant execute on function public.crear_pedido(jsonb, text, text) to anon, authenticated;
grant execute on function public.confirmar_venta(uuid) to authenticated;
grant execute on function public.cancelar_venta(uuid) to authenticated;
grant execute on function public.registrar_venta_manual(jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Seguridad a nivel de fila (RLS)
-- ---------------------------------------------------------------------

alter table public.categorias  enable row level security;
alter table public.comidas     enable row level security;
alter table public.ventas      enable row level security;
alter table public.venta_items enable row level security;
alter table public.admins      enable row level security;

-- Defensa extra: el rol anónimo no toca ventas ni admins de forma directa.
revoke all on public.ventas, public.venta_items, public.admins from anon;
revoke insert, update, delete on public.admins from authenticated;

-- categorias: lectura pública, escritura solo admin
drop policy if exists "categorias_lectura_publica" on public.categorias;
create policy "categorias_lectura_publica" on public.categorias
  for select to anon, authenticated using (true);

drop policy if exists "categorias_admin_inserta" on public.categorias;
create policy "categorias_admin_inserta" on public.categorias
  for insert to authenticated with check (public.es_admin());

drop policy if exists "categorias_admin_edita" on public.categorias;
create policy "categorias_admin_edita" on public.categorias
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "categorias_admin_borra" on public.categorias;
create policy "categorias_admin_borra" on public.categorias
  for delete to authenticated using (public.es_admin());

-- comidas: el público ve solo las activas; el admin ve y edita todo
drop policy if exists "comidas_lectura" on public.comidas;
create policy "comidas_lectura" on public.comidas
  for select to anon, authenticated using (activo or public.es_admin());

drop policy if exists "comidas_admin_inserta" on public.comidas;
create policy "comidas_admin_inserta" on public.comidas
  for insert to authenticated with check (public.es_admin());

drop policy if exists "comidas_admin_edita" on public.comidas;
create policy "comidas_admin_edita" on public.comidas
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "comidas_admin_borra" on public.comidas;
create policy "comidas_admin_borra" on public.comidas
  for delete to authenticated using (public.es_admin());

-- ventas y venta_items: solo admin (el público entra únicamente por crear_pedido)
drop policy if exists "ventas_admin" on public.ventas;
create policy "ventas_admin" on public.ventas
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "venta_items_admin" on public.venta_items;
create policy "venta_items_admin" on public.venta_items
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- admins: cada usuario puede ver solamente su propio registro
drop policy if exists "admins_ver_propio" on public.admins;
create policy "admins_ver_propio" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 7. Storage: bucket público "comidas"
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comidas', 'comidas', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Al ser público, las imágenes se ven por su URL pública sin política de
-- lectura. Listar, subir, reemplazar y borrar: solo admin.
drop policy if exists "comidas_storage_admin_lista" on storage.objects;
create policy "comidas_storage_admin_lista" on storage.objects
  for select to authenticated using (bucket_id = 'comidas' and public.es_admin());

drop policy if exists "comidas_storage_admin_sube" on storage.objects;
create policy "comidas_storage_admin_sube" on storage.objects
  for insert to authenticated with check (bucket_id = 'comidas' and public.es_admin());

drop policy if exists "comidas_storage_admin_reemplaza" on storage.objects;
create policy "comidas_storage_admin_reemplaza" on storage.objects
  for update to authenticated
  using (bucket_id = 'comidas' and public.es_admin())
  with check (bucket_id = 'comidas' and public.es_admin());

drop policy if exists "comidas_storage_admin_borra" on storage.objects;
create policy "comidas_storage_admin_borra" on storage.objects
  for delete to authenticated using (bucket_id = 'comidas' and public.es_admin());

-- ---------------------------------------------------------------------
-- 8. Datos iniciales: el menú impreso de Las Palmeras Club
-- Solo inserta lo que falta (no pisa cambios hechos desde el panel).
-- El stock arranca en 20 unidades: ajustalo desde el panel antes de abrir.
-- ---------------------------------------------------------------------

insert into public.categorias (nombre, orden) values
  ('Burguers', 1),
  ('Combos', 2),
  ('Pizzas', 3),
  ('Sandwiches', 4),
  ('Napolitanas', 5),
  ('Papas', 6),
  ('Bebidas', 7)
on conflict (nombre) do nothing;

insert into public.comidas (nombre, descripcion, precio, destacado, stock, categoria_id)
select m.nombre, m.descripcion, m.precio, m.destacado, 20, c.id
from (values
  ('Burguers', 'Burguer Cheese doble', '2 medallones de carne y cheddar.', 11000, false),
  ('Burguers', 'Burguer Cheese simple', '1 medallón de carne y cheddar.', 7500, false),
  ('Burguers', 'Burguer Big Mac doble', '2 medallones de carne, salsa Big Mac, cheddar, pepinillos, lechuga y cebolla.', 11000, false),
  ('Burguers', 'Burguer Big Mac simple', '1 medallón de carne, salsa Big Mac, cheddar, pepinillos, lechuga y cebolla.', 8500, false),
  ('Burguers', 'Burguer Big Bang doble', '2 medallones de carne, salsa de la casa, cheddar, cebolla y bacon.', 11000, false),
  ('Burguers', 'Burguer Big Bang simple', '1 medallón de carne, salsa de la casa, cheddar, cebolla y bacon.', 8500, false),
  ('Burguers', 'Burguer Texas doble', '2 medallones de carne, cheddar, bacon, barbacoa y aros de cebolla.', 11000, false),
  ('Burguers', 'Burguer Texas simple', '1 medallón de carne, cheddar, bacon, barbacoa y aros de cebolla.', 8500, false),
  ('Burguers', 'Burguer Milwaukee doble', '2 medallones de carne, cheddar, bacon, cebolla crispy, lechuga, tomate y mayonesa.', 11000, false),
  ('Burguers', 'Burguer Milwaukee simple', '1 medallón de carne, cheddar, bacon, cebolla crispy, lechuga, tomate y mayonesa.', 8500, false),
  ('Burguers', 'Burguer Cuarto de Libra doble', '2 medallones de carne, cheddar, extra bacon y cebolla en cubos.', 11000, false),
  ('Burguers', 'Burguer Cuarto de Libra simple', '1 medallón de carne, cheddar, extra bacon y cebolla en cubos.', 8500, false),
  ('Burguers', 'Burguer Americana doble', '2 medallones de carne, cheddar, extra bacon, pepinillos, cebolla morada, ketchup y alioli.', 11000, false),
  ('Burguers', 'Burguer Americana simple', '1 medallón de carne, cheddar, extra bacon, pepinillos, cebolla morada, ketchup y alioli.', 8500, false),
  ('Burguers', 'Burguer Alabama doble', '2 medallones de carne, cheddar, pepinillos, cebolla crispy, lechuga, tomate y mayonesa.', 11000, false),
  ('Burguers', 'Burguer Alabama simple', '1 medallón de carne, cheddar, pepinillos, cebolla crispy, lechuga, tomate y mayonesa.', 8500, false),
  ('Burguers', 'Burguer CBH doble', '2 medallones de carne, cheddar, extra bacon, manteca y miel.', 11000, false),
  ('Burguers', 'Burguer CBH simple', '1 medallón de carne, cheddar, extra bacon, manteca y miel.', 8500, false),
  ('Combos', 'Promo Cheese Simples', '3 burguers cheese simples con papas.', 17000, true),
  ('Combos', 'Promo Burritos Burguer', '2 burritos a elección (Texas o Milwaukee) con papas.', 16000, true),
  ('Pizzas', 'Pizza muzzarella clásica', null, 9000, false),
  ('Pizzas', 'Pizza muzzarella especial', null, 9000, false),
  ('Pizzas', 'Pizza napolitana', null, 9000, false),
  ('Pizzas', 'Pizza de huevo', null, 9000, false),
  ('Pizzas', 'Pizza de choclo', null, 9000, false),
  ('Pizzas', 'Pizza provenzal', null, 9000, false),
  ('Pizzas', 'Pizza americana', null, 10000, false),
  ('Pizzas', 'Pizza fugazzeta', null, 9000, false),
  ('Sandwiches', 'Sándwich de lomito especial', null, 9500, false),
  ('Sandwiches', 'Sándwich de lomito criollo', null, 9500, false),
  ('Sandwiches', 'Sándwich de lomito americano', null, 9500, false),
  ('Sandwiches', 'Sándwich de milanesa especial', null, 9500, false),
  ('Sandwiches', 'Sándwich de milanesa criolla', null, 9500, false),
  ('Sandwiches', 'Sándwich de milanesa de la casa', null, 9500, false),
  ('Napolitanas', 'Napolitana para una persona', null, 10000, false),
  ('Napolitanas', 'Napolitana para dos personas', null, 19000, false),
  ('Napolitanas', 'Napolitana para tres personas', null, 28000, false),
  ('Papas', 'Papas con salchicha', null, 8500, false),
  ('Papas', 'Papas tradicionales a caballo', null, 9000, false),
  ('Papas', 'Papas americanas', null, 10000, false),
  ('Papas', 'Papas con huevo revuelto', null, 8500, false),
  ('Papas', 'Papas simples', null, 8000, false),
  ('Bebidas', 'Coca-Cola 500 ml', null, 3000, false),
  ('Bebidas', 'Aquarius 1,5 L', null, 3500, false),
  ('Bebidas', 'Coca-Cola 1,5 L', null, 4500, false),
  ('Bebidas', 'Agua mineral 500 ml', null, 2000, false)
) as m (categoria, nombre, descripcion, precio, destacado)
join public.categorias c on c.nombre = m.categoria
where not exists (select 1 from public.comidas x where x.nombre = m.nombre);

-- ---------------------------------------------------------------------
-- 9. Dar permisos de administrador al dueño
-- Primero creá el usuario en Authentication → Users → Add user, y después
-- descomentá y corré esta línea con su correo:
-- ---------------------------------------------------------------------

-- insert into public.admins (user_id)
-- select id from auth.users where email = 'dueño@ejemplo.com';
