import { spawn } from "child_process";
import { existsSync, mkdirSync, promises as fs } from "fs";
import path from "path";
import { PermanentVideoError } from "./ffmpeg";

/**
 * Deck conversion for the worker:
 *   PPTX/PPT --LibreOffice--> PDF --pdf.js + canvas--> one JPEG per slide (+ a thumbnail)
 * PDFs skip the first step. Slides are shown to viewers as images, so every browser shows them
 * exactly the same (animations are flattened).
 */

export const SLIDE_WIDTH = 1920;
/** Slide images are at most this tall (a tall portrait page is made narrower instead). */
export const MAX_SLIDE_HEIGHT = 4096;
/** Pages more than this many times taller than wide are refused. */
export const MAX_PAGE_RATIO = 4;
export const MAX_SLIDES = 300;
const JPEG_QUALITY = 88;

// pdf.js (an ES module) and the native canvas binding are loaded only when a deck is converted.
// Note: this project compiles to CommonJS, so TypeScript turns import() into require(). Loading the
// ES module pdf.js then relies on Node's require(esm) support (Node 22.12+, see "engines"); it would
// break if pdf.js ever used top-level await. test/unit/slides.test.ts checks this keeps working.
const importEsm = (s: string): Promise<any> => import(s);
let pdfjsPromise: Promise<any> | null = null;
const pdfjs = () => (pdfjsPromise ??= importEsm("pdfjs-dist/legacy/build/pdf.mjs"));
const pdfjsDir = () => path.dirname(require.resolve("pdfjs-dist/package.json"));

/** LibreOffice: SOFFICE_PATH, else the usual install locations, else "soffice" on PATH. */
export const sofficePath = () => {
  if (process.env.SOFFICE_PATH) return process.env.SOFFICE_PATH;
  const candidates =
    process.platform === "win32"
      ? ["C:\\Program Files\\LibreOffice\\program\\soffice.exe", "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"]
      : ["/usr/bin/soffice", "/usr/lib/libreoffice/program/soffice", "/opt/libreoffice/program/soffice"];
  return candidates.find((c) => existsSync(c)) ?? "soffice";
};

/**
 * What a deck file really is, from its content (the name and type sent by the browser can be
 * wrong). Checked before converting, so a renamed text, Word or Excel file is refused instead of
 * being "converted" into a deck:
 *   pdf  — "%PDF-" in the first 1 KB (the PDF format allows a few bytes before it)
 *   pptx — a ZIP package that contains ppt/presentation.xml (PPTX, PPTM, PPSX, Strict OOXML)
 *   ppt  — an OLE file with a "PowerPoint Document" part (PowerPoint 97–2003)
 *   encrypted — a password-protected PowerPoint (stored as an OLE file with an encrypted package)
 */
export type DeckFormat = "pdf" | "pptx" | "ppt";
export type DeckSniff = DeckFormat | "encrypted" | null;

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const utf16 = (t: string) => Buffer.from(t, "utf16le");
const PPT_STREAM = utf16("PowerPoint Document");
const ENCRYPTED_STREAM = utf16("EncryptedPackage");
const PPTX_PART = Buffer.from("ppt/presentation.xml", "latin1");
/** ZIP file names are stored uncompressed in the central directory at the end of the file. */
const ZIP_TAIL_BYTES = 4 * 1024 * 1024;
/** Old-format decks are small; the part names live in the OLE directory, which can be anywhere. */
const OLE_SCAN_BYTES = 64 * 1024 * 1024;

/** Pure check on the bytes (head = start of the file, tail = end of the file, or all of it). */
export const sniffDeck = (head: Buffer, tail: Buffer = head): DeckSniff => {
  if (head.subarray(0, 1024).includes("%PDF-", 0, "latin1")) return "pdf";
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return tail.includes(PPTX_PART) ? "pptx" : null;
  if (head.subarray(0, 8).equals(OLE_MAGIC)) {
    if (tail.includes(ENCRYPTED_STREAM)) return "encrypted";
    return tail.includes(PPT_STREAM) ? "ppt" : null;
  }
  return null;
};

const readAt = async (fh: fs.FileHandle, position: number, length: number) => {
  const buf = Buffer.alloc(Math.max(0, length));
  const { bytesRead } = await fh.read(buf, 0, buf.length, position);
  return buf.subarray(0, bytesRead);
};

export const readDeckFormat = async (file: string): Promise<DeckSniff> => {
  const fh = await fs.open(file, "r");
  try {
    const size = (await fh.stat()).size;
    const head = await readAt(fh, 0, Math.min(size, 1024));
    if (head[0] === 0x50 && head[1] === 0x4b) return sniffDeck(head, await readAt(fh, Math.max(0, size - ZIP_TAIL_BYTES), Math.min(size, ZIP_TAIL_BYTES)));
    if (head.subarray(0, 8).equals(OLE_MAGIC)) return sniffDeck(head, await readAt(fh, 0, Math.min(size, OLE_SCAN_BYTES)));
    return sniffDeck(head);
  } finally {
    await fh.close();
  }
};

/** The type to record for a deck, from what it really is (not what the browser claimed). */
export const DECK_MIME: Record<DeckFormat, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint"
};

/**
 * Stops LibreOffice and everything it started. On Linux `soffice` is a launcher that starts the
 * real `soffice.bin`, so killing only the launcher would leave the real program running.
 */
const killTree = (pid: number | undefined) => {
  if (!pid) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(-pid, "SIGKILL"); // the whole process group (started with detached: true)
  } catch {
    /* already gone */
  }
};

