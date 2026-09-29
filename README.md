# demo-boletos-mcp

Live demo for the talk **"Tu siguiente usuario es un agente"** (Monterrey AI Talks, 2026).

Two MCP servers sell tickets for the same (fictional) match:

- **`boletera-oficial`** — the bad design: cryptic names (`get_seats`, `hold`, `buy`), empty descriptions, raw blobs, opaque errors (`409 SOLD_OUT`), no idempotency, and a `buy` tool that charges without asking anyone. Cheaper: $1,200.
- **`reventa`** — the good design: clear names and descriptions, readable results (price vs face value, verified seller, guarantee), errors that suggest an alternative, idempotency keys, and payment completed only by the user. More expensive: $1,380.

Same agent, same model, same request. A "chaos" mode sells the requested seats right when the agent tries to hold them, so the audience can see which platform the agent recovers on.

```bash
npm install
npm run smoke     # pre-flight check
npm run caos      # reset inventory with chaos on
npm run watch     # live view of every tool call
npm run score     # scoreboard from the real run
```

TypeScript run directly by Node ≥ 22.18 (native type stripping), no build step. `npm run typecheck` runs `tsc`. All data is fictional. Instructions (Spanish): [INSTRUCCIONES.md](INSTRUCCIONES.md).
