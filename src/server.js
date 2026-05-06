import express from "express";
import { paymentMiddleware } from "x402-express";
import { facilitator } from "@coinbase/x402";
import { extractPdfToMarkdown, getPageCount } from "./extractor.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const NETWORK = process.env.NETWORK || "base";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

if (!WALLET_ADDRESS) {
  console.error("❌ WALLET_ADDRESS env var is required");
  process.exit(1);
}

// @coinbase/x402 facilitator reads CDP_API_KEY_ID and CDP_API_KEY_SECRET
// automatically from environment variables for verify/settle operations.
// This also enables CDP Bazaar indexing on first successful payment.

// ── Health check (free) ────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "docpull", version: "1.0.0" });
});

// ── Page-count probe (free) ────────────────────────────────────────────────
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

// ── Extract endpoint with x402 payment ────────────────────────────────────
app.post("/extract", async (req, res, next) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url body field required" });

  let pageCount;
  try {
    pageCount = await getPageCount(url);
  } catch (err) {
    return res.status(400).json({ error: `Cannot fetch PDF: ${err.message}` });
  }

  const price = `$${(pageCount * 0.001).toFixed(6)}`;

  const middleware = paymentMiddleware(
    WALLET_ADDRESS,
    {
      [`POST ${BASE_URL}/extract`]: {
        price,
        network: NETWORK,
        config: {
          description: `PDF to Markdown extraction — ${pageCount} pages`,
          mimeType: "application/json",
        },
      },
    },
    facilitator
  );

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
  console.log(`   Facilitator: CDP (Bazaar-enabled)`);
});
