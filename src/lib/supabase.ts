import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase URL и ключ должны быть указаны в .env файле');
}

// ─── Типы базы данных ───────────────────────────────────────

export type UserRole = 'passenger' | 'driver';
export type RideType = 'request' | 'offer';
export type RideStatus = 'active' | 'booked' | 'completed' | 'cancelled';
// Тип 'new_message' убран вместе с внутренним чатом (10.08.2026).
export type NotificationType =
  | 'new_bid'
  | 'auction_won'
  | 'auction_lost'
  | 'ride_cancelled'
  | 'review_received';

export interface User {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: UserRole;
  telegram?: string | null;
  whatsapp?: string | null;
  avatar_url?: string | null;
  show_phone: boolean;
  show_telegram: boolean;
  show_whatsapp: boolean;
  rating: number;
  trips_count: number;
  created_at: string;
}

export interface Vehicle {
  id: string;
  driver_id: string;
  make_model: string;
  license_plate: string;
  capacity: number;
  photo_url?: string | null;
  created_at: string;
}

export interface Ride {
  id: string;
  creator_id: string;
  type: RideType;
  origin: string;
  destination: string;
  departure_date: string;
  departure_time: string;
  seats: number;
  border_crossing: boolean;
  comment?: string | null;
  start_price: number;
  current_price: number;
  bid_step: number;
  auction_end_time?: string | null;
  winner_id?: string | null;
  vehicle_id?: string | null;
  amenities?: string[] | null;
  cancelled_at?: string | null;
  status: RideStatus;
  created_at: string;
  // JOIN поля
  creator?: User;
  vehicle?: Vehicle;
  winner?: User;
}

export interface Bid {
  id: string;
  ride_id: string;
  bidder_id: string;
  amount: number;
  created_at: string;
  // JOIN поля
  bidder?: User;
}

export interface Conversation {
  id: string;
  user1_id: string;
  user2_id: string;
  ride_id?: string | null;
  last_message?: string | null;
  last_message_at?: string | null;
  created_at: string;
  // JOIN поля
  user1?: User;
  user2?: User;
  ride?: Ride;
}

export interface DirectMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
  sender?: User;
}

export interface Review {
  id: string;
  ride_id: string;
  reviewer_id: string;
  target_id: string;
  rating: number;
  comment?: string | null;
  created_at: string;
  reviewer?: User;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  ride_id?: string | null;
  is_read: boolean;
  created_at: string;
}

// ─── Клиент Supabase ────────────────────────────────────────

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