/**
 * PPTX/PPT → PDF with LibreOffice (headless). Returns the PDF path. The caller checks the file
 * with readDeckFormat first; LibreOffice then picks the exact PowerPoint flavour itself.
 * The PDF is written to its own folder, so it can never be confused with the input file.
 */
export const officeToPdf = (input: string, outDir: string, timeoutMs = 5 * 60_000) =>
  new Promise<string>((resolve, reject) => {
    const pdfDir = path.join(outDir, "pdf");
    mkdirSync(pdfDir, { recursive: true });
    // A private profile per run: parallel conversions don't fight over one LibreOffice profile.
    const profile = `file:///${path.join(outDir, "lo-profile").split(path.sep).join("/").replace(/^\/+/, "")}`;
    const child = spawn(
      sofficePath(),
      [`-env:UserInstallation=${profile}`, "--headless", "--norestore", "--nologo", "--convert-to", "pdf", "--outdir", pdfDir, input],
      {
        windowsHide: true,
        // Its normal output is not needed; leaving it unread could fill the pipe and stall the conversion.
        stdio: ["ignore", "ignore", "pipe"],
        // Own process group on Linux/macOS, so a timeout can stop the launcher and soffice.bin together.
        detached: process.platform !== "win32"
      }
    );
    let stderr = "";
    let timedOut = false;
    child.stderr?.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        return reject(new PermanentVideoError("PowerPoint files need LibreOffice on the server. Save the deck as PDF and upload that instead."));
      }
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // A slow conversion (busy server) is worth another try, so this is NOT a permanent failure.
      if (timedOut) return reject(new Error(`LibreOffice did not finish within ${Math.round(timeoutMs / 1000)} s`));
      const pdf = path.join(pdfDir, `${path.parse(input).name}.pdf`);
      if (code === 0 && existsSync(pdf)) return resolve(pdf);
      reject(new PermanentVideoError(`Could not convert this presentation (${stderr.trim().split("\n").pop() || `exit code ${code}`}). Try saving it as PDF.`));
    });
  });

export interface SlidesResult {
  count: number;
  width: number;
  height: number;
  files: string[]; // in order: 001.jpg, 002.jpg, …
  thumbnail: string;
}

/** Renders every page of a PDF to a JPEG SLIDE_WIDTH pixels wide, plus a 640 px thumbnail of slide 1. */
export async function pdfToSlides(pdfPath: string, outDir: string): Promise<SlidesResult> {
  const { getDocument } = await pdfjs();
  const { createCanvas } = await importEsm("@napi-rs/canvas");
  const base = pdfjsDir();
  const task = getDocument({
    data: new Uint8Array(await fs.readFile(pdfPath)),
    // pdf.js wants forward slashes and a trailing slash, also on Windows
    standardFontDataUrl: `${path.join(base, "standard_fonts").split(path.sep).join("/")}/`,
    cMapUrl: `${path.join(base, "cmaps").split(path.sep).join("/")}/`,
    cMapPacked: true,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0
  });
  let doc: any;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => undefined);
    const name = (e as { name?: string }).name;
    throw new PermanentVideoError(name === "PasswordException" ? "This PDF is password-protected. Remove the password and upload it again." : "This file is not a readable PDF or presentation.");
  }
  try {
    if (doc.numPages < 1) throw new PermanentVideoError("This document has no pages.");
    if (doc.numPages > MAX_SLIDES) throw new PermanentVideoError(`Decks can have at most ${MAX_SLIDES} slides (this one has ${doc.numPages}).`);
    await fs.mkdir(outDir, { recursive: true });
    const files: string[] = [];
    let width = 0;
    let height = 0;
    let firstCanvas: any = null;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base1 = page.getViewport({ scale: 1 });
      // Normal slides are wide or A4-ish. A page far taller than wide (an exported web page, a
      // receipt roll) would need a gigantic image: refuse it instead of running out of memory.
      if (base1.height / base1.width > MAX_PAGE_RATIO) {
        throw new PermanentVideoError(`Page ${n} is ${Math.round(base1.height / base1.width)}× taller than it is wide. Slides must be presentation-shaped (at most ${MAX_PAGE_RATIO}× taller than wide).`);
      }
      // 1920 px wide, but never taller than MAX_SLIDE_HEIGHT (a tall portrait page gets narrower).
      const viewport = page.getViewport({ scale: Math.min(SLIDE_WIDTH / base1.width, MAX_SLIDE_HEIGHT / base1.height) });
      const w = Math.round(viewport.width);
      const h = Math.round(viewport.height);
      const canvas = createCanvas(w, h);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; // PDFs without a background are transparent; slides need white
      ctx.fillRect(0, 0, w, h);
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      const file = path.join(outDir, `${String(n).padStart(3, "0")}.jpg`);
      await fs.writeFile(file, await canvas.encode("jpeg", JPEG_QUALITY));
      files.push(file);
      if (n === 1) {
        width = w;
        height = h;
        firstCanvas = canvas;
      }
      page.cleanup();
    }
    const tw = 640;
    const th = Math.round((tw * height) / width);
    const thumb = createCanvas(tw, th);
    thumb.getContext("2d").drawImage(firstCanvas, 0, 0, tw, th);
    const thumbnail = path.join(outDir, "thumb.jpg");
    await fs.writeFile(thumbnail, await thumb.encode("jpeg", 82));
    return { count: files.length, width, height, files, thumbnail };
  } finally {
    await task.destroy();
  }
}
