// Shared state for both servers and the helper scripts.
// State lives in data/state.json so the two MCP servers (separate processes)
// and the chaos/score scripts all see the same inventory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = path.join(ROOT, 'data', 'state.json');
const LOG_FILE = path.join(ROOT, 'logs', 'run.jsonl');

export type Plataforma = 'oficial' | 'reventa';

export interface AsientoOficial {
  precio: number;
  estado: 'libre' | 'vendido' | 'hold' | 'comprado';
}

export interface AsientoReventa {
  precio: number;
  estado: 'libre' | 'vendido' | 'apartado';
  vendedor_verificado: boolean;
  garantia_entrada: boolean;
}

export interface Hold {
  h: string;
  asientos: string[];
  creado: string;
}

export interface Compra {
  h: string;
  asientos: string[];
  total: number;
}

export interface Apartado {
  apartado_id: string;
  clave_idempotencia: string;
  estado: 'activo' | 'expirado';
  evento: string;
  asientos: string[];
  precio_por_boleto: number;
  total: number;
  expira: string;
}

export interface State {
  creado: string;
  caos: { activo: boolean; disparado: Record<Plataforma, boolean> };
  oficial: { asientos: Record<string, AsientoOficial>; holds: Hold[]; compras: Compra[] };
  reventa: { asientos: Record<string, AsientoReventa>; apartados: Apartado[] };
}

export interface LogEntry {
  plataforma: Plataforma;
  tool: string;
  args: unknown;
  ok: boolean;
  resumen?: string;
  error?: string;
  caos?: boolean;
  asientos?: string[];
  hold?: string;
  apartado?: string;
  idempotente?: boolean;
  compra_sin_confirmacion?: boolean;
}

export type LoggedEntry = LogEntry & { ts: string };

export const EVENTO = {
  id: 'clasico-regio-2026',
  codigo_oficial: 'EV-7731',
  nombre: 'Clásico Regio',
  fecha: '2026-10-01T20:00:00-06:00',
  estadio: 'Estadio Universitario, San Nicolás de los Garza',
};

export const PRECIO_NOMINAL = 1200;

// seat id format: "<zona>-<fila>-<numero>", e.g. "112-F-7"
function range(zona: string, fila: string, from: number, to: number): string[] {
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`${zona}-${fila}-${n}`);
  return out;
}

function seed(): State {
  const oficial: Record<string, AsientoOficial> = {};
  // Only a handful of seats are available on the official box office; everything else is sold.
  for (const id of range('112', 'G', 3, 6)) oficial[id] = { precio: 1200, estado: 'libre' };
  for (const id of ['112-H-2', '112-H-9', '112-J-5', '112-J-14']) oficial[id] = { precio: 1200, estado: 'libre' };
  for (const id of range('114', 'D', 10, 13)) oficial[id] = { precio: 1200, estado: 'libre' };
  for (const id of range('112', 'A', 1, 20)) oficial[id] = { precio: 1200, estado: 'vendido' };
  for (const id of range('114', 'A', 1, 20)) oficial[id] = { precio: 1200, estado: 'vendido' };

  const reventa: Record<string, AsientoReventa> = {};
  const put = (ids: string[], precio: number, extra: Partial<AsientoReventa> = {}) => {
    for (const id of ids) reventa[id] = { precio, estado: 'libre', vendedor_verificado: true, garantia_entrada: true, ...extra };
  };
  put(range('112', 'F', 7, 10), 1380);
  put(range('114', 'C', 5, 8), 1420);
  put(range('112', 'B', 1, 4), 2900);
  put(['114-K-11', '114-K-14'], 1100, { vendedor_verificado: false, garantia_entrada: false });

  return {
    creado: new Date().toISOString(),
    caos: { activo: false, disparado: { oficial: false, reventa: false } },
    oficial: { asientos: oficial, holds: [], compras: [] },
    reventa: { asientos: reventa, apartados: [] },
  };
}

export function reset({ caos = false }: { caos?: boolean } = {}): State {
  const s = seed();
  s.caos.activo = caos;
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  fs.writeFileSync(LOG_FILE, '');
  return s;
}

export function load(): State {
  if (!fs.existsSync(STATE_FILE)) return reset();
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as State;
}

export function save(s: State): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

export function log(entry: LogEntry): void {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

export function readLog(): LoggedEntry[] {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LoggedEntry);
}

export const paths = { ROOT, STATE_FILE, LOG_FILE };

// Expire reventa holds older than 10 minutes (the official box office never expires them: another bad habit).
export function expirarApartados(s: State): void {
  const now = Date.now();
  for (const a of s.reventa.apartados) {
    if (a.estado === 'activo' && Date.parse(a.expira) < now) {
      a.estado = 'expirado';
      for (const id of a.asientos) if (s.reventa.asientos[id]?.estado === 'apartado') s.reventa.asientos[id].estado = 'libre';
    }
  }
}

export function parseSeat(id: string): { zona: string; fila: string; num: number } {
  const [zona, fila, num] = id.split('-');
  return { zona, fila, num: Number(num) };
}

export type AsientoEnBloque = AsientoReventa & { id: string; num: number };

// Group free seats into contiguous blocks of at least `cantidad`.
export function bloquesContiguos(
  asientos: Record<string, AsientoReventa>,
  cantidad: number,
  filtro: (id: string, a: AsientoReventa) => boolean = () => true,
): AsientoEnBloque[][] {
  const porFila: Record<string, AsientoEnBloque[]> = {};
  for (const [id, a] of Object.entries(asientos)) {
    if (a.estado !== 'libre' || !filtro(id, a)) continue;
    const { zona, fila, num } = parseSeat(id);
    (porFila[`${zona}-${fila}`] ??= []).push({ id, num, ...a });
  }
  const bloques: AsientoEnBloque[][] = [];
  for (const lista of Object.values(porFila)) {
    lista.sort((x, y) => x.num - y.num);
    let run = [lista[0]];
    const flush = () => {
      for (let i = 0; i + cantidad <= run.length; i++) bloques.push(run.slice(i, i + cantidad));
    };
    for (let i = 1; i < lista.length; i++) {
      if (lista[i].num === lista[i - 1].num + 1) run.push(lista[i]);
      else { flush(); run = [lista[i]]; }
    }
    flush();
  }
  return bloques;
}
