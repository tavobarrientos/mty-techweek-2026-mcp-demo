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
  evento: string; // codigo_oficial
  asientos: string[];
  creado: string;
}

export interface Compra {
  h: string;
  evento: string; // codigo_oficial
  asientos: string[];
  total: number;
}

export interface Apartado {
  apartado_id: string;
  clave_idempotencia: string;
  estado: 'activo' | 'expirado';
  evento_id: string;
  evento: string;
  asientos: string[];
  precio_por_boleto: number;
  total: number;
  expira: string;
}

export interface State {
  creado: string;
  caos: { activo: boolean; disparado: Record<Plataforma, boolean> };
  // oficial is keyed by codigo_oficial ("EV-7731"), reventa by evento id ("clasico-regio-2026").
  oficial: { eventos: Record<string, { asientos: Record<string, AsientoOficial> }>; holds: Hold[]; compras: Compra[] };
  reventa: { eventos: Record<string, { asientos: Record<string, AsientoReventa> }>; apartados: Apartado[] };
}

export interface LogEntry {
  plataforma: Plataforma;
  tool: string;
  args: unknown;
  ok: boolean;
  evento?: string;
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

export interface Evento {
  id: string;
  codigo_oficial: string;
  nombre: string;
  fecha: string;
  estadio: string;
  jornada?: number;
  equipos?: string[]; // extra search terms for buscar_eventos
  precio_nominal: number;
}

// The matches after the Clásico are real Liga MX Apertura 2026 home games in Monterrey.
// The platforms, seats, availability and prices are all fictional.
// The Clásico (first entry) is what the live demo, the slides and the smoke test rely on: do not change it.
export const EVENTOS: Evento[] = [
  {
    id: 'clasico-regio-2026',
    codigo_oficial: 'EV-7731',
    nombre: 'Clásico Regio',
    fecha: '2026-10-01T20:00:00-06:00',
    estadio: 'Estadio Universitario, San Nicolás de los Garza',
    precio_nominal: 1200,
  },
  {
    id: 'tigres-toluca-2026-10-09',
    codigo_oficial: 'EV-7732',
    nombre: 'Tigres vs Toluca',
    jornada: 11,
    fecha: '2026-10-09T21:00:00-06:00',
    estadio: 'Estadio Universitario, San Nicolás de los Garza',
    equipos: ['Tigres UANL', 'Toluca', 'Diablos Rojos'],
    precio_nominal: 950,
  },
  {
    id: 'rayados-pachuca-2026-10-18',
    codigo_oficial: 'EV-7733',
    nombre: 'Rayados vs Pachuca',
    jornada: 12,
    fecha: '2026-10-18T19:00:00-06:00',
    estadio: 'Estadio BBVA, Guadalupe',
    equipos: ['Rayados de Monterrey', 'Pachuca', 'Tuzos'],
    precio_nominal: 850,
  },
  {
    id: 'tigres-leon-2026-10-20',
    codigo_oficial: 'EV-7734',
    nombre: 'Tigres vs León',
    jornada: 13,
    fecha: '2026-10-20T21:00:00-06:00',
    estadio: 'Estadio Universitario, San Nicolás de los Garza',
    equipos: ['Tigres UANL', 'León', 'La Fiera'],
    precio_nominal: 1000,
  },
  {
    id: 'rayados-chivas-2026-10-24',
    codigo_oficial: 'EV-7735',
    nombre: 'Rayados vs Chivas',
    jornada: 14,
    fecha: '2026-10-24T19:00:00-06:00',
    estadio: 'Estadio BBVA, Guadalupe',
    equipos: ['Rayados de Monterrey', 'Chivas', 'Guadalajara'],
    precio_nominal: 1400,
  },
  {
    id: 'rayados-tijuana-2026-10-31',
    codigo_oficial: 'EV-7736',
    nombre: 'Rayados vs Tijuana',
    jornada: 15,
    fecha: '2026-10-31T20:00:00-06:00',
    estadio: 'Estadio BBVA, Guadalupe',
    equipos: ['Rayados de Monterrey', 'Tijuana', 'Xolos'],
    precio_nominal: 900,
  },
];

export const eventoPorId = (id: string): Evento | undefined => EVENTOS.find((e) => e.id === id);
export const eventoPorCodigo = (codigo: string): Evento | undefined => EVENTOS.find((e) => e.codigo_oficial === codigo);

// seat id format: "<zona>-<fila>-<numero>", e.g. "112-F-7". Zones 1xx are the lower bowl, 2xx the upper one.
function range(zona: string, fila: string, from: number, to: number): string[] {
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`${zona}-${fila}-${n}`);
  return out;
}

const SIN_VERIFICAR: Partial<AsientoReventa> = { vendedor_verificado: false, garantia_entrada: false };

type Asientos = { oficial: Record<string, AsientoOficial>; reventa: Record<string, AsientoReventa> };

function seedClasico(): Asientos {
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
  put(['114-K-11', '114-K-14'], 1100, SIN_VERIFICAR);

  return { oficial, reventa };
}

// Deterministic inventory for the other matches. Reventa seat ids are unique across events,
// so a seat sent with the wrong evento_id can always be traced back to its real event.
interface Inventario {
  oficial: { precio: number; libres: string[]; vendidos: string[] };
  reventa: [ids: string[], precio: number, extra?: Partial<AsientoReventa>][];
}

