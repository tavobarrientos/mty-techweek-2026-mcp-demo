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
let r = await of.callTool({ name: 'get_seats', arguments: { e: 'clasico', z: '112' } });
check(r.isError && text(r).includes('400'), 'oficial: parámetros "normales" → {"error":400}');
r = await of.callTool({ name: 'get_seats', arguments: { e: 'EV-7731', z: 'Z112' } });
check(text(r).includes('"st"'), 'oficial: get_seats devuelve blob crudo');
r = await of.callTool({ name: 'hold', arguments: { ids: '112G03,112G04,112G05,112G06' } });
check(r.isError && text(r).includes('SOLD_OUT'), 'oficial: caos → 409 SOLD_OUT sin alternativas');
r = await of.callTool({ name: 'hold', arguments: { ids: '114D10,114D11,114D12,114D13' } });
check(!r.isError, 'oficial: segundo bloque sí se puede apartar (si el agente lo descifra)');
r = await of.callTool({ name: 'hold', arguments: { ids: '114D10,114D11,114D12,114D13' } });
check(!r.isError, 'oficial: reintento crea OTRO hold (duplicado)');

// Reventa: readable search, chaos with teaching error, idempotent retry
r = await rv.callTool({ name: 'buscar_asientos', arguments: { evento_id: 'clasico-regio-2026', cantidad: 4, juntos: true, precio_max: 1500 } });
check(text(r).includes('112-F-7') && text(r).includes('precio_nominal'), 'reventa: búsqueda legible con 112-F 7–10 y precio nominal');
r = await rv.callTool({ name: 'apartar_asientos', arguments: { asientos_ids: ['112-F-7', '112-F-8', '112-F-9', '112-F-10'], clave_idempotencia: 'smoke-001' } });
check(r.isError && text(r).includes('114') && text(r).includes('1,420'), 'reventa: caos → error que ofrece Zona Baja 114 fila C a $1,420');
const ids = JSON.parse(text(r)).alternativas[0].asientos_ids;
r = await rv.callTool({ name: 'apartar_asientos', arguments: { asientos_ids: ids, clave_idempotencia: 'smoke-002' } });
const ap = JSON.parse(text(r));
check(!r.isError && ap.cobrado === false, `reventa: apartado ${ap.apartado_id} sin cobro`);
r = await rv.callTool({ name: 'apartar_asientos', arguments: { asientos_ids: ids, clave_idempotencia: 'smoke-002' } });
check(JSON.parse(text(r)).ya_existia === true, 'reventa: reintento con misma clave → mismo apartado');
r = await rv.callTool({ name: 'generar_enlace_de_pago', arguments: { apartado_id: ap.apartado_id } });
check(text(r).includes('https://reventa.demo/pagar/'), 'reventa: el pago lo completa el usuario vía enlace');

await of.close(); await rv.close();
if (!process.env.KEEP) reset({ caos: false });
console.log(fails ? `\n✗ ${fails} verificaciones fallaron` : '\n✓ Todo listo. Inventario reiniciado (caos apagado). Antes de la demo: npm run caos');
process.exit(fails ? 1 : 0);
