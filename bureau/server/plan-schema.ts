import { z } from "zod";
import type { RoleId } from "../shared/protocol.ts";
import { slugify } from "./storage.ts";

export const ROLE_IDS = ["chercheur", "codeur", "designer", "redacteur", "analyste"] as const satisfies readonly RoleId[];

export interface Plan {
  titre: string;
  slug: string;
  annonce: string;
  projet: string | null;
  etapes: { robots: { role: RoleId; tache: string }[] }[];
}

/** Schéma passé à `claude --json-schema` pour que Max rende un plan structuré. */
export const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titre", "slug", "annonce", "projet", "etapes"],
  properties: {
    titre: { type: "string", description: "Titre court de la mission" },
    slug: { type: "string", description: "2 à 5 mots en minuscules séparés par des tirets" },
    annonce: { type: "string", description: "Une phrase où Max annonce son équipe" },
    projet: { type: ["string", "null"], description: "Nom exact d'un projet connu si le codeur y travaille, sinon null" },
    etapes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["robots"],
        properties: {
          robots: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["role", "tache"],
              properties: {
                role: { enum: [...ROLE_IDS] },
                tache: { type: "string", description: "Consigne précise et autonome pour ce robot" },
              },
            },
          },
        },
      },
    },
  },
} as const;

const PlanZ = z.object({
  titre: z.string().min(1),
  slug: z.string(),
  annonce: z.string().default(""),
  projet: z.string().nullable().default(null),
  etapes: z
    .array(z.object({ robots: z.array(z.object({ role: z.enum(ROLE_IDS), tache: z.string().min(1) })).min(1, "étape vide") }))
    .min(1, "aucune étape"),
});

export class PlanInvalide extends Error {}

export function parsePlan(raw: unknown, limites: { robots: number; etapes: number }, projets: string[]): Plan {
  const r = PlanZ.safeParse(raw);
  if (!r.success) {
    throw new PlanInvalide(r.error.issues.map((i) => `${i.path.join(".") || "plan"} : ${i.message}`).join(" ; "));
  }
  const p = r.data;
  const nbRobots = p.etapes.reduce((n, e) => n + e.robots.length, 0);
  if (nbRobots > limites.robots) throw new PlanInvalide(`${nbRobots} robots demandés, maximum ${limites.robots} robots`);
  if (p.etapes.length > limites.etapes) throw new PlanInvalide(`${p.etapes.length} étapes demandées, maximum ${limites.etapes} étapes`);
  return {
    ...p,
    slug: slugify(p.slug || p.titre, 5),
    projet: p.projet && projets.includes(p.projet) ? p.projet : null,
  };
}