const INVENTARIOS: Record<string, Inventario> = {
  // Normal: a couple of blocks on each platform, reventa a bit above face value.
  'tigres-toluca-2026-10-09': {
    oficial: {
      precio: 950,
      libres: [...range('111', 'C', 4, 7), ...range('113', 'F', 8, 10), '111-D-15', '113-H-2'],
      vendidos: [...range('111', 'A', 1, 20), ...range('113', 'A', 1, 20)],
    },
    reventa: [
      [range('111', 'E', 3, 6), 1150],
      [range('113', 'G', 10, 13), 1250],
      [range('115', 'B', 1, 2), 1900],
      [['215-M-20', '215-M-22'], 700, SIN_VERIFICAR],
    ],
  },
  // Plenty of availability on both platforms.
  'rayados-pachuca-2026-10-18': {
    oficial: {
      precio: 850,
      libres: [...['A', 'B', 'C', 'D'].flatMap((f) => range('105', f, 1, 12)), ...range('106', 'B', 1, 10), ...range('205', 'F', 1, 20)],
      vendidos: range('106', 'A', 1, 10),
    },
    reventa: [
      [range('105', 'E', 1, 4), 950],
      [range('106', 'D', 5, 8), 990],
      [range('107', 'C', 1, 6), 1050],
      [range('108', 'A', 1, 4), 1800],
      [range('205', 'H', 10, 13), 600],
      [['107-J-3', '107-J-9'], 800, SIN_VERIFICAR],
    ],
  },
  // Tuesday night, low demand: reventa is cheaper than the box office.
  'tigres-leon-2026-10-20': {
    oficial: {
      precio: 1000,
      libres: [...range('114', 'E', 1, 4), ...range('116', 'B', 7, 10)],
      vendidos: [...range('114', 'A', 1, 20), ...range('116', 'A', 1, 20)],
    },
    reventa: [
      [range('114', 'F', 3, 6), 780],
      [range('116', 'C', 1, 4), 820],
      [range('112', 'K', 9, 12), 850],
    ],
  },
  // Almost sold out: three loose seats at the box office; reventa has 4 together only in the upper zone, expensive.
  'rayados-chivas-2026-10-24': {
    oficial: {
      precio: 1400,
      libres: ['104-K-7', '109-B-15', '210-F-2'],
      vendidos: [...range('104', 'A', 1, 20), ...range('109', 'A', 1, 20), ...range('210', 'A', 1, 20)],
    },
    reventa: [
      [['104-L-11', '104-L-12'], 3200],
      [['109-C-4'], 2950],
      [range('211', 'R', 5, 8), 2400],
      [['212-P-18', '212-P-19'], 1800, SIN_VERIFICAR],
    ],
  },
  // No 4 contiguous seats in the lower zone on either platform; 4+ together only in the upper zone.
  'rayados-tijuana-2026-10-31': {
    oficial: {
      precio: 900,
      libres: ['103-D-1', '103-D-2', '103-D-5', '103-D-6', ...range('107', 'G', 9, 11), '107-G-14', ...range('203', 'J', 1, 6)],
      vendidos: [...range('103', 'A', 1, 20), ...range('107', 'A', 1, 20)],
    },
    reventa: [
      [range('103', 'E', 2, 3), 1000],
      [range('103', 'E', 6, 8), 1050],
      [range('107', 'H', 1, 2), 1100],
      [['108-M-5'], 950],
      [range('203', 'K', 10, 13), 700],
    ],
  },
};

function seedInventario(inv: Inventario): Asientos {
  const oficial: Record<string, AsientoOficial> = {};
  for (const id of inv.oficial.libres) oficial[id] = { precio: inv.oficial.precio, estado: 'libre' };
  for (const id of inv.oficial.vendidos) oficial[id] = { precio: inv.oficial.precio, estado: 'vendido' };
  const reventa: Record<string, AsientoReventa> = {};
  for (const [ids, precio, extra = {}] of inv.reventa) {
    for (const id of ids) reventa[id] = { precio, estado: 'libre', vendedor_verificado: true, garantia_entrada: true, ...extra };
  }
  return { oficial, reventa };
}

function seed(): State {
  const s: State = {
    creado: new Date().toISOString(),
    caos: { activo: false, disparado: { oficial: false, reventa: false } },
    oficial: { eventos: {}, holds: [], compras: [] },
    reventa: { eventos: {}, apartados: [] },
  };
  for (const e of EVENTOS) {
    const inv = e.id === 'clasico-regio-2026' ? seedClasico() : seedInventario(INVENTARIOS[e.id]);
    s.oficial.eventos[e.codigo_oficial] = { asientos: inv.oficial };
    s.reventa.eventos[e.id] = { asientos: inv.reventa };
  }
  return s;
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
  const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as State;
  // A state.json from before inventory was split by event: start over.
  if (!s.oficial?.eventos || !s.reventa?.eventos) return reset();
  return s;
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
      const asientos = s.reventa.eventos[a.evento_id]?.asientos ?? {};
      for (const id of a.asientos) if (asientos[id]?.estado === 'apartado') asientos[id].estado = 'libre';
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
