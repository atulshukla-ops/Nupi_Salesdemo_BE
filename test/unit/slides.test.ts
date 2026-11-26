import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PermanentVideoError } from "../../src/utils/ffmpeg";
import { createRequire } from "module";
import { MAX_PAGE_RATIO, MAX_SLIDE_HEIGHT, MAX_SLIDES, officeToPdf, pdfToSlides, sniffDeck, SLIDE_WIDTH } from "../../src/utils/slides";
import { makePdf } from "../fixtures/makePdf";

/** Deck conversion used by the worker, on small generated PDFs. */
const dir = path.join(os.tmpdir(), `sdr-test-slides-${process.pid}`);
const file = (name: string) => path.join(dir, name);
const isJpeg = async (f: string) => (await fs.readFile(f)).subarray(0, 2).toString("hex") === "ffd8";

describe("deck conversion", () => {
  beforeAll(async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file("deck.pdf"), makePdf(["Welcome to NUPI", "Pricing", "Next steps"]));
    await fs.writeFile(file("portrait.pdf"), makePdf(["A4 page"], 595, 842));
    await fs.writeFile(file("broken.pdf"), "this is not a pdf");
    await fs.writeFile(file("tall.pdf"), makePdf(["Tall but allowed"], 300, 900)); // 3x taller than wide
    await fs.writeFile(file("strip.pdf"), makePdf(["Receipt roll"], 100, 20000)); // 200x taller than wide
    await fs.writeFile(file("huge.pdf"), makePdf(Array.from({ length: MAX_SLIDES + 1 }, (_, i) => `S${i}`), 100, 60));
  });
  afterAll(() => fs.rm(dir, { recursive: true, force: true }));

  it("renders every page as a 1920 px JPEG slide, in order, plus a thumbnail", async () => {
    const r = await pdfToSlides(file("deck.pdf"), file("out"));
    expect(r.count).toBe(3);
    expect(r).toMatchObject({ width: SLIDE_WIDTH, height: 1080 });
    expect(r.files.map((f) => path.basename(f))).toEqual(["001.jpg", "002.jpg", "003.jpg"]);
    for (const f of [...r.files, r.thumbnail]) expect(await isJpeg(f)).toBe(true);
  });

  it("keeps the page shape (portrait stays portrait)", async () => {
    const r = await pdfToSlides(file("portrait.pdf"), file("out-portrait"));
    expect(r.width).toBe(SLIDE_WIDTH);
    expect(r.height).toBeGreaterThan(2600);
  });

  it(`tall pages are made narrower, never taller than ${MAX_SLIDE_HEIGHT} px`, async () => {
    const r = await pdfToSlides(file("tall.pdf"), file("out-tall"));
    expect(r.height).toBe(MAX_SLIDE_HEIGHT);
    expect(r.width).toBeLessThan(SLIDE_WIDTH);
  });

  it(`pages more than ${MAX_PAGE_RATIO}x taller than wide are refused (no giant images)`, async () => {
    await expect(pdfToSlides(file("strip.pdf"), file("out-strip"))).rejects.toThrow(/taller than it is wide/);
  });

  it("the built (CommonJS) worker can load pdf.js: Node's require(esm) keeps working", () => {
    const req = createRequire(__filename);
    expect(typeof req("pdfjs-dist/legacy/build/pdf.mjs").getDocument).toBe("function");
  });

  it("a file that is not a PDF fails permanently with a clear message", async () => {
    await expect(pdfToSlides(file("broken.pdf"), file("out-broken"))).rejects.toBeInstanceOf(PermanentVideoError);
  });

  it(`refuses decks with more than ${MAX_SLIDES} slides`, async () => {
    await expect(pdfToSlides(file("huge.pdf"), file("out-huge"))).rejects.toThrow(/at most 300 slides/);
  });

  it("recognises decks by their content, not their name", () => {
    expect(sniffDeck(Buffer.from("%PDF-1.7 "))).toBe("pdf");
    expect(sniffDeck(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 6, 0]))).toBe("pptx");
    expect(sniffDeck(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe("ppt");
    expect(sniffDeck(Buffer.from("not really a presentation"))).toBeNull();
    expect(sniffDeck(Buffer.alloc(0))).toBeNull();
  });

  it("PowerPoint without LibreOffice: clear message to upload a PDF instead", async () => {
    const before = process.env.SOFFICE_PATH;
    process.env.SOFFICE_PATH = path.join(dir, "no-libreoffice-here.exe");
    try {
      await fs.writeFile(file("deck.pptx"), "pretend pptx");
      await expect(officeToPdf(file("deck.pptx"), dir)).rejects.toThrow(/need LibreOffice.*PDF/);
    } finally {
      if (before === undefined) delete process.env.SOFFICE_PATH;
      else process.env.SOFFICE_PATH = before;
    }
  });
});
