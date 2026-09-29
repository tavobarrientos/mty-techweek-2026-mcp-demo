// Usage: npm run vender -- <oficial|reventa> <evento> <zona-fila-desde..hasta>
//   e.g. npm run vender -- reventa clasico-regio-2026 112-F-7..10
// <evento> can be the evento_id ("clasico-regio-2026") or the official code ("EV-7731") on either platform.
import { load, save, log, eventoPorId, eventoPorCodigo } from '../src/store.ts';
import type { Plataforma } from '../src/store.ts';
const [arg, eventoArg, spec] = process.argv.slice(2);
const m = /^(\d{3})-([A-Z])-(\d+)(?:\.\.(\d+))?$/.exec(spec ?? '');
const esPlataforma = (x: string | undefined): x is Plataforma => x === 'oficial' || x === 'reventa';
const evento = eventoArg ? eventoPorId(eventoArg) ?? eventoPorCodigo(eventoArg) : undefined;
if (!esPlataforma(arg) || !evento || !m) {
  console.error('Uso: npm run vender -- <oficial|reventa> <evento> <zona-fila-desde..hasta>  (ej. reventa clasico-regio-2026 112-F-7..10)');
  if (eventoArg && !evento) console.error(`Evento desconocido: ${eventoArg}`);
  process.exit(1);
}
const plataforma = arg;
const clave = plataforma === 'oficial' ? evento.codigo_oficial : evento.id;
const [, zona, fila, a, b] = m;
const s = load();
const asientos = s[plataforma].eventos[clave].asientos;
const vendidos = [];
for (let n = Number(a); n <= Number(b ?? a); n++) {
  const id = `${zona}-${fila}-${n}`;
  const seat = asientos[id];
  if (seat) { seat.estado = 'vendido'; vendidos.push(id); }
}
save(s);
log({ plataforma, tool: '(caos manual)', args: { evento: clave, spec }, ok: true, evento: clave, resumen: `vendidos ${vendidos.join(', ')}` });
console.log(`💥 ${plataforma} · ${evento.nombre}: vendidos ${vendidos.join(', ') || '(ninguno)'}`);
