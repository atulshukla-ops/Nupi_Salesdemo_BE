/**
 * Builds a small, valid PDF for tests: one 16:9 page per title, each with a coloured band and text.
 * Written by hand (no extra library) so the tests have no other dependencies.
 */
export function makePdf(titles: string[], widthPt = 960, heightPt = 540): Buffer {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length; // object number
  };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pagesRef = objects.length + 1 + titles.length * 2; // filled in below
  const pageRefs: number[] = [];
  titles.forEach((title, i) => {
    const hue = [0.2 + 0.15 * (i % 4), 0.45, 0.75];
    const stream = [
      `${hue.join(" ")} rg 0 ${heightPt - 120} ${widthPt} 120 re f`,
      "0.1 0.15 0.2 rg BT /F1 48 Tf 60 260 Td",
      `(${title.replace(/[()\\]/g, "")}) Tj ET`,
      `BT /F1 20 Tf 60 200 Td (Slide ${i + 1} of ${titles.length}) Tj ET`
    ].join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    pageRefs.push(
      add(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`)
    );
  });
  const pages = add(`<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`);
  if (pages !== pagesRef) throw new Error("internal: page tree number mismatch");
  const catalog = add(`<< /Type /Catalog /Pages ${pages} 0 R >>`);

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
