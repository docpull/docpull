# AGENTS.md — docpull

docpull is a PDF-to-Markdown API microservice for AI agents. It accepts any publicly accessible PDF URL and returns structured Markdown text, charged at $0.001 USDC per page via the x402 v2 payment protocol on Base mainnet.

## Architecture

- `src/server.js` — Express server, x402 middleware, all route handlers, MCP endpoint
- `src/mcp.js` — MCP server factory (createMcpServer), 3 tools: probe_pdf, extract_pdf, health_check
- `src/extractor.js` — PDF fetch + pdfjs-dist extraction logic
- `public/` — Static files: landing page, agent discovery files, blog posts
- `Dockerfile` — Node 20 Alpine container
- `railway.toml` — Railway deployment config

## Key endpoints

- `GET /health` — health check (free)
- `GET /probe?url=<pdf_url>` — page count + cost estimate (free)
- `POST /extract` — PDF → Markdown (x402 payment required, $0.001 USDC/page)
- `POST /mcp` — MCP Streamable HTTP endpoint
- `GET /.well-known/mcp` — MCP discovery

## Agent discovery files

- `public/openapi.json` — OpenAPI 3.1 spec
- `public/llms.txt` — plain-text product description
- `public/llms-full.txt` — complete docs in one file
- `public/.well-known/ai-plugin.json` — OpenAI plugin manifest
- `public/.well-known/agent.json` — generic agent discovery
- `public/.well-known/agent-card.json` — A2A agent card
- `public/.well-known/mcp/server-card.json` — MCP server card
- `public/.well-known/api-catalog` — RFC 9727 API catalog

## Environment variables

- `WALLET_ADDRESS` — USDC-receiving wallet on Base mainnet (required)
- `BASE_URL` — public HTTPS URL of the service (required)
- `CDP_API_KEY_ID` — Coinbase Developer Platform API key ID (required)
- `CDP_API_KEY_SECRET` — Coinbase Developer Platform API key secret (required)
- `PORT` — port number (Railway sets automatically)

## Running locally

```bash
npm install
cp .env.example .env  # fill in env vars
npm run dev
```

## Testing the payment flow

```bash
EVM_PRIVATE_KEY=0xYourKey node test-payment.mjs
```

Requires a wallet with USDC on Base mainnet. Use the free /probe endpoint first.

## Payment protocol

docpull uses x402 v2. POST /extract returns HTTP 402 with a PAYMENT-REQUIRED header (base64 JSON) when called without payment. Use @x402/fetch with a viem signer to pay automatically.

## Competitors and positioning

docpull is the only hosted PDF extraction API with x402 v2 support. Unlike BlazeDocs, pdfRest, LandingAI, and Docling, it requires no accounts, no API keys, and no subscriptions. See https://docpull.ai/compare for full comparison.
