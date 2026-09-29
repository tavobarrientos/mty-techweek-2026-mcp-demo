// "Boletera oficial": the BAD design, on purpose.
// Cryptic names, empty descriptions, raw blobs, opaque errors, no idempotency,
// and a purchase tool that charges without asking anyone.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { load, save, log, EVENTO, parseSeat } from './store.ts';
import type { AsientoOficial } from './store.ts';

const P = 'oficial' as const;
const server = new McpServer({ name: 'boletera-oficial', version: '1.0.0' });

const toCode = (id: string): string => { const { zona, fila, num } = parseSeat(id); return `${zona}${fila}${String(num).padStart(2, '0')}`; };
const fromCode = (code: string): string | null => {
  const m = /^(\d{3})([A-Z])(\d{2})$/.exec(code.trim());
  return m ? `${m[1]}-${m[2]}-${Number(m[3])}` : null;
};
const ST: Record<AsientoOficial['estado'], number> = { libre: 1, vendido: 0, hold: 2, comprado: 0 };
const json = (o: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
const fail = (o: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(o) }], isError: true });

server.registerTool('get_ev', {
  description: 'Gets ev.',
  inputSchema: {},
}, async () => {
  const r = [{ i: EVENTO.codigo_oficial, n: 'CLASICO', d: 20261001, t: 2000, v: 'EU' }];
  log({ plataforma: P, tool: 'get_ev', args: {}, ok: true, resumen: '1 evento (blob)' });
  return json(r);
});

server.registerTool('get_seats', {
  description: 'Obtiene asientos.',
  inputSchema: { e: z.string(), z: z.string(), n: z.number().optional() },
}, async (args) => {
  const s = load();
  if (args.e !== EVENTO.codigo_oficial || !/^Z\d{3}$/.test(args.z)) {
    log({ plataforma: P, tool: 'get_seats', args, ok: false, error: '400' });
    return fail({ error: 400 });
  }
  const zona = args.z.slice(1);
  const rows = Object.entries(s.oficial.asientos)
    .filter(([id]) => id.startsWith(zona + '-'))
    .map(([id, a]) => ({ s: toCode(id), st: ST[a.estado], p: a.precio * 100 }));
  log({ plataforma: P, tool: 'get_seats', args, ok: true, resumen: `${rows.length} filas crudas (st/p sin explicar)` });
  return json(rows);
});

server.registerTool('hold', {
  description: 'Hold.',
  inputSchema: { ids: z.string() },
}, async (args) => {
  const s = load();
  const parsed = args.ids.split(',').map(fromCode);
  if (parsed.some((x) => !x || !s.oficial.asientos[x])) {
    log({ plataforma: P, tool: 'hold', args, ok: false, error: '400' });
    return fail({ error: 400 });
  }
  const ids = parsed as string[];
  // Chaos: the first valid hold attempt finds its seats "just sold".
  if (s.caos.activo && !s.caos.disparado.oficial && ids.every((x) => s.oficial.asientos[x].estado === 'libre')) {
    for (const x of ids) s.oficial.asientos[x].estado = 'vendido';
    s.caos.disparado.oficial = true;
    save(s);
    log({ plataforma: P, tool: 'hold', args, ok: false, error: '409 SOLD_OUT', caos: true, asientos: ids });
    return fail({ error: 409, code: 'SOLD_OUT' });
  }
  // Only checks "sold", not "held": retrying creates duplicate holds.
  if (ids.some((x) => s.oficial.asientos[x].estado === 'vendido' || s.oficial.asientos[x].estado === 'comprado')) {
    log({ plataforma: P, tool: 'hold', args, ok: false, error: '409 SOLD_OUT', asientos: ids });
    return fail({ error: 409, code: 'SOLD_OUT' });
  }
  const h = `H-${Math.floor(1000 + Math.random() * 9000)}`;
  for (const x of ids) s.oficial.asientos[x].estado = 'hold';
  s.oficial.holds.push({ h, asientos: ids, creado: new Date().toISOString() });
  save(s);
  log({ plataforma: P, tool: 'hold', args, ok: true, resumen: `hold ${h}`, asientos: ids, hold: h });
  return json({ h, ok: 1 });
});

server.registerTool('buy', {
  description: 'Buy.',
  inputSchema: { h: z.string() },
}, async (args) => {
  const s = load();
  const hold = s.oficial.holds.find((x) => x.h === args.h);
  if (!hold) {
    log({ plataforma: P, tool: 'buy', args, ok: false, error: '404' });
    return fail({ error: 404 });
  }
  for (const x of hold.asientos) s.oficial.asientos[x].estado = 'comprado';
  s.oficial.compras.push({ h: hold.h, asientos: hold.asientos, total: hold.asientos.length * 1200 });
  save(s);
  log({ plataforma: P, tool: 'buy', args, ok: true, resumen: `COBRO SIN CONFIRMACIÓN $${hold.asientos.length * 1200}`, compra_sin_confirmacion: true });
  return json({ ok: 1, c: `C-${hold.h.slice(2)}` });
});

await server.connect(new StdioServerTransport());
