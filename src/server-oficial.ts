// "Boletera oficial": the BAD design, on purpose.
// Cryptic names, empty descriptions, raw blobs, opaque errors, no idempotency,
// and a purchase tool that charges without asking anyone.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { load, save, log, EVENTOS, parseSeat } from './store.ts';
import type { AsientoOficial } from './store.ts';

const P = 'oficial' as const;
const server = new McpServer({ name: 'boletera-oficial', version: '1.0.0' });

// Seat codes carry the event number as an unexplained prefix: "7731-112G03".
const toCode = (codigo: string, id: string): string => {
  const { zona, fila, num } = parseSeat(id);
  return `${codigo.replace(/^EV-/, '')}-${zona}${fila}${String(num).padStart(2, '0')}`;
};
const fromCode = (code: string): { e: string; id: string } | null => {
  const m = /^(\d{4})-(\d{3})([A-Z])(\d{2})$/.exec(code.trim());
  return m ? { e: `EV-${m[1]}`, id: `${m[2]}-${m[3]}-${Number(m[4])}` } : null;
};
// Internal short names for the blob; never explained to the agent.
const CORTO: Record<string, { n: string; v: string }> = {
  'EV-7731': { n: 'CLASICO', v: 'EU' },
  'EV-7732': { n: 'TIGTOL', v: 'EU' },
  'EV-7733': { n: 'RAYPAC', v: 'EBBVA' },
  'EV-7734': { n: 'TIGLEO', v: 'EU' },
  'EV-7735': { n: 'RAYCHI', v: 'EBBVA' },
  'EV-7736': { n: 'RAYTIJ', v: 'EBBVA' },
};
const ST: Record<AsientoOficial['estado'], number> = { libre: 1, vendido: 0, hold: 2, comprado: 0 };
const json = (o: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
const fail = (o: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(o) }], isError: true });

server.registerTool('get_ev', {
  description: 'Gets ev.',
  inputSchema: {},
}, async () => {
  const r = EVENTOS.map((e) => ({
    i: e.codigo_oficial,
    n: CORTO[e.codigo_oficial].n,
    d: Number(e.fecha.slice(0, 10).replaceAll('-', '')),
    t: Number(e.fecha.slice(11, 16).replace(':', '')),
    v: CORTO[e.codigo_oficial].v,
  }));
  log({ plataforma: P, tool: 'get_ev', args: {}, ok: true, resumen: `${r.length} eventos (blob)` });
  return json(r);
});

server.registerTool('get_seats', {
  description: 'Obtiene asientos.',
  inputSchema: { e: z.string(), z: z.string(), n: z.number().optional() },
}, async (args) => {
  const s = load();
  const ev = s.oficial.eventos[args.e];
  if (!ev || !/^Z\d{3}$/.test(args.z)) {
    log({ plataforma: P, tool: 'get_seats', args, ok: false, error: '400' });
    return fail({ error: 400 });
  }
  const zona = args.z.slice(1);
  const rows = Object.entries(ev.asientos)
    .filter(([id]) => id.startsWith(zona + '-'))
    .map(([id, a]) => ({ s: toCode(args.e, id), st: ST[a.estado], p: a.precio * 100 }));
  log({ plataforma: P, tool: 'get_seats', args, ok: true, evento: args.e, resumen: `${rows.length} filas crudas (st/p sin explicar)` });
  return json(rows);
});

server.registerTool('hold', {
  description: 'Hold.',
  inputSchema: { ids: z.string() },
}, async (args) => {
  const s = load();
  const parsed = args.ids.split(',').map(fromCode);
  const codigo = parsed[0]?.e;
  const asientos = codigo ? s.oficial.eventos[codigo]?.asientos : undefined;
  // All ids must be from the same event; anything else is a bare 400.
  if (!codigo || !asientos || parsed.some((x) => !x || x.e !== codigo || !asientos[x.id])) {
    log({ plataforma: P, tool: 'hold', args, ok: false, error: '400' });
    return fail({ error: 400 });
  }
  const ids = parsed.map((x) => x!.id);
  // Chaos: the first valid hold attempt finds its seats "just sold".
  if (s.caos.activo && !s.caos.disparado.oficial && ids.every((x) => asientos[x].estado === 'libre')) {
    for (const x of ids) asientos[x].estado = 'vendido';
    s.caos.disparado.oficial = true;
    save(s);
    log({ plataforma: P, tool: 'hold', args, ok: false, evento: codigo, error: '409 SOLD_OUT', caos: true, asientos: ids });
    return fail({ error: 409, code: 'SOLD_OUT' });
  }
  // Only checks "sold", not "held": retrying creates duplicate holds.
  if (ids.some((x) => asientos[x].estado === 'vendido' || asientos[x].estado === 'comprado')) {
    log({ plataforma: P, tool: 'hold', args, ok: false, evento: codigo, error: '409 SOLD_OUT', asientos: ids });
    return fail({ error: 409, code: 'SOLD_OUT' });
  }
  const h = `H-${Math.floor(1000 + Math.random() * 9000)}`;
  for (const x of ids) asientos[x].estado = 'hold';
  s.oficial.holds.push({ h, evento: codigo, asientos: ids, creado: new Date().toISOString() });
  save(s);
  log({ plataforma: P, tool: 'hold', args, ok: true, evento: codigo, resumen: `hold ${h}`, asientos: ids, hold: h });
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
  const asientos = s.oficial.eventos[hold.evento].asientos;
  const total = hold.asientos.reduce((sum, x) => sum + asientos[x].precio, 0);
  for (const x of hold.asientos) asientos[x].estado = 'comprado';
  s.oficial.compras.push({ h: hold.h, evento: hold.evento, asientos: hold.asientos, total });
  save(s);
  log({ plataforma: P, tool: 'buy', args, ok: true, evento: hold.evento, resumen: `COBRO SIN CONFIRMACIÓN $${total}`, compra_sin_confirmacion: true });
  return json({ ok: 1, c: `C-${hold.h.slice(2)}` });
});

await server.connect(new StdioServerTransport());
