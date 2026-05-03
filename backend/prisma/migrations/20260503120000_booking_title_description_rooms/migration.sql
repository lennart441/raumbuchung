ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "description" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Booking' AND column_name = 'note'
  ) THEN
    UPDATE "Booking" SET "title" = "note" WHERE "title" IS NULL AND "note" IS NOT NULL;
    ALTER TABLE "Booking" DROP COLUMN "note";
  END IF;
END $$;

UPDATE "Room" SET "isActive" = false WHERE "isActive" = true;
