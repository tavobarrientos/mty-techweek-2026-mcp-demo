# Demo: boletera oficial vs reventa

Dos servidores MCP venden boletos para el mismo partido ficticio (Clásico Regio). Mismo agente, mismo modelo, misma petición. Todo corre local, sin base de datos; solo el modelo necesita internet.

| | Boletera oficial | Reventa |
|---|---|---|
| Diseño | Malo a propósito | Las cuatro reglas |
| Herramientas | `get_ev`, `get_seats`, `hold`, `buy` | `buscar_eventos`, `buscar_asientos`, `apartar_asientos`, `consultar_apartado`, `generar_enlace_de_pago` |
| Respuestas | Blob crudo (`st`, `p` en centavos, `7731-112G03`) | Bloques legibles con precio vs nominal, vendedor verificado, garantía |
| Error al venderse | `{"error":409,"code":"SOLD_OUT"}` | "Se vendieron… hay 4 juntos en la 114, fila C, a $1,420. Llama de nuevo con estos ids" |
| Reintentos | Duplica holds | Clave de idempotencia |
| Cobro | `buy` cobra sin preguntar | Solo genera enlace; paga el usuario |
| Precio | $1,200 | $1,380 |

## 1. Instalar (una vez, 2 min)

Requiere Node 22.18 o superior (`node -v`).

```bash
cd demo-boletos
npm install
npm run smoke
```

`smoke` levanta los dos servidores, recorre la demo completa con caos y verifica 23 piezas (incluida la búsqueda de partidos). Debe terminar en `✓ Todo listo`.

## 2. Conectar el agente

### Opción A: Claude Desktop (recomendada para el escenario)

1. Abre el archivo de configuración:
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Copia el bloque `mcpServers` de `claude_desktop_config.example.json` y cambia las rutas por la ruta **absoluta** de tu carpeta (en Windows con `\\`).
3. Cierra Claude Desktop por completo (también desde la bandeja) y vuelve a abrirlo.
4. En un chat nuevo, en el menú de herramientas deben aparecer **boletera-oficial** (4 herramientas) y **reventa** (5). Deja activas las dos.
5. Desactiva otros conectores y la búsqueda web en ese chat para que el agente solo use estas dos plataformas.

### Opción B: Claude Code

```bash
cd demo-boletos/escenario
claude
```

La carpeta `escenario/` ya trae `.mcp.json` con los dos servidores y `.claude/settings.json` que aprueba sus herramientas y **bloquea** leer archivos, bash y web. Así el agente no puede "hacer trampa" leyendo el código de los servidores. Verifica con `/mcp` que los dos aparezcan conectados.

No abras Claude Code en la raíz `demo-boletos/`: ahí vería el código fuente.

## 3. Antes de subir al escenario

```bash
npm run caos     # reinicia inventario con caos ACTIVO
npm run watch    # en una segunda terminal visible: cada llamada del agente en vivo
```

- Caos activo = el **primer** intento de apartar en cada plataforma encuentra los asientos recién vendidos. Es automático y repetible; no tienes que correr nada a mitad de la demo.
- Letra grande en la terminal de `watch` (≥ 20 pt). Ahí la sala ve `OFICIAL ✗ 409 SOLD_OUT` contra `REVENTA ✗ vendidos + alternativa` y luego `REVENTA ✓ apartado`.
- Chat nuevo en el agente, sin historial.

## 4. En vivo

Petición (cópiala tal cual):

> Consígueme 4 boletos juntos para el clásico, zona baja, menos de $1,500 cada uno. Revisa la boletera oficial y la reventa. Apártalos y pregúntame antes de comprar.

Qué suele pasar y qué decir:

1. **Busca en las dos.** "Miren lo que le regresa la oficial: `st: 1`, `p: 120000`, `7731-112G03`. Y la reventa: asientos, precio contra nominal, garantía."
2. **Intenta apartar.** Probablemente primero en la oficial porque es más barata. Cae el caos: `409 SOLD_OUT`. "No le dijo qué hacer."
3. **Reventa:** se vendieron los 112-F, pero el error le ofrece la 114-C. El agente aparta y te pregunta si confirmas.
4. **Remate:** "Compró en la reventa. Más cara. No por precio: porque la pudo usar."
5. Responde "no, gracias" o "sí" (si dice sí, solo genera un enlace; nunca cobra).

Si el agente logra recuperarse en la oficial (a veces descifra el blob y aparta el bloque 114-D), dilo con honestidad: "Lo logró, pero miren cuántas llamadas y errores le costó". El marcador lo va a mostrar.

Si el agente usa `buy` en la oficial, es tu mejor momento de la regla 4: "Acaba de cobrar sin preguntarle a nadie". `watch` lo marca como `COBRO SIN CONFIRMACIÓN`.

## 5. El marcador (slide 16)

```bash
npm run score
```

Imprime la tabla y el bloque `<Matrix>` listo para pegar en `slides/16-marcador.mdx`, con `tie` automático donde empaten. Sale de `logs/run.jsonl`, es decir, de la corrida real.

Recomendación: corre la demo 2 o 3 veces esta tarde (con `npm run caos` antes de cada una), graba la mejor y usa su marcador en el slide. En vivo, el marcador del slide es el de la grabación; dilo así.

## 6. Grabar el respaldo

