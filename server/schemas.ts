import { z } from "zod";

const trimmed = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum);
const optionalText = (maximum: number) =>
  z.preprocess((value) => (value === "" || value === null ? undefined : value), z.string().trim().max(maximum).optional());
const optionalEmail = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string().trim().toLowerCase().email().max(254).optional(),
);
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, "Use a real calendar date.")
  .refine((value) => value <= new Date().toISOString().slice(0, 10), "The date cannot be in the future.");
const optionalDate = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  isoDateSchema.optional(),
);
const bcryptPassword = (minimumCharacters: number) => z
  .string()
  .min(minimumCharacters)
  .max(128)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password must be at most 72 UTF-8 bytes.");
const privatePhotoPath = z
  .string()
  .trim()
  .max(2_048)
  .refine((value) => value.startsWith("/api/"), "Profile photos must use private app-hosted media.");

export const idParamsSchema = z.object({ id: z.string().uuid() });
export const familyParamsSchema = z.object({ familyId: z.string().uuid() });
export const memberParamsSchema = z.object({ memberId: z.string().uuid() });

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: bcryptPassword(10),
  displayName: trimmed(2, 100),
  familyName: trimmed(2, 100),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: bcryptPassword(1),
});

export const relationshipTypeSchema = z.enum(["parent", "spouse", "sibling", "guardian", "relative"]);
export const locationSourceSchema = z.enum(["manual", "browser", "member_shared"]);
export const locationPrecisionSchema = z.enum(["emirate", "city", "approximate", "exact"]);
export const locationVisibilitySchema = z.enum(["private", "family_admin", "family"]);

export const memberProfileSchema = z.object({
  displayName: trimmed(2, 100),
  birthDate: optionalDate,
  phone: optionalText(30),
  email: optionalEmail,
  interests: z.array(trimmed(1, 50)).max(20).default([]).transform((values) => [...new Set(values)]),
  notes: optionalText(2_000),
  photoUrl: z.preprocess((value) => (value === "" || value === null ? undefined : value), privatePhotoPath.optional()),
});

export const memberPatchSchema = z
  .object({
    displayName: trimmed(2, 100).optional(),
    birthDate: z.union([isoDateSchema, z.null()]).optional(),
    phone: z.union([z.string().trim().max(30), z.null()]).optional(),
    email: z.union([z.string().trim().toLowerCase().email().max(254), z.null()]).optional(),
    interests: z
      .array(trimmed(1, 50))
      .max(20)
      .transform((values) => [...new Set(values)])
      .optional(),
    notes: z.union([z.string().trim().max(2_000), z.null()]).optional(),
    photoUrl: z.union([privatePhotoPath, z.null()]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "At least one field is required." });

const initialRelationshipSchema = z.object({
  relatedMemberId: z.string().uuid(),
  type: relationshipTypeSchema,
  direction: z.enum(["source", "target"]).default("source"),
});

export const createMemberSchema = memberProfileSchema.extend({
  // `relationship` is retained for older clients; new clients should send the
  // array so every initial edge is committed atomically with the member.
  relationship: initialRelationshipSchema.optional(),
  relationships: z.array(initialRelationshipSchema).min(1).max(8).optional(),
  location: z
    .object({
      emirate: optionalText(100),
      city: optionalText(100),
      precision: z.enum(["emirate", "city", "approximate"]),
      visibility: locationVisibilitySchema.default("family_admin"),
    })
    .refine((value) => Boolean(value.emirate || value.city), {
      message: "An emirate or city is required for an approximate location.",
    })
    .optional(),
}).superRefine((value, context) => {
  if (value.relationship && value.relationships) {
    context.addIssue({ code: "custom", message: "Use relationship or relationships, not both." });
  }
  const links = value.relationships ?? (value.relationship ? [value.relationship] : []);
  const unique = new Set(links.map((link) => `${link.relatedMemberId}:${link.type}:${link.direction}`));
  if (unique.size !== links.length) {
    context.addIssue({ code: "custom", message: "Initial relationships must be unique." });
  }
});

export const createRelationshipSchema = z.object({
  sourceMemberId: z.string().uuid(),
  targetMemberId: z.string().uuid(),
  type: relationshipTypeSchema,
});

export const updateLocationSchema = z
  .object({
    consentGranted: z.boolean(),
    source: locationSourceSchema.optional(),
    precision: locationPrecisionSchema.optional(),
    visibility: locationVisibilitySchema.optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    accuracyM: z.number().nonnegative().max(1_000_000).optional(),
    emirate: optionalText(100),
    city: optionalText(100),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((value, context) => {
    if (!value.consentGranted) return;
    if (!value.source || !value.precision || !value.visibility) {
      context.addIssue({ code: "custom", message: "source, precision, and visibility are required when sharing." });
    }
    const hasLatitude = value.latitude !== undefined;
    const hasLongitude = value.longitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      context.addIssue({ code: "custom", message: "latitude and longitude must be provided together." });
    }
    if ((value.source === "browser" || value.precision === "exact") && !(hasLatitude && hasLongitude)) {
      context.addIssue({ code: "custom", message: "Browser or exact locations require coordinates." });
    }
    if (!hasLatitude && !value.emirate && !value.city) {
      context.addIssue({ code: "custom", message: "A location label or coordinates are required." });
    }
    if (value.expiresAt && new Date(value.expiresAt).getTime() <= Date.now()) {
      context.addIssue({ code: "custom", message: "expiresAt must be in the future." });
    }
  });

export type MemberProfileInput = z.infer<typeof memberProfileSchema>;
export type RelationshipType = z.infer<typeof relationshipTypeSchema>;
export type LocationPrecision = z.infer<typeof locationPrecisionSchema>;
export type LocationVisibility = z.infer<typeof locationVisibilitySchema>;
