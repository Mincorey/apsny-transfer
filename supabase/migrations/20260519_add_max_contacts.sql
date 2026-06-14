-- Add MAX messenger contact field to users table
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS max TEXT,
ADD COLUMN IF NOT EXISTS show_max BOOLEAN DEFAULT true;

-- Update RLS policies if needed
-- The existing policies on users table should handle the new columns automatically
