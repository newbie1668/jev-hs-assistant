import fs from "node:fs";

const cases = JSON.parse(fs.readFileSync(new URL("../fixtures/eval-cases.json", import.meta.url), "utf8"));
const base = process.env.BASE ?? "http://127.0.0.1:43127";
const meta = await (await fetch(`${base}/api/meta`)).json();
console.log("mode:", meta.judgmentMode);

const rows = [];
for (const c of cases) {
  const t0 = Date.now();
  const r = await fetch(`${base}/api/suggest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: c.text, verify: true }),
  });
  const j = await r.json();
  const s = j.suggestion;
  const got = s?.hscode ?? null;
  const hs6 = c.expect.includes(got);
  const hs4 = c.expect.some((e) => got && e.slice(0, 4) === got.slice(0, 4));
  const hs2 = c.expect.some((e) => got && e.slice(0, 2) === got.slice(0, 2));
  const grade = c.expect.length === 0 ? "n/a" : hs6 ? "HS6" : hs4 ? "HS4" : hs2 ? "HS2" : "MISS";
  rows.push({
    id: c.id, group: c.group, expect: c.expect.join("|"), got, grade,
    desc: s?.description?.slice(0, 60) ?? j.error,
    conf: s?.confidence?.toFixed(2), ver: s?.verification?.matchProbability?.toFixed(2),
    pass: s?.verification?.passed, rerank: s?.verificationRerank?.from ?? "",
    stated: s?.documentStated?.hs6 ?? s?.documentStated?.code ?? "", agree: s?.documentStated?.agrees,
    ms: Date.now() - t0, cost: j.trace?.totalCostUsd?.toFixed(5), note: c.note ?? "",
  });
  const last = rows[rows.length - 1];
  console.log(`${last.grade.padEnd(4)} ${c.id.padEnd(24)} exp ${last.expect.padEnd(20)} got ${got} conf ${last.conf} ver ${last.ver} ${last.pass ? "pass" : "FAIL"} ${last.rerank ? "rerank<-" + last.rerank : ""} ${last.ms}ms | ${last.desc}`);
}
fs.writeFileSync("eval-results.json", JSON.stringify({ mode: meta.judgmentMode, rows }, null, 1));
const graded = rows.filter((r) => r.grade !== "n/a");
const count = (g) => graded.filter((r) => r.grade === g).length;
console.log(`\nHS6 exact ${count("HS6")}/${graded.length}  HS4 ${count("HS4")}  HS2 ${count("HS2")}  MISS ${count("MISS")}`);
console.log("verification failed:", rows.filter((r) => r.pass === false).map((r) => r.id).join(", "));
console.log("wrong but verification passed:", graded.filter((r) => r.grade !== "HS6" && r.pass).map((r) => `${r.id}(${r.grade})`).join(", "));
