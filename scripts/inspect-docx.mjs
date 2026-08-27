import PizZip from "pizzip";
import fs from "node:fs";

const xml = new PizZip(fs.readFileSync(process.argv[2])).file("word/document.xml").asText();

console.log("bytes:", xml.length);
console.log("tables:", (xml.match(/<w:tbl>/g) || []).length);
console.log("nested tables inside cells:", /<w:tc>(?:(?!<\/w:tc>)[\s\S])*?<w:tbl>/.test(xml));

// Cell text = its runs joined. Word splits runs arbitrarily, so this is the only
// reliable way to recover what a cell actually reads as.
const cellText = (tc) => (tc.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
  .map((t) => t.replace(/<[^>]+>/g, "")).join("").replace(/\s+/g, " ").trim();

let t = 0;
for (const tbl of xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []) {
  t++;
  const rows = tbl.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || [];
  console.log(`\n=== TABLE ${t}: ${rows.length} rows`);
  rows.slice(0, 8).forEach((tr, i) => {
    const cells = (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(cellText);
    console.log(`  r${i}: ${JSON.stringify(cells.map((c) => c.slice(0, 46)))}`);
  });
  if (rows.length > 8) console.log(`  ... ${rows.length - 8} more rows`);
}
