import { spawn } from "child_process";
import { existsSync, promises as fs } from "fs";
import path from "path";
import { PermanentVideoError } from "./ffmpeg";

/**
 * Deck conversion for the worker:
 *   PPTX/PPT --LibreOffice--> PDF --pdf.js + canvas--> one JPEG per slide (+ a thumbnail)
 * PDFs skip the first step. Slides are shown to viewers as images, so every browser shows them
 * exactly the same (animations are flattened).
 */

export const SLIDE_WIDTH = 1920;
export const MAX_SLIDES = 300;
const JPEG_QUALITY = 88;

// pdf.js (an ES module) and the native canvas binding are loaded only when a deck is converted.
// With a variable name TypeScript keeps this a plain dynamic import (Node 22+ can load ES modules).
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

/** PPTX/PPT → PDF with LibreOffice (headless). Returns the PDF path. */
export const officeToPdf = (input: string, outDir: string, timeoutMs = 5 * 60_000) =>
  new Promise<string>((resolve, reject) => {
    // A private profile per run: parallel conversions don't fight over one LibreOffice profile.
    const profile = `file:///${path.join(outDir, "lo-profile").replace(/\\/g, "/").replace(/^\/+/, "")}`;
    const child = spawn(
      sofficePath(),
      [`-env:UserInstallation=${profile}`, "--headless", "--norestore", "--nologo", "--convert-to", "pdf", "--outdir", outDir, input],
      { windowsHide: true }
    );
    let stderr = "";
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        return reject(new PermanentVideoError("PowerPoint files need LibreOffice on the server. Save the deck as PDF and upload that instead."));
      }
      reject(err);
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      const pdf = path.join(outDir, `${path.parse(input).name}.pdf`);
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
      const viewport = page.getViewport({ scale: SLIDE_WIDTH / base1.width });
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
