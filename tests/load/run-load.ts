/**
 * Minimal HTTP load generator (no extra dependencies). Runs fixed-duration scenarios
 * at a given concurrency and reports throughput, error rate and latency percentiles.
 *
 *   LOAD_BASE_URL=http://localhost:3200 LOAD_DURATION=20 LOAD_CONCURRENCY=20 npm run load-test
 *
 * Requires tests/load/results/fixture.json from seed-load.ts. Never point this at production.
 */
import fs from "node:fs";

const BASE = process.env.LOAD_BASE_URL ?? "http://localhost:3200";
const DURATION = Number(process.env.LOAD_DURATION ?? 20) * 1000;
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 20);
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) {
  console.error("Refusing: load tests only run against a local server.");
  process.exit(1);
}

const fixture = JSON.parse(fs.readFileSync("tests/load/results/fixture.json", "utf8")) as { email: string; password: string; tokens: string[]; employees: number };

async function login(): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: fixture.email, password: fixture.password }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const rnd = (n: number) => Math.floor(Math.random() * n);
// Distinct simulated client IPs so per-client rate limits model many verifiers, not one.
const fakeIp = () => `10.${rnd(255)}.${rnd(255)}.${rnd(255)}`;

interface Scenario {
  name: string;
  request: (i: number) => { path: string; init?: RequestInit; ok?: (status: number) => boolean };
}

async function run(s: Scenario) {
  const latencies: number[] = [];
  const statuses = new Map<number, number>();
  let errors = 0;
  let i = 0;
  const end = Date.now() + DURATION;
  const worker = async () => {
    while (Date.now() < end) {
      const { path, init, ok } = s.request(i++);
      const t = performance.now();
      try {
        const r = await fetch(BASE + path, init);
        await r.arrayBuffer();
        latencies.push(performance.now() - t);
        statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
        if (!(ok ? ok(r.status) : r.ok)) errors++;
      } catch {
        errors++;
        latencies.push(performance.now() - t);
      }
    }
  };
  const started = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const secs = (Date.now() - started) / 1000;
  const sorted = latencies.sort((a, b) => a - b);
  return {
    scenario: s.name,
    requests: sorted.length,
    rps: +(sorted.length / secs).toFixed(1),
    errorRate: +((errors / Math.max(1, sorted.length)) * 100).toFixed(2),
    p50: +pct(sorted, 50).toFixed(1),
    p95: +pct(sorted, 95).toFixed(1),
    p99: +pct(sorted, 99).toFixed(1),
    max: +(sorted.at(-1) ?? 0).toFixed(1),
    statuses: Object.fromEntries(statuses),
  };
}

async function concurrentCreate(cookie: string, n: number) {
  const t = performance.now();
  const results = await Promise.all(
    Array.from({ length: n }, (_, k) =>
      fetch(`${BASE}/api/employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: BASE, cookie },
        body: JSON.stringify({ firstName: `Load${k}`, lastName: "Concurrent", department: "QA", jobTitle: "Tester" }),
      }).then(async (r) => ({ status: r.status, code: r.ok ? ((await r.json()) as { employee: { employeeCode: string } }).employee.employeeCode : null })),
    ),
  );
  const codes = results.map((r) => r.code).filter(Boolean);
  return { scenario: `concurrent create x${n}`, ms: +(performance.now() - t).toFixed(0), created: codes.length, uniqueCodes: new Set(codes).size, statuses: results.map((r) => r.status).filter((s) => s !== 201) };
}

async function sseFanout(cookie: string, clients: number) {
  const ctrls = Array.from({ length: clients }, () => new AbortController());
  const received: number[] = [];
  let sentAt = 0;
  const readers = await Promise.all(
    ctrls.map(async (ctrl) => {
      const r = await fetch(`${BASE}/api/events`, { headers: { cookie }, signal: ctrl.signal });
      return r.body!.getReader();
    }),
  );
  const done = readers.map(async (reader) => {
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      buf += dec.decode(value);
      if (sentAt && buf.includes("event: change")) {
        received.push(performance.now() - sentAt);
        return;
      }
    }
  });
  await new Promise((r) => setTimeout(r, 1500));
  sentAt = performance.now();
  await fetch(`${BASE}/api/employees`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, cookie },
    body: JSON.stringify({ firstName: "Fanout", department: "QA", jobTitle: "Tester" }),
  });
  await Promise.race([Promise.all(done), new Promise((r) => setTimeout(r, 10_000))]);
  ctrls.forEach((c) => c.abort());
  const s = received.sort((a, b) => a - b);
  return { scenario: `SSE fan-out to ${clients} clients`, delivered: s.length, p50: +pct(s, 50).toFixed(1), p95: +pct(s, 95).toFixed(1), max: +(s.at(-1) ?? 0).toFixed(1) };
}

async function main() {
  const cookie = await login();
  const auth = { headers: { cookie } };
  const scenarios: Scenario[] = [
    { name: "directory page (default sort)", request: () => ({ path: `/api/employees?page=${1 + rnd(20)}`, init: auth }) },
    { name: "directory search by name", request: () => ({ path: `/api/employees?q=${["aarav", "meera", "khan", "isha1", "rohan2"][rnd(5)]}`, init: auth }) },
    { name: "directory search by employee ID", request: () => ({ path: `/api/employees?q=SJB-${new Date().getUTCFullYear()}-${rnd(fixture.employees)}`, init: auth }) },
    { name: "directory filtered + sorted", request: () => ({ path: `/api/employees?status=ACTIVE&department=Finance&expiry=EXPIRING_SOON&sort=name&dir=asc`, init: auth }) },
    { name: "dashboard aggregates", request: () => ({ path: "/api/dashboard", init: auth }) },
    {
      name: "public verification (valid tokens)",
      request: () => ({ path: `/api/verify/${fixture.tokens[rnd(fixture.tokens.length)]}`, init: { headers: { "x-forwarded-for": fakeIp() } } }),
    },
    {
      name: "public verification (unknown tokens)",
      request: () => ({ path: `/api/verify/${"x".repeat(10)}${Math.random().toString(36).slice(2).padEnd(33, "0").slice(0, 33)}`, init: { headers: { "x-forwarded-for": fakeIp() } } }),
    },
  ];

  const results: unknown[] = [];
  for (const s of scenarios) {
    const r = await run(s);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  for (const r of [await concurrentCreate(cookie, 25), await sseFanout(cookie, 50)]) {
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const out = { at: new Date().toISOString(), base: BASE, employees: fixture.employees, durationSec: DURATION / 1000, concurrency: CONCURRENCY, results };
  fs.writeFileSync(`tests/load/results/load-${fixture.employees}.json`, JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
