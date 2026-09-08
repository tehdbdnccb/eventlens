# EventLens — DreamDEX Event Contract Intelligence

EventLens is a quantitative intelligence layer for Somnia DreamDEX Event Contracts. It detects probability dislocations instead of relying on a single black-box prediction.

## Verified build

- Node.js 20+
- npm workspaces monorepo
- React + Vite + TypeScript UI
- Fastify TypeScript API
- Quant + risk + DreamDEX adapter packages
- Vitest unit tests
- Demo/replay mode works without a wallet or private key
- Live DreamDEX SDK dependency is isolated in `packages/dreamdex`

## Run

```bash
npm install
npm run check
npm run dev
```

Web: http://localhost:5173
API: http://localhost:4000/health

## Live DreamDEX integration

The current DreamDEX developer docs use `@somnia-chain/markets-sdk` and recommend 0.28.0+; this repository pins the public SDK dependency to `^0.29.0`. The live adapter boundary is deliberately separate from demo mode. Before sending a real order, wire the SDK client with a signer, validate live on-chain market status, read the latest book, and use IOC/FOK for takers.

## Product flow

DISCOVER → ANALYZE → SCORE → RISK → EXECUTE → VERIFY

## Safety

Demo mode never broadcasts transactions. Never place private keys in the frontend. Validate all live writes against on-chain state and confirm fills from receipts/events.
