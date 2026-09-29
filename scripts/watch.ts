// Live view of every tool call from both servers. Put it on the second screen during the demo.
import fs from 'node:fs';
import { paths } from '../src/store.ts';
import type { LoggedEntry } from '../src/store.ts';

const C = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', mag: '\x1b[35m', gray: '\x1b[90m', bold: '\x1b[1m' };
const tag = (p: string) => (p === 'reventa' ? `${C.cyan}${C.bold} REVENTA ${C.reset}` : `${C.gray}${C.bold} OFICIAL ${C.reset}`);
const short = (o: unknown) => { const t = JSON.stringify(o ?? {}); return t.length > 70 ? t.slice(0, 67) + '…' : t; };

function print(e: LoggedEntry) {
  const t = e.ts.slice(11, 19);
  const mark = e.ok ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
  const caos = e.caos ? ` ${C.mag}💥 caos${C.reset}` : '';
  const extra = e.ok ? `${C.dim}${e.resumen ?? ''}${C.reset}` : `${C.red}${e.error}${C.reset}`;
  console.log(`${C.dim}${t}${C.reset} ${tag(e.plataforma)} ${mark} ${C.bold}${e.tool}${C.reset}${C.dim}(${short(e.args)})${C.reset}  ${extra}${caos}`);
}

console.clear();
console.log(`${C.bold}Llamadas del agente en vivo${C.reset}  ${C.dim}(Ctrl+C para salir)${C.reset}\n`);
let offset = 0;
function tick() {
  if (!fs.existsSync(paths.LOG_FILE)) return;
  const size = fs.statSync(paths.LOG_FILE).size;
  if (size < offset) { offset = 0; console.clear(); console.log(`${C.bold}Llamadas del agente en vivo${C.reset}  ${C.dim}(reinicio)${C.reset}\n`); }
  if (size === offset) return;
  const buf = Buffer.alloc(size - offset);
  const fd = fs.openSync(paths.LOG_FILE, 'r');
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  offset = size;
  for (const line of buf.toString('utf8').split('\n').filter(Boolean)) print(JSON.parse(line) as LoggedEntry);
}
setInterval(tick, 300);
tick();
