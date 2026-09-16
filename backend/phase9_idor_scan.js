/**
 * Phase 9 — IDOR audit: scan server.js for client-controlled financial identifiers
 */
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'src', 'server.js');
const lines = fs.readFileSync(serverPath, 'utf8').split('\n');

const patterns = [
  { re: /req\.body\.amount\b/, label: 'req.body.amount' },
  { re: /req\.body\.balance\b/, label: 'req.body.balance' },
  { re: /req\.body\.walletId\b/, label: 'req.body.walletId' },
  { re: /req\.body\.accountId\b/, label: 'req.body.accountId' },
  { re: /req\.body\.driverId\b/, label: 'req.body.driverId' },
  { re: /req\.body\.merchantId\b/, label: 'req.body.merchantId' },
  { re: /req\.body\.customerId\b/, label: 'req.body.customerId' },
  { re: /req\.body\.paymentId\b/, label: 'req.body.paymentId' },
  { re: /req\.body\.transactionId\b/, label: 'req.body.transactionId' },
  { re: /req\.body\.ledgerId\b/, label: 'req.body.ledgerId' },
  { re: /req\.body\.refundId\b/, label: 'req.body.refundId' },
  { re: /req\.body\.payoutId\b/, label: 'req.body.payoutId' },
  { re: /req\.body\.jobId\b/, label: 'req.body.jobId' },
  { re: /req\.body\.orderId\b/, label: 'req.body.orderId' },
  // Also catch destructured equivalents
  { re: /\{\s*[^}]*\bamount\b[^}]*\}\s*=\s*req\.body/, label: 'destructured amount from req.body' },
  { re: /\{\s*[^}]*\bpaymentId\b[^}]*\}\s*=\s*req\.body/, label: 'destructured paymentId from req.body' },
  { re: /\{\s*[^}]*\bjobId\b[^}]*\}\s*=\s*req\.body/, label: 'destructured jobId from req.body' },
  // wallet mutation patterns
  { re: /adjust_wallet\b/, label: 'adjust_wallet call' },
  { re: /wallet_balance\s*[+\-=]/, label: 'direct wallet_balance mutation' },
  { re: /balance\s*[+\-]=/, label: 'balance += / -=' },
  // Float arithmetic around money
  { re: /parseFloat\(.*(?:amount|fee|price|fare|refund|balance)/i, label: 'parseFloat on financial value' },
];

const results = {};
patterns.forEach(p => {
  results[p.label] = [];
});

lines.forEach((line, idx) => {
  patterns.forEach(p => {
    if (p.re.test(line)) {
      results[p.label].push({ line: idx + 1, content: line.trim().substring(0, 100) });
    }
  });
});

console.log('\n=== Phase 9 IDOR & Financial Pattern Scan (server.js) ===\n');
Object.entries(results).forEach(([label, hits]) => {
  if (hits.length > 0) {
    console.log(`\n[${label}] — ${hits.length} occurrence(s):`);
    hits.slice(0, 10).forEach(h => console.log(`  L${h.line}: ${h.content}`));
    if (hits.length > 10) console.log(`  ... and ${hits.length - 10} more`);
  }
});
console.log('\n=== Scan Complete ===');
