// Usage: npm run vender -- <oficial|reventa> <zona-fila-desde..hasta>   e.g. npm run vender -- reventa 112-F-7..10
import { load, save, log } from '../src/store.ts';
import type { Plataforma } from '../src/store.ts';
const [arg, spec] = process.argv.slice(2);
const m = /^(\d{3})-([A-Z])-(\d+)(?:\.\.(\d+))?$/.exec(spec ?? '');
const esPlataforma = (x: string | undefined): x is Plataforma => x === 'oficial' || x === 'reventa';
if (!esPlataforma(arg) || !m) {
  console.error('Uso: npm run vender -- <oficial|reventa> <zona-fila-desde..hasta>  (ej. reventa 112-F-7..10)');
  process.exit(1);
}
const plataforma = arg;
const [, zona, fila, a, b] = m;
const s = load();
const vendidos = [];
for (let n = Number(a); n <= Number(b ?? a); n++) {
  const id = `${zona}-${fila}-${n}`;
  const seat = s[plataforma].asientos[id];
  if (seat) { seat.estado = 'vendido'; vendidos.push(id); }
}
save(s);
log({ plataforma, tool: '(caos manual)', args: { spec }, ok: true, resumen: `vendidos ${vendidos.join(', ')}` });
console.log(`💥 ${plataforma}: vendidos ${vendidos.join(', ') || '(ninguno)'}`);
