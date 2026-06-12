-- Add start_time and end_time to events (to support events spanning midnight)
ALTER TABLE events
ADD COLUMN start_time timestamp with time zone NOT NULL DEFAULT now(),
ADD COLUMN end_time timestamp with time zone NOT NULL DEFAULT now();

-- Update the updated_at timestamp for the migration
UPDATE events SET updated_at = now() WHERE updated_at IS NULL;

-- Create trigger to enforce guest tier max_count
-- Prevents inserting/updating a guest if tier max_count is reached
CREATE OR REPLACE FUNCTION enforce_guest_tier_max()
RETURNS TRIGGER AS $$
DECLARE
  v_tier_id uuid;
  v_tier_name text;
  v_max_count int;
  v_current_count int;
BEGIN
  -- Only check if the guest is being added to a tier (and status is not 'removed')
  IF NEW.tier_id IS NOT NULL AND NEW.status != 'removed'::guest_status THEN
    v_tier_id := NEW.tier_id;

    -- Get tier info
    SELECT gt.id, gt.name, gt.max_count
    INTO v_tier_id, v_tier_name, v_max_count
    FROM guest_tiers gt
    WHERE gt.id = NEW.tier_id;

    -- If tier has a max_count limit
    IF v_max_count IS NOT NULL THEN
      -- Count current non-removed guests in this tier
      SELECT COUNT(*)
      INTO v_current_count
      FROM guests g
      WHERE g.tier_id = NEW.tier_id
        AND g.status != 'removed'::guest_status
        AND g.id != NEW.id; -- Exclude current record on UPDATE

      -- Check if adding this guest would exceed max_count
      IF v_current_count >= v_max_count THEN
        RAISE EXCEPTION 'Tier "%" is full (% / % gasten)',
          v_tier_name, v_current_count, v_max_count;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to guests table
DROP TRIGGER IF EXISTS enforce_guest_tier_max_trigger ON guests;
CREATE TRIGGER enforce_guest_tier_max_trigger
BEFORE INSERT OR UPDATE ON guests
FOR EACH ROW
EXECUTE FUNCTION enforce_guest_tier_max();

-- Update RLS policies if needed (no changes to existing policies, but document this migration)
-- Events still have venue_id-based filtering in RLS
-- guest_tiers still filtered by event_id via event ownership
-- guests still have the list_locked check in RLS policies
