# AGENTS.md — docpull

## What this repo is

docpull is a PDF-to-Markdown API microservice for AI agents. It accepts any publicly accessible PDF URL and returns structured Markdown text, charged at $0.001 USDC per page via the x402 v2 payment protocol.

## Architecture

- `src/server.js` — Express server, x402 middleware, route handlers
- `src/extractor.js` — PDF fetch + pdfjs-dist extraction logic
- `public/` — Static files (landing page, agent discovery files)
- `Dockerfile` — Node 20 Alpine container
- `railway.toml` — Railway deployment config

## Key files for agents

- `public/openapi.json` — Full OpenAPI 3.1 spec
- `public/llms.txt` — Plain-text product description
- `public/.well-known/ai-plugin.json` — OpenAI plugin manifest
- `public/.well-known/agent.json` — Generic agent discovery
- `public/.well-known/agent-card.json` — A2A agent card

## Environment variables required

- `WALLET_ADDRESS` — USDC-receiving wallet on Base mainnet
- `BASE_URL` — Public HTTPS URL of the service
- `CDP_API_KEY_ID` — Coinbase Developer Platform API key ID
- `CDP_API_KEY_SECRET` — Coinbase Developer Platform API key secret

## How to run locally

```bash
npm install
cp .env.example .env  # fill in env vars
npm run dev
```

## How to test the payment flow

```bash
node test-payment.mjs  # requires EVM_PRIVATE_KEY env var with USDC on Base
```

## Payment protocol

docpull uses x402 v2. The `/extract` endpoint returns HTTP 402 with a `PAYMENT-REQUIRED` header (base64 JSON) when called without payment. Use `@x402/fetch` with a viem signer to pay automatically.
