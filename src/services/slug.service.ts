import { randomInt } from "crypto";

// Same format as the frontend's makeSlug(): 2026-11-24-acme-retail-product-walkthrough-k7f2
const SUFFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export const kebab = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

const suffix = () => Array.from({ length: 4 }, () => SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)]).join("");

export const makeSlug = (date: string, client: string, name: string) =>
  [date, kebab(client), kebab(name), suffix()].filter(Boolean).join("-");
