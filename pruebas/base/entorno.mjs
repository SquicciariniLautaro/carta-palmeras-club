// Postgres de mentira (PGlite) con lo mínimo de Supabase para correr el SQL
// real del proyecto: roles anon/authenticated, auth.uid(), auth.jwt() y storage.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SUPABASE = fileURLToPath(new URL("../../supabase/", import.meta.url));

// PGlite no trae pgcrypto, pero gen_random_uuid() ya viene en Postgres
export const leerSql = (archivo) =>
  readFileSync(SUPABASE + archivo, "utf8").replace("create extension if not exists pgcrypto;", "");

export const actualizaciones = () =>
  readdirSync(SUPABASE)
    .filter((f) => /^actualizacion-.*\.sql$/.test(f))
    .sort();

export const DUENO = { id: "11111111-1111-1111-1111-111111111111", email: "dueno@laspalmeras.club" };
export const EMPLEADO = { id: "22222222-2222-2222-2222-222222222222", email: "caja1@laspalmeras.club" };

export async function crearBase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select jsonb_build_object('email', nullif(current_setting('prueba.email', true), '')) $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text);
    grant usage on schema public, auth to anon, authenticated;
    -- Como en Supabase: todo se puede usar y lo que protege son RLS y los revoke del SQL
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
  `);
  return db;
}

// Herramientas para escribir las pruebas
export function herramientas(db) {
  let fallas = 0;
  let total = 0;
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const uno = async (sql, params) => (await q(sql, params))[0];

  async function prueba(nombre, fn) {
    total++;
    try {
      await fn();
      console.log("  ok   ", nombre);
    } catch (e) {
      fallas++;
      console.log("  FALLA", nombre, "→", e.message);
    }
  }

  // La prueba pasa si fn tira un error que contiene "texto"
  async function rechaza(nombre, fn, texto) {
    total++;
    try {
      await fn();
      fallas++;
      console.log("  FALLA", nombre, "→ no dio error");
    } catch (e) {
      if (texto && !e.message.includes(texto)) {
        fallas++;
        console.log("  FALLA", nombre, "→ dio otro error:", e.message);
      } else console.log("  ok   ", nombre);
    }
  }

  function igual(valor, esperado, que = "valor") {
    const norm = (x) => (typeof x === "string" && /^-?\d+\.\d+$/.test(x) ? String(Number(x)) : String(x));
    if (norm(valor) !== norm(esperado)) throw new Error(`${que}: esperaba ${esperado} y dio ${valor}`);
  }

  // Corre fn como un usuario del panel (las reglas RLS y los triggers se aplican)
  async function como(usuario, fn) {
    await db.exec(`set prueba.uid = '${usuario.id}'; set prueba.email = '${usuario.email}'; set role authenticated;`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role; reset prueba.uid; reset prueba.email;");
    }
  }

  // Corre fn como la carta online (sin sesión)
  async function anonimo(fn) {
    await db.exec("set role anon;");
    try {
      return await fn();
    } finally {
      await db.exec("reset role;");
    }
  }

  return { q, uno, prueba, rechaza, igual, como, anonimo, resultado: () => ({ fallas, total }) };
}
