ALTER TABLE "persons" ALTER COLUMN "monitored" SET DEFAULT false;--> statement-breakpoint
-- Persons recorded before this change were monitored only because a screening enrolled them.
UPDATE "persons" SET "monitored" = false;
