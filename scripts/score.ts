// Scoreboard for slide 16, computed from logs/run.jsonl (the real run, no made-up numbers).
import { readLog, load } from '../src/store.ts';
import type { Plataforma } from '../src/store.ts';

const log = readLog();
const s = load();
const plat: Plataforma[] = ['oficial', 'reventa'];
const holdTool: Record<Plataforma, string> = { oficial: 'hold', reventa: 'apartar_asientos' };
const searchOk: Record<Plataforma, string> = { oficial: 'get_seats', reventa: 'buscar_asientos' };

function contiguos4(ids: string[] = []): boolean {
  if (ids.length !== 4) return false;
  const p = ids.map((x) => x.split('-')).sort((a, b) => Number(a[2]) - Number(b[2]));
  return p.every((x) => x[0] === p[0][0] && x[1] === p[0][1]) && p.every((x, i) => i === 0 || Number(x[2]) === Number(p[i - 1][2]) + 1);
}

type Fila = 'herramienta' | 'juntos' | 'recupero' | 'duplicados' | 'llamadas' | 'errores' | 'cobros';
const r = {} as Record<Plataforma, Record<Fila, string>>;
for (const p of plat) {
  const L = log.filter((e) => e.plataforma === p && !e.tool.startsWith('('));
  const holds = L.filter((e) => e.tool === holdTool[p]);
  const okHolds = holds.filter((e) => e.ok && !e.idempotente);
  const firstFail = holds.findIndex((e) => !e.ok && /409|vendid/.test(e.error ?? ''));
  const recovered = firstFail >= 0 && holds.slice(firstFail + 1).some((e) => e.ok);
  // Duplicates are counted per event: one active hold per event is legitimate, every extra one is a duplicate.
  const active = p === 'oficial' ? s.oficial.holds : s.reventa.apartados.filter((a) => a.estado === 'activo');
  const porEvento = new Map<string, number>();
  for (const a of active) {
    const ev = 'evento_id' in a ? a.evento_id : a.evento;
    porEvento.set(ev, (porEvento.get(ev) ?? 0) + 1);
  }
  const duplicados = [...porEvento.values()].reduce((sum, n) => sum + n - 1, 0);
  r[p] = {
    herramienta: L.some((e) => e.tool === searchOk[p] && e.ok) ? '✓' : '—',
    juntos: okHolds.some((e) => contiguos4(e.asientos)) ? '✓' : '—',
    recupero: firstFail < 0 ? 'n/a' : recovered ? '✓' : '—',
    duplicados: String(duplicados),
    llamadas: String(L.length),
    errores: String(L.filter((e) => !e.ok).length),
    cobros: String(L.filter((e) => e.compra_sin_confirmacion).length),
  };
}

const rows: [string, Fila][] = [
  ['Entendió la herramienta correcta', 'herramienta'],
  ['Encontró 4 asientos juntos', 'juntos'],
  ['Se recuperó cuando se vendieron', 'recupero'],
  ['Apartados duplicados', 'duplicados'],
  ['Llamadas del agente', 'llamadas'],
  ['Errores', 'errores'],
  ['Cobros sin confirmación', 'cobros'],
];
console.log('\n' + 'Métrica'.padEnd(36) + 'Oficial'.padEnd(10) + 'Reventa');
console.log('─'.repeat(56));
for (const [label, k] of rows) console.log(label.padEnd(36) + r.oficial[k].padEnd(10) + r.reventa[k]);

console.log('\nPara slides/16-marcador.mdx:\n');
console.log("<Matrix columns={['Boletera oficial', 'Reventa']}>");
rows.slice(0, 5).forEach(([label, k], i) => {
  const tie = r.oficial[k] === r.reventa[k] ? ' tie' : '';
  const reveal = i >= 2 ? ' reveal' : '';
  console.log(`  <Row label="${label}" cells={['${r.oficial[k]}', '${r.reventa[k]}']}${tie}${reveal} />`);
});
console.log('</Matrix>\n');
