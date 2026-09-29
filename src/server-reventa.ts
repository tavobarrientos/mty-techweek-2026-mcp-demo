// "Reventa": the GOOD design. The four rules applied:
// 1) names/descriptions are the interface, 2) errors teach, 3) retries don't duplicate,
// 4) least privilege: the agent can search and hold; only the user pays.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { load, save, log, EVENTOS, eventoPorId, parseSeat, bloquesContiguos, expirarApartados } from './store.ts';
import type { Apartado, AsientoEnBloque, AsientoReventa, Evento, State } from './store.ts';

const P = 'reventa' as const;
const server = new McpServer({ name: 'reventa', version: '1.0.0' });

const ok = (o: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] });
const teach = (msg: string, extra: Record<string, unknown> = {}): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify({ error: msg, ...extra }, null, 2) }], isError: true });

const normalizar = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
// Filler words ignored in searches like "partido de Tigres" or "Rayados vs Chivas".
const RELLENO = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'vs', 'v', 'contra', 'partido', 'juego', 'boletos', 'para', 'en', 'y']);

function coincide(e: Evento, texto: string): boolean {
  const pajar = normalizar([e.nombre, e.estadio, ...(e.equipos ?? [])].join(' '));
  const palabras = normalizar(texto).split(/[^a-z0-9]+/).filter((p) => p && !RELLENO.has(p));
  return palabras.every((p) => pajar.includes(p));
}

function fechaLegible(fecha: string): string {
  const d = new Date(fecha);
  const tz = 'America/Mexico_City';
  const dia = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });
  const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  return `${dia}, ${hora} h (hora del centro de México)`;
}

function resumenEvento(e: Evento) {
  return {
    evento_id: e.id,
    nombre: e.nombre,
    ...(e.jornada != null && { jornada: `Jornada ${e.jornada}` }),
    fecha: e.fecha,
    fecha_legible: fechaLegible(e.fecha),
    recinto: e.estadio,
  };
}

const listaEventos = () => EVENTOS.map((e) => `"${e.id}" (${e.nombre})`).join(', ');

function describirBloque(b: AsientoEnBloque[], evento: Evento) {
  const { zona, fila } = parseSeat(b[0].id);
  const precio = b[0].precio;
  return {
    zona: `${zona.startsWith('1') ? 'Zona Baja' : 'Zona Alta'} ${zona}`,
    fila,
    asientos: `${b[0].num}–${b[b.length - 1].num}`,
    asientos_ids: b.map((x) => x.id),
    juntos: true,
    precio_por_boleto: precio,
    precio_nominal: evento.precio_nominal,
    sobreprecio_pct: Math.round(((precio - evento.precio_nominal) / evento.precio_nominal) * 100),
    total: precio * b.length,
    vendedor_verificado: b.every((x) => x.vendedor_verificado),
    garantia_entrada: b.every((x) => x.garantia_entrada),
  };
}

function alternativas(asientos: Record<string, AsientoReventa>, evento: Evento, cantidad: number, precioMax?: number, excluir: string[] = []) {
  return bloquesContiguos(asientos, cantidad, (id) => !excluir.includes(id))
    .filter((b) => precioMax == null || b[0].precio <= precioMax)
    .sort((a, b) => a[0].precio - b[0].precio)
    .slice(0, 3)
    .map((b) => describirBloque(b, evento));
}

// Which event each seat id actually belongs to (reventa seat ids are unique across events).
function eventoDelAsiento(s: State, id: string): Evento | undefined {
  return EVENTOS.find((e) => s.reventa.eventos[e.id]?.asientos[id]);
}

server.registerTool('buscar_eventos', {
  title: 'Buscar eventos',
  description:
    'Busca partidos por texto: equipo, estadio o "clásico" (no distingue acentos ni mayúsculas). ' +
    'Devuelve evento_id, fecha legible y jornada. Usa el evento_id en buscar_asientos.',
  inputSchema: { texto: z.string().describe('Ej. "clásico", "Tigres", "Rayados", "Chivas", "Estadio BBVA"') },
}, async (args) => {
  const r = EVENTOS.filter((e) => coincide(e, args.texto)).map(resumenEvento);
  log({ plataforma: P, tool: 'buscar_eventos', args, ok: true, resumen: `${r.length} evento(s): ${r.map((e) => e.nombre).join(', ') || '—'}` });
  if (!r.length) {
    return ok({ eventos: [], mensaje: `No encontré partidos con "${args.texto}". Partidos disponibles: ${EVENTOS.map((e) => e.nombre).join(', ')}. Prueba con el nombre de un equipo o del estadio.` });
  }
  return ok({ eventos: r, siguiente_paso: 'Llama a buscar_asientos con el evento_id del partido que quiere el usuario.' });
});

