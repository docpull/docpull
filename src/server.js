import express from "express";
import { paymentMiddleware } from "x402-express";
import { facilitator } from "x402-express";
import { extractPdfToMarkdown } from "./extractor.js";
import { getPageCount } from "./extractor.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const NETWORK = process.env.NETWORK || "base";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

if (!WALLET_ADDRESS) {
  console.error("❌ WALLET_ADDRESS env var is required");
  process.exit(1);
}

// ── Health check (free) ────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "docpull", version: "1.0.0" });
});

// ── Page-count probe (free) ─────────────────────────────────────────────────
// Lets callers calculate cost before committing payment
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

// ── x402 facilitator endpoint (required by protocol) ───────────────────────
app.post(
  "/facilitator",
  facilitator({ network: NETWORK, walletAddress: WALLET_ADDRESS })
);

// ── Dynamic payment middleware factory ─────────────────────────────────────
// We need dynamic pricing (pages × $0.001), so we wrap the middleware per-request
app.post("/extract", async (req, res, next) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url body field required" });

  let pageCount;
  try {
    pageCount = await getPageCount(url);
  } catch (err) {
    return res.status(400).json({ error: `Cannot fetch PDF: ${err.message}` });
  }

  // Price in USDC atomic units (6 decimals). $0.001 = 1000 units
  const priceAtomicUSDC = pageCount * 1000; // 1000 = $0.001 in 6-decimal USDC

  const middleware = paymentMiddleware(
    WALLET_ADDRESS,
    {
      [`POST ${BASE_URL}/extract`]: {
        price: `$${(pageCount * 0.001).toFixed(6)}`,
        network: NETWORK,
        config: { description: `PDF extraction – ${pageCount} pages` },
      },
    },
    {
      url: `${BASE_URL}/facilitator`,
    }
  );

  // Run x402 middleware, then fall through to handler
  middleware(req, res, async () => {
    try {
      const markdown = await extractPdfToMarkdown(url);
      res.json({
        success: true,
        pageCount,
        markdown,
        charCount: markdown.length,
      });
    } catch (err) {
      next(err);
    }
  });
});

// ── Error handler ───────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`✅ docpull listening on port ${PORT}`);
  console.log(`   Wallet : ${WALLET_ADDRESS}`);
  console.log(`   Network: ${NETWORK}`);
  console.log(`   Base URL: ${BASE_URL}`);
});
