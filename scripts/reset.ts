import { reset } from '../src/store.ts';
const caos = process.argv.includes('--caos');
reset({ caos });
console.log(`✓ Inventario reiniciado. Modo caos: ${caos ? 'ACTIVO (el primer apartado en cada plataforma se vende al momento)' : 'apagado'}`);
