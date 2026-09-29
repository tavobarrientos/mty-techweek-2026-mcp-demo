// Pre-flight check: starts both servers, lists tools and runs the demo path with chaos on.
// Leaves the inventory reset (chaos OFF) when done.
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { reset, paths } from '../src/store.ts';

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

let fails = 0;
const check = (cond: unknown, msg: string) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const text = (r: ToolResult): string => {
  const c = (r.content as { type: string; text?: string }[] | undefined)?.[0];
  return c?.text ?? '';
};

async function connect(file: string): Promise<Client> {
  const c = new Client({ name: 'smoke', version: '1.0.0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(paths.ROOT, 'src', file)] }));
  return c;
}

reset({ caos: true });
const of = await connect('server-oficial.ts');
const rv = await connect('server-reventa.ts');

const tOf = (await of.listTools()).tools.map((t) => t.name);
const tRv = (await rv.listTools()).tools.map((t) => t.name);
check(tOf.join() === 'get_ev,get_seats,hold,buy', `oficial expone: ${tOf.join(', ')}`);
check(tRv.length === 5, `reventa expone: ${tRv.join(', ')}`);

// Oficial: bad inputs -> opaque 400; chaos -> opaque 409
let r = await of.callTool({ name: 'get_ev', arguments: {} });
const evs = JSON.parse(text(r));
check(evs.length === 6 && JSON.stringify(evs[0]) === '{"i":"EV-7731","n":"CLASICO","d":20261001,"t":2000,"v":"EU"}', `oficial: get_ev devuelve ${evs.length} eventos en blob (clásico intacto)`);
r = await of.callTool({ name: 'get_seats', arguments: { e: 'clasico', z: '112' } });
check(r.isError && text(r).includes('400'), 'oficial: parámetros "normales" → {"error":400}');
r = await of.callTool({ name: 'get_seats', arguments: { e: 'EV-7731', z: 'Z112' } });
check(text(r).includes('"st"') && text(r).includes('7731-112G03'), 'oficial: get_seats devuelve blob crudo con ids "7731-112G03"');
r = await of.callTool({ name: 'hold', arguments: { ids: '112G03,112G04,112G05,112G06' } });
check(r.isError && text(r).includes('400'), 'oficial: ids sin prefijo de evento → {"error":400}');
r = await of.callTool({ name: 'hold', arguments: { ids: '7731-112G03,7731-112G04,7731-112G05,7731-112G06' } });
check(r.isError && text(r).includes('SOLD_OUT'), 'oficial: caos → 409 SOLD_OUT sin alternativas');
r = await of.callTool({ name: 'hold', arguments: { ids: '7731-114D10,7731-114D11,7731-114D12,7731-114D13' } });
check(!r.isError, 'oficial: segundo bloque sí se puede apartar (si el agente lo descifra)');
r = await of.callTool({ name: 'hold', arguments: { ids: '7731-114D10,7731-114D11,7731-114D12,7731-114D13' } });
check(!r.isError, 'oficial: reintento crea OTRO hold (duplicado)');
r = await of.callTool({ name: 'hold', arguments: { ids: '7731-112H02,7732-111C04' } });
check(r.isError && text(r).includes('400'), 'oficial: ids de dos eventos en un hold → {"error":400}');

// Reventa: event search by text
const buscar = async (texto: string) => JSON.parse(text(await rv.callTool({ name: 'buscar_eventos', arguments: { texto } }))).eventos as { evento_id: string; jornada?: string; fecha_legible: string }[];
let evRv = await buscar('tigres');
check(evRv.length === 2, `reventa: buscar_eventos("tigres") → ${evRv.length} partidos (${evRv.map((e) => e.evento_id).join(', ')})`);
evRv = await buscar('rayados');
check(evRv.length === 3, `reventa: buscar_eventos("rayados") → ${evRv.length} partidos`);
evRv = await buscar('Monterrey');
check(evRv.length === 3, `reventa: buscar_eventos("Monterrey") → ${evRv.length} partidos`);
evRv = await buscar('CLASICO');
check(evRv.length === 1 && evRv[0].evento_id === 'clasico-regio-2026', 'reventa: buscar_eventos("CLASICO") → el Clásico Regio (sin acentos ni mayúsculas)');
evRv = await buscar('leon');
check(evRv.length === 1 && evRv[0].jornada === 'Jornada 13' && evRv[0].fecha_legible.startsWith('martes, 20 de octubre de 2026, 21:00'), `reventa: buscar_eventos("leon") → Tigres vs León, ${evRv[0]?.jornada}, ${evRv[0]?.fecha_legible}`);

// Reventa: readable search, chaos with teaching error, idempotent retry
r = await rv.callTool({ name: 'buscar_asientos', arguments: { evento_id: 'clasico-regio-2026', cantidad: 4, juntos: true, precio_max: 1500 } });
check(text(r).includes('112-F-7') && text(r).includes('precio_nominal'), 'reventa: búsqueda legible con 112-F 7–10 y precio nominal');
r = await rv.callTool({ name: 'apartar_asientos', arguments: { evento_id: 'clasico-regio-2026', asientos_ids: ['112-F-7', '112-F-8', '112-F-9', '112-F-10'], clave_idempotencia: 'smoke-001' } });
check(r.isError && text(r).includes('114') && text(r).includes('1,420'), 'reventa: caos → error que ofrece Zona Baja 114 fila C a $1,420');
const ids = JSON.parse(text(r)).alternativas[0].asientos_ids;
r = await rv.callTool({ name: 'apartar_asientos', arguments: { evento_id: 'clasico-regio-2026', asientos_ids: ids, clave_idempotencia: 'smoke-002' } });
const ap = JSON.parse(text(r));
check(!r.isError && ap.cobrado === false, `reventa: apartado ${ap.apartado_id} sin cobro`);
r = await rv.callTool({ name: 'apartar_asientos', arguments: { evento_id: 'clasico-regio-2026', asientos_ids: ids, clave_idempotencia: 'smoke-002' } });
check(JSON.parse(text(r)).ya_existia === true, 'reventa: reintento con misma clave → mismo apartado');
r = await rv.callTool({ name: 'generar_enlace_de_pago', arguments: { apartado_id: ap.apartado_id } });
check(text(r).includes('https://reventa.demo/pagar/'), 'reventa: el pago lo completa el usuario vía enlace');

// Reventa: seats from another event, and the other matches' inventory
r = await rv.callTool({ name: 'apartar_asientos', arguments: { evento_id: 'tigres-toluca-2026-10-09', asientos_ids: ['112-B-1', '112-B-2'], clave_idempotencia: 'smoke-003' } });
check(r.isError && text(r).includes('Clásico Regio') && text(r).includes('clasico-regio-2026'), 'reventa: asientos de otro partido → error que dice de qué evento son');
r = await rv.callTool({ name: 'buscar_asientos', arguments: { evento_id: 'tigres-leon-2026-10-20', cantidad: 4, juntos: true } });
check(text(r).includes('"sobreprecio_pct": -22'), 'reventa: Tigres vs León más barato que la oficial (−22 %)');
r = await rv.callTool({ name: 'buscar_asientos', arguments: { evento_id: 'rayados-tijuana-2026-10-31', cantidad: 4, juntos: true } });
check(!text(r).includes('Zona Baja') && text(r).includes('Zona Alta 203'), 'reventa: Rayados vs Tijuana sin 4 juntos en Zona Baja');

await of.close(); await rv.close();
if (!process.env.KEEP) reset({ caos: false });
console.log(fails ? `\n✗ ${fails} verificaciones fallaron` : '\n✓ Todo listo. Inventario reiniciado (caos apagado). Antes de la demo: npm run caos');
process.exit(fails ? 1 : 0);
