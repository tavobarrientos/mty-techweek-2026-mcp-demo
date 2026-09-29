# Demo: boletera oficial vs reventa

Dos servidores MCP venden boletos para el mismo partido ficticio (Clásico Regio). Mismo agente, mismo modelo, misma petición. Todo corre local, sin base de datos; solo el modelo necesita internet.

| | Boletera oficial | Reventa |
|---|---|---|
| Diseño | Malo a propósito | Las cuatro reglas |
| Herramientas | `get_ev`, `get_seats`, `hold`, `buy` | `buscar_eventos`, `buscar_asientos`, `apartar_asientos`, `consultar_apartado`, `generar_enlace_de_pago` |
| Respuestas | Blob crudo (`st`, `p` en centavos, `112G03`) | Bloques legibles con precio vs nominal, vendedor verificado, garantía |
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

`smoke` levanta los dos servidores, recorre la demo completa con caos y verifica las 12 piezas. Debe terminar en `✓ Todo listo`.

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

1. **Busca en las dos.** "Miren lo que le regresa la oficial: `st: 1`, `p: 120000`, `112G03`. Y la reventa: asientos, precio contra nominal, garantía."
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
| `npm run vender -- reventa 114-C-5..8` | Vende asientos a mano (caos manual) |

## Si algo falla

- **No aparecen los servidores en Claude Desktop:** ruta no absoluta, `\` sin duplicar en Windows, o no cerraste Desktop por completo. Prueba la ruta con `node C:\...\src\server-reventa.ts`: debe quedarse esperando sin error (Ctrl+C para salir).
- **`node` no se encuentra desde Desktop:** usa la ruta completa a node en `command`, por ejemplo `C:\\Program Files\\nodejs\\node.exe`.
- **El caos ya no se dispara:** ya se usó en esta corrida. `npm run caos` y chat nuevo.
- **El agente no revisa la oficial:** la petición la menciona; si aun así no, di "revisa también la boletera oficial".
- **`watch` no muestra nada:** córrelo desde la carpeta `demo-boletos/` (no desde `escenario/`).

## Inventario

- Oficial ($1,200): 112-G 3–6, 114-D 10–13 (juntos); 112-H 2 y 9, 112-J 5 y 14 (sueltos).
- Reventa: 112-F 7–10 $1,380 · 114-C 5–8 $1,420 · 112-B 1–4 $2,900 · 114-K 11 y 14 $1,100 (sueltos, vendedor sin verificar).
- Los apartados de la reventa expiran a los 10 min; los holds de la oficial nunca (otro mal hábito).
