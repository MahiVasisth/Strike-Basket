import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const BASKETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../baskets");

const basketSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    version: z.number().int().positive(),
    name: z.string(),
    tagline: z.string(),
    status: z.enum(["live", "coming_soon"]),
    constituents: z
      .array(z.object({ symbol: z.string(), name: z.string(), weight: z.number().positive().max(1) }))
      .min(1),
  })
  .refine((b) => Math.abs(b.constituents.reduce((s, c) => s + c.weight, 0) - 1) < 1e-9, {
    message: "constituent weights must sum to 1",
  })
  .refine((b) => new Set(b.constituents.map((c) => c.symbol)).size === b.constituents.length, {
    message: "duplicate symbol",
  });

export type Basket = z.infer<typeof basketSchema>;

export function parseBasket(raw: unknown): Basket {
  return basketSchema.parse(raw);
}

export function loadBasket(id: string, dir = BASKETS_DIR): Basket {
  return parseBasket(JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")));
}

export function loadAllBaskets(dir = BASKETS_DIR): Basket[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => parseBasket(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}
