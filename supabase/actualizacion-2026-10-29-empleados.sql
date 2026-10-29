-- =====================================================================
-- Las Palmeras Club · Actualización del 29/10/2026 (2)
-- Usuarios empleados: entran a Venta noche, Venta mediodía, Cancha, Caja
-- y Cuentas corrientes. Gastos y costos y Finanzas quedan solo para el dueño.
--
-- Para una base que YA está andando: pegá este archivo entero en
-- Supabase → SQL Editor → New query → Run. Los usuarios que ya entraban
-- al panel quedan como dueño. Se puede volver a correr sin romper nada.
-- (En una base nueva alcanza con schema.sql, que ya trae todo esto.)
-- =====================================================================

begin;

-- 1. Rol de cada usuario del panel -----------------------------------
alter table public.admins add column if not exists rol text not null default 'dueno';
alter table public.admins drop constraint if exists admins_rol_check;
alter table public.admins add constraint admins_rol_check check (rol in ('dueno', 'empleado'));

-- Solo el dueño ve los gastos y las finanzas
create or replace function public.es_dueno()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and rol = 'dueno');
$$;

-- Rol de quien entra al panel: 'dueno', 'empleado' o null (sin acceso)
create or replace function public.mi_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.admins where user_id = auth.uid();
$$;

revoke execute on function public.es_dueno() from public, anon;
revoke execute on function public.mi_rol() from public, anon;
grant execute on function public.es_dueno() to authenticated;
grant execute on function public.mi_rol() to authenticated;

-- 2. Gastos: solo el dueño ----------------------------------------------
-- El empleado ve únicamente los que se pagaron con la plata de la caja
-- (aparecen en el arqueo), pero no los carga, no los cambia ni ve los demás.
drop policy if exists "gastos_admin" on public.gastos;
drop policy if exists "gastos_dueno" on public.gastos;
create policy "gastos_dueno" on public.gastos
  for all to authenticated using (public.es_dueno()) with check (public.es_dueno());

drop policy if exists "gastos_empleado_ve_caja" on public.gastos;
create policy "gastos_empleado_ve_caja" on public.gastos
  for select to authenticated using (caja_id is not null and public.es_admin());

commit;

-- Comprobación: tiene que listar a los usuarios que ya entraban, como dueño
select u.email, a.rol
  from public.admins a join auth.users u on u.id = a.user_id
 order by a.rol, u.email;


-- =====================================================================
-- 3. Dar de alta a los empleados (después de correr lo de arriba)
--
-- a) Authentication → Users → Add user → Create new user: correo y
--    contraseña de cada empleado, con "Auto Confirm User" tildado.
--    El correo no tiene que existir de verdad (ej. caja1@laspalmeras.club).
-- b) En una consulta nueva pegá las 4 líneas de abajo SIN los "-- " del
--    principio, cambiá los dos correos por los que usaste y tocá Run.
--    Después corré la comprobación de arriba: tienen que salir como
--    "empleado".
-- =====================================================================

-- insert into public.admins (user_id, rol)
-- select id, 'empleado' from auth.users
--  where email in ('caja1@laspalmeras.club', 'caja2@laspalmeras.club')
-- on conflict (user_id) do update set rol = excluded.rol;
