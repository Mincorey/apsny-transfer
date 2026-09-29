-- Supabase Database Architecture for APSNY-TRANSFER

-- Enable pgcrypto for UUID generation if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tables Creation

-- Users Table
CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('passenger', 'operator')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Vehicles Table
CREATE TABLE public.vehicles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    make_model TEXT NOT NULL,
    license_plate TEXT NOT NULL,
    capacity INTEGER NOT NULL,
    photo_urls TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Rides Table (Auctions)
CREATE TABLE public.rides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('request', 'offer')),
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    departure_date DATE NOT NULL,
    departure_time TIME NOT NULL,
    seats INTEGER NOT NULL,
    start_price DECIMAL(10, 2) NOT NULL,
    current_price DECIMAL(10, 2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'booked', 'completed', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Bids Table
CREATE TABLE public.bids (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE,
    bidder_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    amount DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Messages Table (for trip chats)
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Row Level Security (RLS) Policies

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Users can read all users (simplified for MVP, but hide phone unless matched)
-- To hide phone, we might normally restrict the column, but in Supabase we can use a secure view or let frontend filter if policy allows.
-- A stricter MVP approach: allow reading basic info, but an RPC or specific policy for phone.
CREATE POLICY "Public profiles are viewable by everyone" ON public.users FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id);

-- Rides are viewable by everyone
CREATE POLICY "Rides are viewable by everyone" ON public.rides FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create rides" ON public.rides FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Ride creator can update their ride" ON public.rides FOR UPDATE USING (auth.uid() = creator_id);

-- Bids are viewable by everyone (for active auction updates)
CREATE POLICY "Bids are viewable by everyone" ON public.bids FOR SELECT USING (true);

-- Messages are viewable by everyone in the MVP
CREATE POLICY "Messages viewable by everyone" ON public.messages FOR SELECT USING (true);
CREATE POLICY "Users can insert messages" ON public.messages FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- 3. RPC for place_bid to prevent Race Conditions

CREATE OR REPLACE FUNCTION place_bid(
    p_ride_id UUID,
    p_bidder_id UUID,
    p_bid_amount DECIMAL
) RETURNS jsonb AS $$
DECLARE
    v_ride RECORD;
    v_new_price DECIMAL;
BEGIN
    -- Lock the row for update to prevent race conditions
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ride not found';
    END IF;

    IF v_ride.status != 'active' THEN
        RAISE EXCEPTION 'Auction is not active';
    END IF;

    -- Bidding logic:
    -- If it's a 'request' (passenger requested ride, drivers bid price DOWN)
    IF v_ride.type = 'request' THEN
        IF p_bid_amount >= v_ride.current_price THEN
            RAISE EXCEPTION 'Bid must be lower than the current price';
        END IF;
    -- If it's an 'offer' (driver offered ride, passengers bid price UP)
    ELSE
        IF p_bid_amount <= v_ride.current_price THEN
            RAISE EXCEPTION 'Bid must be higher than the current price';
        END IF;
    END IF;

    -- Update the rides table
    UPDATE public.rides
    SET current_price = p_bid_amount
    WHERE id = p_ride_id;

    -- Insert the bid log
    INSERT INTO public.bids (ride_id, bidder_id, amount)
    VALUES (p_ride_id, p_bidder_id, p_bid_amount);

    RETURN jsonb_build_object('success', true, 'new_price', p_bid_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RPC to close auction early: active → booked
CREATE OR REPLACE FUNCTION close_auction_early(p_ride_id UUID)
RETURNS jsonb AS $$
DECLARE
  v_ride      RECORD;
  v_winner_id UUID;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.status != 'active' THEN RAISE EXCEPTION 'Auction is not active'; END IF;
  IF v_ride.creator_id != auth.uid() THEN RAISE EXCEPTION 'Only the creator can close the auction'; END IF;

  SELECT bidder_id INTO v_winner_id
  FROM public.bids
  WHERE ride_id = p_ride_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_winner_id IS NULL THEN RAISE EXCEPTION 'Cannot close auction: no bids placed yet'; END IF;

  UPDATE public.rides
  SET status = 'booked', winner_id = v_winner_id, auction_end_time = now()
  WHERE id = p_ride_id;

  RETURN jsonb_build_object('success', true, 'winner_id', v_winner_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RPC to mark trip as completed: booked → completed (driver action)
CREATE OR REPLACE FUNCTION complete_trip(p_ride_id UUID)
RETURNS jsonb AS $$
DECLARE
  v_ride RECORD;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.status != 'booked' THEN RAISE EXCEPTION 'Ride must be booked to complete'; END IF;
  IF v_ride.creator_id != auth.uid() THEN RAISE EXCEPTION 'Only the ride creator can complete the trip'; END IF;

  UPDATE public.rides SET status = 'completed' WHERE id = p_ride_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