server.registerTool('buscar_asientos', {
  title: 'Buscar asientos',
  description:
    'Busca asientos disponibles para un partido. Con juntos=true solo devuelve bloques contiguos en la misma fila. ' +
    'Cada resultado incluye zona (Baja o Alta), precio contra precio nominal, si el vendedor está verificado y si hay garantía de entrada. ' +
    'Después usa apartar_asientos con el mismo evento_id y los asientos_ids de un bloque.',
  inputSchema: {
    evento_id: z.string().describe('Id obtenido de buscar_eventos, ej. "clasico-regio-2026"'),
    cantidad: z.number().int().min(1).max(10).describe('Número de boletos'),
    juntos: z.boolean().default(true).describe('true = asientos contiguos en la misma fila'),
    precio_max: z.number().optional().describe('Precio máximo por boleto en MXN'),
  },
}, async (args) => {
  const s = load();
  expirarApartados(s);
  const evento = eventoPorId(args.evento_id);
  if (!evento) {
    log({ plataforma: P, tool: 'buscar_asientos', args, ok: false, error: 'evento_id desconocido' });
    return teach(`No conozco el evento "${args.evento_id}". Usa buscar_eventos para obtener el evento_id correcto. Los disponibles son: ${listaEventos()}.`);
  }
  const asientos = s.reventa.eventos[evento.id].asientos;
  let resultados: unknown[];
  if (args.juntos !== false) {
    resultados = alternativas(asientos, evento, args.cantidad, args.precio_max);
  } else {
    resultados = Object.entries(asientos)
      .filter(([, a]) => a.estado === 'libre' && (args.precio_max == null || a.precio <= args.precio_max))
      .map(([id, a]) => ({ asiento_id: id, precio: a.precio, vendedor_verificado: a.vendedor_verificado, garantia_entrada: a.garantia_entrada }));
  }
  save(s);
  log({ plataforma: P, tool: 'buscar_asientos', args, ok: true, evento: evento.id, resumen: `${resultados.length} opciones legibles` });
  if (!resultados.length) {
    return ok({ evento: evento.nombre, resultados: [], mensaje: `No hay ${args.cantidad} asientos juntos para ${evento.nombre}${args.precio_max ? ` por debajo de $${args.precio_max}` : ''}. Prueba sin precio_max o con juntos=false.` });
  }
  return ok({ evento: evento.nombre, evento_id: evento.id, resultados, siguiente_paso: 'Aparta un bloque con apartar_asientos (no cobra nada; dura 10 minutos).' });
});

