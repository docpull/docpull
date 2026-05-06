# docpull

PDF to Markdown API for AI agents. Pay $0.001 USDC per page via x402 v2. No accounts, no API keys, no subscriptions.

Live at: https://docpull.ai
GitHub: https://github.com/docpull/docpull

## Endpoints

- GET /health — Service health check (free)
- GET /probe?url=<pdf_url> — Page count and cost estimate (free)
- POST /extract — PDF to Markdown extraction (x402 payment required)

## Quick start

```bash
# Check cost
curl "https://docpull.ai/probe?url=https://example.com/doc.pdf"

# Extract (requires x402 payment via compatible client)
curl -X POST https://docpull.ai/extract \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/doc.pdf"}'
```

## Pricing

$0.001 USDC per page on Base mainnet. See /pricing.md for full details.

## Links

- OpenAPI: https://docpull.ai/openapi.json
- Docs: https://docpull.ai/llms.txt
- Pricing: https://docpull.ai/pricing.md
