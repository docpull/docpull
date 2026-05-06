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
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const NETWORK = "eip155:8453";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

if (!WALLET_ADDRESS) {
  console.error("❌ WALLET_ADDRESS env var is required");
  process.exit(1);
}

// ── x402 v2 resource server with CDP facilitator + Bazaar extension ─────────
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
  input: { url: "https://pdfobject.com/pdf/sample.pdf" },
  inputSchema: {
    properties: {
      url: {
        type: "string",
        description: "Publicly accessible URL of the PDF to extract",
      },
    },
    required: ["url"],
  },
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
      },
      "POST /extract": {
        accepts,
        description: "PDF to Markdown extraction API. POST {url} to extract any PDF. $0.001 per page.",
        mimeType: "application/json",
        extensions: { ...bazaarExtension },
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
  if (!url) return res.status(400).json({ error: "url query param required" });
  try {
    const pageCount = await getPageCount(url);
    const costUSDC = (pageCount * 0.001).toFixed(6);
    res.json({ pageCount, costUSDC, pricePerPage: "0.001 USDC" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /extract (gated) ───────────────────────────────────────────────────
app.get("/extract", (_req, res) => {
  res.json({
    info: "POST to /extract with {url} body to extract a PDF to markdown.",
    pricing: "$0.001 USDC per page",
    probe: "GET /probe?url=<pdf_url> for free page count and cost estimate",
  });
});

// ── POST /extract (gated) ──────────────────────────────────────────────────
app.post("/extract", async (req, res, next) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url body field required" });
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

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`✅ docpull listening on port ${PORT}`);
  console.log(`   Wallet : ${WALLET_ADDRESS}`);
  console.log(`   Network: ${NETWORK}`);
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Facilitator: CDP v2 + Bazaar extension`);
});
