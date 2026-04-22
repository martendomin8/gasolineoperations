-- Enforce the CLAUDE.md invariant "every deal belongs to exactly one
-- linkage" at the schema level. Before flipping the column to NOT NULL
-- we backfill any existing orphans so the ALTER can succeed on every
-- environment (dev/local, Vercel prod, any future on-prem deploy).
--
-- Three backfill cases:
--   (1) deal has a linkage_code string and a linkage row with matching
--       linkage_number OR temp_name already exists → set linkage_id to
--       that row's id.
--   (2) deal has a linkage_code string but NO matching linkage row →
--       create a new linkage with linkage_number = the code, then
--       link the deal.
--   (3) deal has neither linkage_id nor linkage_code → create one
--       "Unassigned" linkage per tenant (temp_name = 'UNASSIGNED')
--       and park the deal there so the schema constraint can be
--       enforced. Operators can clean these up via the normal
--       linkage-editor UI after migration.
--
-- Wrapped in a transaction via drizzle-kit's runner — if any step
-- fails the whole migration rolls back and nothing half-applies.

-- Case 1: match existing linkage rows by linkage_number or temp_name.
UPDATE "deals" d
SET "linkage_id" = l.id
FROM "linkages" l
WHERE d."linkage_id" IS NULL
  AND d."linkage_code" IS NOT NULL
  AND l."tenant_id" = d."tenant_id"
  AND (l."linkage_number" = d."linkage_code" OR l."temp_name" = d."linkage_code");

-- Case 2: for each (tenant, linkage_code) that still has no matching
-- row, create a linkage, then attach the deals. (display_name is a
-- computed frontend field, not a stored column — we only persist
-- linkage_number + temp_name.)
WITH new_linkages AS (
  INSERT INTO "linkages" (
    "tenant_id", "linkage_number", "temp_name", "status"
  )
  SELECT DISTINCT
    d."tenant_id",
    d."linkage_code",
    d."linkage_code",
    'active'
  FROM "deals" d
  WHERE d."linkage_id" IS NULL
    AND d."linkage_code" IS NOT NULL
  RETURNING "id", "tenant_id", "linkage_number"
)
UPDATE "deals" d
SET "linkage_id" = nl.id
FROM new_linkages nl
WHERE d."linkage_id" IS NULL
  AND d."linkage_code" IS NOT NULL
  AND d."tenant_id" = nl.tenant_id
  AND d."linkage_code" = nl.linkage_number;

-- Case 3: deals with neither linkage_id nor linkage_code. Park into
-- a per-tenant "UNASSIGNED" linkage (create if missing). Operators
-- can reassign these via the dashboard afterwards.
INSERT INTO "linkages" ("tenant_id", "temp_name", "status")
SELECT DISTINCT d."tenant_id", 'UNASSIGNED', 'active'
FROM "deals" d
WHERE d."linkage_id" IS NULL
  AND d."linkage_code" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "linkages" l2
    WHERE l2."tenant_id" = d."tenant_id" AND l2."temp_name" = 'UNASSIGNED'
  );

UPDATE "deals" d
SET "linkage_id" = l.id
FROM "linkages" l
WHERE d."linkage_id" IS NULL
  AND d."linkage_code" IS NULL
  AND l."tenant_id" = d."tenant_id"
  AND l."temp_name" = 'UNASSIGNED';

-- Finally the constraint. If any deal still lacks a linkage_id at this
-- point the ALTER will fail loudly (which is what we want — don't
-- silently flip the bit on a broken dataset).
ALTER TABLE "deals" ALTER COLUMN "linkage_id" SET NOT NULL;