1. `npm run caos` y chat nuevo.
2. Graba pantalla completa con el chat a la izquierda y `npm run watch` a la derecha.
3. Guarda como `assets/video/demo.mp4` en el deck.
4. Plan B en vivo: si en 30 s el agente no responde, pasa al video y narra igual.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run smoke` | Verificación completa; deja inventario limpio |
| `npm run caos` | Reinicia inventario y log con caos activo |
| `npm run reset` | Reinicia sin caos |
| `npm run watch` | Vista en vivo de las llamadas |
| `npm run score` | Marcador + bloque para el slide 16 |
| `npm run vender -- reventa clasico-regio-2026 114-C-5..8` | Vende asientos a mano (caos manual); el evento va por `evento_id` o código oficial |

## Si algo falla

- **No aparecen los servidores en Claude Desktop:** ruta no absoluta, `\` sin duplicar en Windows, o no cerraste Desktop por completo. Prueba la ruta con `node C:\...\src\server-reventa.ts`: debe quedarse esperando sin error (Ctrl+C para salir).
- **`node` no se encuentra desde Desktop:** usa la ruta completa a node en `command`, por ejemplo `C:\\Program Files\\nodejs\\node.exe`.
- **El caos ya no se dispara:** ya se usó en esta corrida. `npm run caos` y chat nuevo.
- **El agente no revisa la oficial:** la petición la menciona; si aun así no, di "revisa también la boletera oficial".
- **`watch` no muestra nada:** córrelo desde la carpeta `demo-boletos/` (no desde `escenario/`).

## Inventario

Hay 6 partidos. El Clásico Regio es el de la demo; los otros 5 son partidos reales de local en Monterrey del Apertura 2026 de la Liga MX (hora del centro de México). Las plataformas, los asientos y los precios son ficticios. En la oficial, los asientos llevan el número de evento como prefijo sin explicar (`7731-112G03`). Zonas 1xx = Zona Baja; 2xx = Zona Alta.

| Partido | Jornada | Fecha | Estadio | `evento_id` (reventa) | Código (oficial) |
|---|---|---|---|---|---|
| Clásico Regio | — | jue 1 oct, 20:00 | Universitario | `clasico-regio-2026` | `EV-7731` |
| Tigres vs Toluca | 11 | vie 9 oct, 21:00 | Universitario | `tigres-toluca-2026-10-09` | `EV-7732` |
| Rayados vs Pachuca | 12 | dom 18 oct, 19:00 | BBVA | `rayados-pachuca-2026-10-18` | `EV-7733` |
| Tigres vs León | 13 | mar 20 oct, 21:00 | Universitario | `tigres-leon-2026-10-20` | `EV-7734` |
| Rayados vs Chivas | 14 | sáb 24 oct, 19:00 | BBVA | `rayados-chivas-2026-10-24` | `EV-7735` |
| Rayados vs Tijuana | 15 | sáb 31 oct, 20:00 | BBVA | `rayados-tijuana-2026-10-31` | `EV-7736` |

**Clásico Regio** (el de la demo)
- Oficial ($1,200): 112-G 3–6, 114-D 10–13 (juntos); 112-H 2 y 9, 112-J 5 y 14 (sueltos).
- Reventa: 112-F 7–10 $1,380 · 114-C 5–8 $1,420 · 112-B 1–4 $2,900 · 114-K 11 y 14 $1,100 (sueltos, vendedor sin verificar).

**Tigres vs Toluca** (normal)
- Oficial ($950): 111-C 4–7 (juntos); 113-F 8–10; 111-D 15 y 113-H 2 (sueltos).
- Reventa: 111-E 3–6 $1,150 · 113-G 10–13 $1,250 · 115-B 1–2 $1,900 · 215-M 20 y 22 $700 (sueltos, sin verificar).

**Rayados vs Pachuca** (mucha disponibilidad)
- Oficial ($850): 105-A a 105-D 1–12, 106-B 1–10, 205-F 1–20.
- Reventa: 105-E 1–4 $950 · 106-D 5–8 $990 · 107-C 1–6 $1,050 · 108-A 1–4 $1,800 · 205-H 10–13 $600 · 107-J 3 y 9 $800 (sin verificar).

**Tigres vs León** (la reventa es más barata que la oficial)
- Oficial ($1,000): 114-E 1–4, 116-B 7–10.
- Reventa: 114-F 3–6 $780 · 116-C 1–4 $820 · 112-K 9–12 $850 (todos verificados).

**Rayados vs Chivas** (casi agotado)
- Oficial ($1,400): solo 104-K 7, 109-B 15 y 210-F 2, sueltos.
- Reventa: 104-L 11–12 $3,200 · 109-C 4 $2,950 · 211-R 5–8 $2,400 (único bloque de 4, Zona Alta) · 212-P 18–19 $1,800 (sin verificar).

**Rayados vs Tijuana** (no hay 4 juntos en Zona Baja)
- Oficial ($900): 103-D 1–2 y 5–6, 107-G 9–11 y 14 (Zona Baja); 203-J 1–6 (Zona Alta).
- Reventa: 103-E 2–3 $1,000 · 103-E 6–8 $1,050 · 107-H 1–2 $1,100 · 108-M 5 $950 · 203-K 10–13 $700 (Zona Alta).

El modo caos no distingue partido: el primer apartado válido en cada plataforma encuentra sus asientos recién vendidos, sea del partido que sea.

Los apartados de la reventa expiran a los 10 min; los holds de la oficial nunca (otro mal hábito).