server.registerTool('apartar_asientos', {
  title: 'Apartar asientos',
  description:
    'Aparta asientos durante 10 minutos SIN cobrar. Usa el evento_id y los asientos_ids de buscar_asientos. ' +
    'Envía una clave_idempotencia única por intento de compra: si reintentas con la misma clave no se duplica el apartado. ' +
    'Después muestra el resumen al usuario y pídele confirmación antes de generar_enlace_de_pago.',
  inputSchema: {
    evento_id: z.string().describe('El mismo evento_id que usaste en buscar_asientos'),
    asientos_ids: z.array(z.string()).min(1).describe('Ej. ["112-F-7","112-F-8"]'),
    clave_idempotencia: z.string().min(4).describe('Cualquier texto único, ej. "aficionado-clasico-001"'),
  },
}, async (args) => {
  const s = load();
  expirarApartados(s);

  const previo = s.reventa.apartados.find((a) => a.clave_idempotencia === args.clave_idempotencia && a.estado === 'activo');
  if (previo) {
    log({ plataforma: P, tool: 'apartar_asientos', args, ok: true, evento: previo.evento_id, resumen: `mismo apartado ${previo.apartado_id} (idempotente)`, idempotente: true });
    return ok({ ...previo, ya_existia: true, nota: 'Ya existía un apartado con esta clave; no se creó otro.' });
  }

  const evento = eventoPorId(args.evento_id);
  if (!evento) {
    log({ plataforma: P, tool: 'apartar_asientos', args, ok: false, error: 'evento_id desconocido' });
    return teach(`No conozco el evento "${args.evento_id}". Usa buscar_eventos para obtener el evento_id correcto. Los disponibles son: ${listaEventos()}.`);
  }
  const asientos = s.reventa.eventos[evento.id].asientos;

  const desconocidos = args.asientos_ids.filter((id) => !asientos[id]);
  if (desconocidos.length) {
    const deOtroEvento = new Map<Evento, string[]>();
    const inexistentes: string[] = [];
    for (const id of desconocidos) {
      const otro = eventoDelAsiento(s, id);
      if (otro) deOtroEvento.set(otro, [...(deOtroEvento.get(otro) ?? []), id]);
      else inexistentes.push(id);
    }
    const partes: string[] = [];
    if (deOtroEvento.size) {
      const detalle = [...deOtroEvento].map(([e, ids]) => `${ids.join(', ')} ${ids.length === 1 ? 'es' : 'son'} de ${e.nombre} (evento_id "${e.id}")`).join('; ');
      partes.push(`Esos asientos no son de ${evento.nombre} (evento_id "${evento.id}"): ${detalle}.`);
      partes.push(`Si el usuario quiere ${evento.nombre}, busca sus asientos con buscar_asientos y evento_id "${evento.id}". Si quería el otro partido, repite apartar_asientos con el evento_id correcto.`);
    }
    if (inexistentes.length) {
      partes.push(`No reconozco estos asientos: ${inexistentes.join(', ')}. Usa exactamente los asientos_ids que devuelve buscar_asientos (formato "112-F-7").`);
    }
    log({ plataforma: P, tool: 'apartar_asientos', args, ok: false, evento: evento.id, error: deOtroEvento.size ? 'asientos de otro evento' : 'ids desconocidos' });
    return teach(partes.join(' '), deOtroEvento.size ? { asientos_por_evento: Object.fromEntries([...deOtroEvento].map(([e, ids]) => [e.id, ids])) } : {});
  }

  const cantidad = args.asientos_ids.length;
  const precioRef = asientos[args.asientos_ids[0]].precio;
  let noDisponibles = args.asientos_ids.filter((id) => asientos[id].estado !== 'libre');

  // Chaos: the first valid hold attempt finds its seats "just sold".
  if (!noDisponibles.length && s.caos.activo && !s.caos.disparado.reventa) {
    for (const id of args.asientos_ids) asientos[id].estado = 'vendido';
    s.caos.disparado.reventa = true;
    noDisponibles = args.asientos_ids;
  }

  if (noDisponibles.length) {
    const alts = alternativas(asientos, evento, cantidad, Math.max(precioRef + 300, 1500), args.asientos_ids);
    save(s);
    const primera = alts[0];
    log({ plataforma: P, tool: 'apartar_asientos', args, ok: false, evento: evento.id, error: 'vendidos + alternativa', caos: s.caos.disparado.reventa, asientos: args.asientos_ids });
    return teach(
      `Esos ${cantidad} asientos (${noDisponibles.join(', ')}) se vendieron hace un momento.` +
        (primera ? ` Hay ${cantidad} juntos en ${primera.zona}, fila ${primera.fila}, a $${primera.precio_por_boleto.toLocaleString('es-MX')} c/u. Llama de nuevo a apartar_asientos con esos asientos_ids, el mismo evento_id y una clave_idempotencia nueva.` : ' No quedan bloques similares; ofrece al usuario buscar con juntos=false.'),
      { alternativas: alts },
    );
  }

  const apartado: Apartado = {
    apartado_id: `AP-${Math.floor(10000 + Math.random() * 90000)}`,
    clave_idempotencia: args.clave_idempotencia,
    estado: 'activo',
    evento_id: evento.id,
    evento: evento.nombre,
    asientos: args.asientos_ids,
    precio_por_boleto: precioRef,
    total: precioRef * cantidad,
    expira: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  for (const id of args.asientos_ids) asientos[id].estado = 'apartado';
  s.reventa.apartados.push(apartado);
  save(s);
  log({ plataforma: P, tool: 'apartar_asientos', args, ok: true, evento: evento.id, resumen: `apartado ${apartado.apartado_id} · $${apartado.total}`, asientos: args.asientos_ids, apartado: apartado.apartado_id });
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
  log({ plataforma: P, tool: 'consultar_apartado', args, ok: true, evento: a.evento_id, resumen: `${a.estado}, ${min} min` });
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
  log({ plataforma: P, tool: 'generar_enlace_de_pago', args, ok: true, evento: a.evento_id, resumen: `enlace para el usuario · $${a.total}` });
  return ok({ enlace: `https://reventa.demo/pagar/${a.apartado_id}`, total: a.total, nota: 'Entrega este enlace al usuario. El cobro lo confirma él.' });
});

await server.connect(new StdioServerTransport());
