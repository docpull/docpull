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
import { createMcpServer, createMcpTransport } from "./mcp.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "../public");

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
    '</.well-known/api-catalog>; rel="https://www.rfc-editor.org/info/rfc9727"',
  ].join(", "));
  res.setHeader("X-RateLimit-Limit", "1000");
  res.setHeader("X-RateLimit-Remaining", "999");
  res.setHeader("X-RateLimit-Reset", String(Math.floor(Date.now() / 1000) + 3600));
  next();
});

// ── RFC 9727 API catalog with correct content-type ─────────────────────────
app.get("/.well-known/api-catalog", (_req, res) => {
  res.setHeader("Content-Type", 'application/linkset+json;profile="https://www.rfc-editor.org/info/rfc9727"');
  res.json({
    linkset: [{
      anchor: "https://docpull.ai",
      item: [{ href: "https://docpull.ai/openapi.json", type: "application/openapi+json", title: "docpull OpenAPI 3.1" }],
      "service-desc": [{ href: "https://docpull.ai/openapi.json", type: "application/openapi+json" }],
      describedby: [{ href: "https://docpull.ai/llms.txt", type: "text/plain" }],
    }]
  });
});

// ── RFC 9728 OAuth protected resource with correct content-type ────────────
app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json({
    resource: "https://docpull.ai",
    resource_name: "docpull API",
    resource_description: "PDF to Markdown extraction API. Uses x402 v2 micropayments instead of OAuth.",
    bearer_methods_supported: [],
    scopes_supported: [],
    authorization_servers: [],
    x402_payment: {
      protocol: "x402",
      version: 2,
      network: "eip155:8453",
      asset: USDC_BASE,
      facilitator: "https://api.cdp.coinbase.com/platform/v2/x402/facilitator",
    }
  });
});

// ── x402 discovery/resources endpoint ─────────────────────────────────────
app.get("/discovery/resources", (_req, res) => {
  res.json({
    resources: [{
      url: `${BASE_URL}/extract`,
      method: "POST",
      description: "PDF to Markdown extraction. POST {url} to extract any PDF.",
      payment: {
        protocol: "x402",
        version: 2,
        network: NETWORK,
        amount: "1000",
        asset: USDC_BASE,
        payTo: WALLET_ADDRESS,
      }
    }]
  });
});

// ── ?mode=agent BEFORE static files ───────────────────────────────────────
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
      llmsFull: "https://docpull.ai/llms-full.txt",
      apiDocs: "https://docpull.ai/api/llms.txt",
      docs: "https://docpull.ai/docs/llms.txt",
      aiPlugin: "https://docpull.ai/.well-known/ai-plugin.json",
      agentCard: "https://docpull.ai/.well-known/agent-card.json",
      apiCatalog: "https://docpull.ai/.well-known/api-catalog",
      bazaar: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=pdf+extraction",
    },
    rateLimits: {
      requestsPerHour: 1000,
      headers: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    },
  });
});

// ── Accept: text/markdown ──────────────────────────────────────────────────
app.get("/", (req, res, next) => {
  const acceptHeader = req.headers["accept"] || "";
  if (!acceptHeader.includes("text/markdown")) return next();
  res.setHeader("Content-Type", "text/markdown");
  res.setHeader("Vary", "Accept");
  res.sendFile("index.md", { root: publicDir });
});

// ── Serve homepage explicitly with correct content-type ───────────────────
app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.sendFile("index.html", { root: publicDir });
});

// ── /schema.json — standalone JSON-LD for scanners ────────────────────────
app.get("/schema.json", (_req, res) => {
  res.setHeader("Content-Type", "application/ld+json");
  res.json({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": "https://docpull.ai/#app",
        "name": "docpull",
        "url": "https://docpull.ai",
        "description": "PDF to Markdown API for AI agents. Pay $0.001 USDC per page via x402 v2. No accounts, no API keys, no subscriptions.",
        "applicationCategory": "DeveloperApplication",
        "operatingSystem": "Any",
        "offers": { "@type": "Offer", "price": "0.001", "priceCurrency": "USDC" },
        "sameAs": ["https://github.com/docpull/docpull"]
      },
      {
        "@type": "Organization",
        "@id": "https://docpull.ai/#org",
        "name": "docpull",
        "url": "https://docpull.ai",
        "email": "jesse@docpull.ai",
        "sameAs": ["https://github.com/docpull/docpull"],
        "contactPoint": { "@type": "ContactPoint", "email": "jesse@docpull.ai", "contactType": "technical support" }
      },
      {
        "@type": "FAQPage",
        "@id": "https://docpull.ai/#faq",
        "mainEntity": [
          { "@type": "Question", "name": "How much does docpull cost?", "acceptedAnswer": { "@type": "Answer", "text": "$0.001 USDC per page via x402 on Base mainnet. No subscriptions or API keys." } },
          { "@type": "Question", "name": "Do I need an API key?", "acceptedAnswer": { "@type": "Answer", "text": "No API keys or accounts needed. Any agent with a Base wallet and USDC can call it immediately." } }
        ]
      }
    ]
  });
});

// ── /.well-known/mcp discovery (must be before static files) ─────────────
app.get("/.well-known/mcp", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json({
    mcpServers: {
      docpull: {
        type: "streamable-http",
        url: "https://docpull.ai/mcp",
        name: "docpull",
        description: "PDF to Markdown extraction API for AI agents"
      }
    }
  });
});

// ── Static files ───────────────────────────────────────────────────────────
app.use(express.static(publicDir));

// ── /docs redirect + well-known openapi ───────────────────────────────────
app.get("/docs", (_req, res) => res.sendFile("docs/llms.txt", { root: publicDir }));
app.get("/.well-known/openapi.json", (_req, res) => res.sendFile("openapi.json", { root: publicDir }));
app.get("/developers", (_req, res) => res.sendFile("docs/llms.txt", { root: publicDir }));

// ── Trust anchor pages (without .html extension) ──────────────────────────
app.get("/about", (_req, res) => res.sendFile("about.html", { root: publicDir }));
app.get("/contact", (_req, res) => res.sendFile("contact.html", { root: publicDir }));
app.get("/privacy", (_req, res) => res.sendFile("privacy.html", { root: publicDir }));
app.get("/pricing", (_req, res) => res.sendFile("pricing.md", { root: publicDir }));

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

// ── MCP endpoint (Streamable HTTP) ────────────────────────────────────────
app.all("/mcp", async (req, res) => {
  try {
    const server = createMcpServer();
    const transport = createMcpTransport();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "MCP server error", code: "MCP_ERROR" });
    }
  }
});

// ── Health check ───────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "docpull", version: "1.0.0" });
});

// ── Probe ──────────────────────────────────────────────────────────────────
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

// PATCH: this gets appended to server.js above - see full rewrite below
