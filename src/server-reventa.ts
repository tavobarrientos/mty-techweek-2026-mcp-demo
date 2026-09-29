// "Reventa": the GOOD design. The four rules applied:
// 1) names/descriptions are the interface, 2) errors teach, 3) retries don't duplicate,
// 4) least privilege: the agent can search and hold; only the user pays.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { load, save, log, EVENTO, PRECIO_NOMINAL, parseSeat, bloquesContiguos, expirarApartados } from './store.ts';
import type { Apartado, AsientoEnBloque, State } from './store.ts';

const P = 'reventa' as const;
const server = new McpServer({ name: 'reventa', version: '1.0.0' });

const ok = (o: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] });
const teach = (msg: string, extra: Record<string, unknown> = {}): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify({ error: msg, ...extra }, null, 2) }], isError: true });

function describirBloque(b: AsientoEnBloque[]) {
  const { zona, fila } = parseSeat(b[0].id);
  const precio = b[0].precio;
  return {
    zona: `Zona Baja ${zona}`,
    fila,
    asientos: `${b[0].num}–${b[b.length - 1].num}`,
    asientos_ids: b.map((x) => x.id),
    juntos: true,
    precio_por_boleto: precio,
    precio_nominal: PRECIO_NOMINAL,
    sobreprecio_pct: Math.round(((precio - PRECIO_NOMINAL) / PRECIO_NOMINAL) * 100),
    total: precio * b.length,
    vendedor_verificado: b.every((x) => x.vendedor_verificado),
    garantia_entrada: b.every((x) => x.garantia_entrada),
  };
}

function alternativas(s: State, cantidad: number, precioMax?: number, excluir: string[] = []) {
  return bloquesContiguos(s.reventa.asientos, cantidad, (id) => !excluir.includes(id))
    .filter((b) => precioMax == null || b[0].precio <= precioMax)
    .sort((a, b) => a[0].precio - b[0].precio)
    .slice(0, 3)
    .map(describirBloque);
}

server.registerTool('buscar_eventos', {
  title: 'Buscar eventos',
  description: 'Busca eventos por texto (equipo, artista, recinto). Devuelve evento_id para usar en buscar_asientos.',
  inputSchema: { texto: z.string().describe('Ej. "clásico", "Tigres", "Rayados"') },
}, async (args) => {
  const r = [{ evento_id: EVENTO.id, nombre: EVENTO.nombre, fecha: EVENTO.fecha, recinto: EVENTO.estadio }];
  log({ plataforma: P, tool: 'buscar_eventos', args, ok: true, resumen: `1 evento: ${EVENTO.nombre}` });
  return ok({ eventos: r, siguiente_paso: 'Llama a buscar_asientos con este evento_id.' });
});

server.registerTool('buscar_asientos', {
  title: 'Buscar asientos',
  description:
    'Busca asientos disponibles para un evento. Con juntos=true solo devuelve bloques contiguos en la misma fila. ' +
    'Cada resultado incluye precio contra precio nominal, si el vendedor está verificado y si hay garantía de entrada. ' +
    'Después usa apartar_asientos con los asientos_ids de un bloque.',
  inputSchema: {
    evento_id: z.string().describe('Id obtenido de buscar_eventos'),
    cantidad: z.number().int().min(1).max(10).describe('Número de boletos'),
    juntos: z.boolean().default(true).describe('true = asientos contiguos en la misma fila'),
    precio_max: z.number().optional().describe('Precio máximo por boleto en MXN'),
  },
}, async (args) => {
  const s = load();
  expirarApartados(s);
  if (args.evento_id !== EVENTO.id) {
    log({ plataforma: P, tool: 'buscar_asientos', args, ok: false, error: 'evento_id desconocido' });
    return teach(`No conozco el evento "${args.evento_id}". Usa buscar_eventos para obtener el evento_id correcto (el del clásico es "${EVENTO.id}").`);
  }
  let resultados: unknown[];
  if (args.juntos !== false) {
    resultados = alternativas(s, args.cantidad, args.precio_max);
  } else {
    resultados = Object.entries(s.reventa.asientos)
      .filter(([, a]) => a.estado === 'libre' && (args.precio_max == null || a.precio <= args.precio_max))
      .map(([id, a]) => ({ asiento_id: id, precio: a.precio, vendedor_verificado: a.vendedor_verificado, garantia_entrada: a.garantia_entrada }));
  }
  save(s);
  log({ plataforma: P, tool: 'buscar_asientos', args, ok: true, resumen: `${resultados.length} opciones legibles` });
  if (!resultados.length) {
    return ok({ resultados: [], mensaje: `No hay ${args.cantidad} asientos juntos${args.precio_max ? ` por debajo de $${args.precio_max}` : ''}. Prueba sin precio_max o con juntos=false.` });
  }
  return ok({ evento: EVENTO.nombre, resultados, siguiente_paso: 'Aparta un bloque con apartar_asientos (no cobra nada; dura 10 minutos).' });
});

