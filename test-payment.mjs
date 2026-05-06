import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
if (!EVM_PRIVATE_KEY) {
  console.error("❌ EVM_PRIVATE_KEY env var is required");
  process.exit(1);
}

const signer = privateKeyToAccount(EVM_PRIVATE_KEY);
console.log(`🔑 Using wallet: ${signer.address}`);

const client = new x402Client()
  .register("eip155:*", new ExactEvmScheme(signer));

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

console.log("📤 Sending paid request to docpull.ai/extract...");

const res = await fetchWithPayment("https://docpull.ai/extract", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: "https://pdfobject.com/pdf/sample.pdf" }),
});

console.log(`📥 Status: ${res.status}`);
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
