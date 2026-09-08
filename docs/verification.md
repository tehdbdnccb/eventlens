# Verification

Verified in the build workspace on 2026-09-08:

1. Full TypeScript static verification across packages, API, and web source using a dependency-isolated verification config: PASS.
2. Quant engine compile + runtime smoke: PASS.
3. Risk engine compile + runtime smoke: PASS, including an allowed trade and an oversized-trade rejection.
4. API market-service compile + runtime smoke: PASS; 4 demo markets discovered, risk preview passed, demo trade generated.
5. The production browser build could not be executed inside this workspace because external npm package installation was unavailable in the execution environment. The source was nevertheless type-verified with dependency stubs.

After extracting locally:

```bash
npm install
npm run check
npm run dev
node scripts/smoke.mjs
```

`npm run check` is the authoritative local build/test gate.
