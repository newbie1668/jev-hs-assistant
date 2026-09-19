import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "fixtures");
mkdirSync(fixtures, { recursive: true });

function escapePdf(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(line, width = 85) {
  if (line.length <= width) return [line];
  const out = [];
  let rest = line;
  while (rest.length > width) {
    let breakAt = rest.lastIndexOf(" ", width);
    if (breakAt < 40) breakAt = width;
    out.push(rest.slice(0, breakAt));
    rest = rest.slice(breakAt).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

function buildPdf(body) {
  const lines = body.split("\n").flatMap((l) => wrap(l));
  const contentLines = ["BT", "/F1 10 Tf", "40 760 Td", "13 TL"];
  for (let i = 0; i < lines.length; i++) {
    const esc = escapePdf(lines[i]);
    contentLines.push(i === 0 ? `(${esc}) Tj` : `T* (${esc}) Tj`);
  }
  contentLines.push("ET");
  const streamText = contentLines.join("\n");
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj",
    `4 0 obj<< /Length ${Buffer.byteLength(streamText)} >>\nstream\n${streamText}\nendstream\nendobj`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const o of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += o + "\n";
  }
  const xrefStart = Buffer.byteLength(pdf);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const laptop = `COMMERCIAL INVOICE
Seller: Northwind Electronics Ltd
Buyer: Contoso Retail GmbH
Invoice No: INV-2026-4412
Description of goods: Portable automatic data processing machines, weighing not more than 10 kg, consisting of at least a central processing unit, a keyboard and a display - 50 units of 14-inch business laptops (ADP machines).
HS hint from supplier (unverified): chapter 84
Net weight: 62 kg
Country of origin: TW`;

writeFileSync(join(fixtures, "sample-laptop-invoice.pdf"), buildPdf(laptop));

const emptyStream = "BT ET";
const objs = [
  "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj",
  "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj",
  "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< >> >>endobj",
  `4 0 obj<< /Length ${emptyStream.length} >>\nstream\n${emptyStream}\nendstream\nendobj`,
];
let pdf2 = "%PDF-1.4\n";
const off2 = [0];
for (const o of objs) {
  off2.push(Buffer.byteLength(pdf2));
  pdf2 += o + "\n";
}
const xref2Start = Buffer.byteLength(pdf2);
let xref2 = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= objs.length; i++) {
  xref2 += `${String(off2[i]).padStart(10, "0")} 00000 n \n`;
}
pdf2 += xref2 + `trailer<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref2Start}\n%%EOF\n`;
writeFileSync(join(fixtures, "sample-empty-scan.pdf"), Buffer.from(pdf2, "latin1"));
console.log("wrote fixtures/");