server.registerTool('apartar_asientos', {
  title: 'Apartar asientos',
  description:
    'Aparta asientos durante 10 minutos SIN cobrar. Usa asientos_ids de buscar_asientos. ' +
    'Envía una clave_idempotencia única por intento de compra: si reintentas con la misma clave no se duplica el apartado. ' +
    'Después muestra el resumen al usuario y pídele confirmación antes de generar_enlace_de_pago.',
  inputSchema: {
    asientos_ids: z.array(z.string()).min(1).describe('Ej. ["112-F-7","112-F-8"]'),
    clave_idempotencia: z.string().min(4).describe('Cualquier texto único, ej. "aficionado-clasico-001"'),
  },
}, async (args) => {
  const s = load();
  expirarApartados(s);

  const previo = s.reventa.apartados.find((a) => a.clave_idempotencia === args.clave_idempotencia && a.estado === 'activo');
  if (previo) {
    log({ plataforma: P, tool: 'apartar_asientos', args, ok: true, resumen: `mismo apartado ${previo.apartado_id} (idempotente)`, idempotente: true });
    return ok({ ...previo, ya_existia: true, nota: 'Ya existía un apartado con esta clave; no se creó otro.' });
  }

  const desconocidos = args.asientos_ids.filter((id) => !s.reventa.asientos[id]);
  if (desconocidos.length) {
    log({ plataforma: P, tool: 'apartar_asientos', args, ok: false, error: 'ids desconocidos' });
    return teach(`No reconozco estos asientos: ${desconocidos.join(', ')}. Usa exactamente los asientos_ids que devuelve buscar_asientos (formato "112-F-7").`);
  }

  const cantidad = args.asientos_ids.length;
  const precioRef = s.reventa.asientos[args.asientos_ids[0]].precio;
  let noDisponibles = args.asientos_ids.filter((id) => s.reventa.asientos[id].estado !== 'libre');

  // Chaos: the first valid hold attempt finds its seats "just sold".
  if (!noDisponibles.length && s.caos.activo && !s.caos.disparado.reventa) {
    for (const id of args.asientos_ids) s.reventa.asientos[id].estado = 'vendido';
    s.caos.disparado.reventa = true;
    noDisponibles = args.asientos_ids;
  }

  if (noDisponibles.length) {
    const alts = alternativas(s, cantidad, Math.max(precioRef + 300, 1500), args.asientos_ids);
    save(s);
    const primera = alts[0];
    log({ plataforma: P, tool: 'apartar_asientos', args, ok: false, error: 'vendidos + alternativa', caos: s.caos.disparado.reventa, asientos: args.asientos_ids });
    return teach(
      `Esos ${cantidad} asientos (${noDisponibles.join(', ')}) se vendieron hace un momento.` +
        (primera ? ` Hay ${cantidad} juntos en ${primera.zona}, fila ${primera.fila}, a $${primera.precio_por_boleto.toLocaleString('es-MX')} c/u. Llama de nuevo a apartar_asientos con esos asientos_ids y una clave_idempotencia nueva.` : ' No quedan bloques similares; ofrece al usuario buscar con juntos=false.'),
      { alternativas: alts },
    );
  }

  const apartado: Apartado = {
    apartado_id: `AP-${Math.floor(10000 + Math.random() * 90000)}`,
    clave_idempotencia: args.clave_idempotencia,
    estado: 'activo',
    evento: EVENTO.nombre,
    asientos: args.asientos_ids,
    precio_por_boleto: precioRef,
    total: precioRef * cantidad,
    expira: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  for (const id of args.asientos_ids) s.reventa.asientos[id].estado = 'apartado';
  s.reventa.apartados.push(apartado);
  save(s);
  log({ plataforma: P, tool: 'apartar_asientos', args, ok: true, resumen: `apartado ${apartado.apartado_id} · $${apartado.total}`, asientos: args.asientos_ids, apartado: apartado.apartado_id });
  return ok({ ...apartado, expira_en_min: 10, cobrado: false, siguiente_paso: 'Muestra este resumen al usuario y pregúntale si confirma. Solo si dice que sí, llama a generar_enlace_de_pago.' });
});

server.registerTool('consultar_apartado', {
  title: 'Consultar apartado',
  description: 'Devuelve el estado de un apartado (activo, expirado) y cuánto tiempo le queda.',
  inputSchema: { apartado_id: z.string() },
}, async (args) => {
  const s = load();
  expirarApartados(s);
  save(s);
  const a = s.reventa.apartados.find((x) => x.apartado_id === args.apartado_id);
  if (!a) {
    log({ plataforma: P, tool: 'consultar_apartado', args, ok: false, error: 'no existe' });
    return teach(`No existe el apartado ${args.apartado_id}. Revisa el id que devolvió apartar_asientos.`);
  }
  const min = Math.max(0, Math.round((Date.parse(a.expira) - Date.now()) / 60000));
  log({ plataforma: P, tool: 'consultar_apartado', args, ok: true, resumen: `${a.estado}, ${min} min` });
  return ok({ ...a, minutos_restantes: min });
});

server.registerTool('generar_enlace_de_pago', {
  title: 'Generar enlace de pago',
  description:
    'Genera un enlace para que el USUARIO pague un apartado. Este servicio nunca cobra desde un agente: ' +
    'el pago lo completa la persona. Úsalo solo después de que el usuario confirmó.',
  inputSchema: { apartado_id: z.string() },
}, async (args) => {
  const s = load();
  expirarApartados(s);
  const a = s.reventa.apartados.find((x) => x.apartado_id === args.apartado_id && x.estado === 'activo');
  if (!a) {
    log({ plataforma: P, tool: 'generar_enlace_de_pago', args, ok: false, error: 'apartado inválido o expirado' });
    return teach(`El apartado ${args.apartado_id} no existe o expiró. Vuelve a llamar a apartar_asientos.`);
  }
  log({ plataforma: P, tool: 'generar_enlace_de_pago', args, ok: true, resumen: `enlace para el usuario · $${a.total}` });
  return ok({ enlace: `https://reventa.demo/pagar/${a.apartado_id}`, total: a.total, nota: 'Entrega este enlace al usuario. El cobro lo confirma él.' });
});

await server.connect(new StdioServerTransport());
