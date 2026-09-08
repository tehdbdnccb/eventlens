# EventLens Architecture

React/Vite UI → Fastify API → market service → quant engine + risk engine → DreamDEX adapter.

State is keyed by marketId. The protocol's per-window pool addresses are not application identities. Demo mode supplies deterministic markets and order books. The DreamDEX package contains the SDK dependency and constants needed for a future live adapter.

## Signal

`score = .55*edge + .20*OBI + .10*momentum + .15*termStructure`

Risk gates enforce market status, expiry headroom, edge, confidence, size, exposure, liquidity and estimated slippage.
