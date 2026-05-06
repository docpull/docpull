import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { facilitator } from "@coinbase/x402";
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from "@x402/extensions/bazaar";
import { extractPdfToMarkdown, getPageCount } from "./extractor.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const NETWORK = "eip155:8453";
const BASE_URL = process.env.BASE_URL || `https://localhost:${PORT}`;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

if (!WALLET_ADDRESS) {
  console.error("❌ WALLET_ADDRESS env var is required");
  process.exit(1);
}

// ── Global headers ─────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader("Link", [
    '</sitemap.xml>; rel="sitemap"',
    '</openapi.json>; rel="service-desc"; type="application/json"',
    '</index.md>; rel="alternate"; type="text/markdown"',
    '</.well-known/ai-plugin.json>; rel="ai-plugin"',
  ].join(", "));
  res.setHeader("X-RateLimit-Limit", "1000");
  res.setHeader("X-RateLimit-Remaining", "999");
  res.setHeader("X-RateLimit-Reset", Math.floor(Date.now() / 1000) + 3600);
  next();
});

// ── ?mode=agent — BEFORE static files ─────────────────────────────────────
app.get("/", (req, res, next) => {
  if (req.query.mode !== "agent") return next();
  res.setHeader("Content-Type", "application/json");
  res.json({
    name: "docpull",
    description: "PDF to Markdown API for AI agents. Pay $0.001 USDC per page via x402 v2.",
    version: "1.0.0",
    url: "https://docpull.ai",
    endpoints: {
      health: { method: "GET", path: "/health", auth: "none", description: "Service health check" },
      probe: { method: "GET", path: "/probe", auth: "none", params: { url: "string (pdf url)" }, description: "Get page count and cost estimate. Free." },
      extract: { method: "POST", path: "/extract", auth: "x402", price: "$0.001 USDC per page", description: "Extract PDF to Markdown" },
    },
    payment: {
      protocol: "x402",
      version: 2,
      network: "eip155:8453",
      asset: "USDC",
      assetAddress: USDC_BASE,
      facilitator: "https://api.cdp.coinbase.com/platform/v2/x402/facilitator",
      clientLibrary: "@x402/fetch",
    },
    discovery: {
      openapi: "https://docpull.ai/openapi.json",
      llms: "https://docpull.ai/llms.txt",
      aiPlugin: "https://docpull.ai/.well-known/ai-plugin.json",
      agentCard: "https://docpull.ai/.well-known/agent-card.json",
      bazaar: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=pdf+extraction",
    },
    rateLimits: {
      requestsPerHour: 1000,
      headers: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    },
  });
});

// ── Accept: text/markdown — BEFORE static files ───────────────────────────
app.get("/", (req, res, next) => {
  if (!req.accepts("text/markdown")) return next();
  res.setHeader("Content-Type", "text/markdown");
  res.setHeader("Vary", "Accept");
  res.sendFile("index.md", { root: "public" });
});

// ── Static files ───────────────────────────────────────────────────────────
app.use(express.static("public"));

// ── x402 v2 + CDP facilitator + Bazaar extension ───────────────────────────
const facilitatorClient = new HTTPFacilitatorClient(facilitator);
const server = new x402ResourceServer(facilitatorClient)
  .register("eip155:*", new ExactEvmScheme());

server.registerExtension(bazaarResourceServerExtension);

const accepts = [{
  scheme: "exact",
  price: "$0.001",
  network: NETWORK,
  payTo: WALLET_ADDRESS,
  asset: USDC_BASE,
  maxTimeoutSeconds: 300,
}];

const bazaarExtension = declareDiscoveryExtension({
  bodyType: "json",
  output: {
    example: {
      success: true,
      pageCount: 5,
      charCount: 8200,
      markdown: "# Document Title\n\n## Section 1\n\nBody text...",
    },
    schema: {
      properties: {
        success: { type: "boolean" },
        pageCount: { type: "number" },
        charCount: { type: "number" },
        markdown: { type: "string" },
      },
      required: ["success", "pageCount", "charCount", "markdown"],
    },
  },
});

// ── x402 middleware BEFORE route handlers ──────────────────────────────────
app.use(
  paymentMiddleware(
    {
      "GET /extract": {
        accepts,
        description: "PDF to Markdown extraction API. POST {url} to extract any PDF. $0.001 per page.",
        mimeType: "application/json",
        extensions: { ...bazaarExtension },
        resource: `${BASE_URL}/extract`,
      },
      "POST /extract": {
        accepts,
        description: "PDF to Markdown extraction API. POST {url} to extract any PDF. $0.001 per page.",
        mimeType: "application/json",
        extensions: { ...bazaarExtension },
        resource: `${BASE_URL}/extract`,
      },
    },
    server
  )
);

// ── Health check (free) ────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "docpull", version: "1.0.0" });
});

// ── Probe (free) ───────────────────────────────────────────────────────────
app.get("/probe", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url query param required", code: "MISSING_URL" });
  try {
    const pageCount = await getPageCount(url);
    const costUSDC = (pageCount * 0.001).toFixed(6);
    res.json({ pageCount, costUSDC, pricePerPage: "0.001 USDC" });
  } catch (err) {
    res.status(400).json({ error: err.message, code: "PDF_FETCH_FAILED" });
  }
});

// ── GET /extract (gated) ───────────────────────────────────────────────────
app.get("/extract", (_req, res) => {
  res.json({
    info: "POST to /extract with {url} body to extract a PDF to markdown.",
    pricing: "$0.001 USDC per page",
    probe: "GET /probe?url=<pdf_url> for free page count and cost estimate",
    openapi: "https://docpull.ai/openapi.json",
    docs: "https://docpull.ai/llms.txt",
  });
});

// ── POST /extract (gated) ──────────────────────────────────────────────────
app.post("/extract", async (req, res, next) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url body field required", code: "MISSING_URL" });
  try {
    const [markdown, pageCount] = await Promise.all([
      extractPdfToMarkdown(url),
      getPageCount(url),
    ]);
    res.json({ success: true, pageCount, markdown, charCount: markdown.length });
  } catch (err) {
    next(err);
  }
});

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error", code: "INTERNAL_ERROR" });
});

app.listen(PORT, () => {
  console.log(`✅ docpull listening on port ${PORT}`);
  console.log(`   Wallet : ${WALLET_ADDRESS}`);
  console.log(`   Network: ${NETWORK}`);
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Facilitator: CDP v2 + Bazaar extension`);
});
