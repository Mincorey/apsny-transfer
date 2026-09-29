-- Харднинг БД 2026-06-13, часть 3 (применено к проду uprcnpgmmnvsoxasuhun).
-- Корректная grant-модель: отозвать EXECUTE у PUBLIC (anon наследует именно его),
-- затем точечно выдать authenticated там, где вызов из приложения легитимен (10.4).

-- Пользовательские RPC (нужен вход): только authenticated
REVOKE EXECUTE ON FUNCTION public.place_bid(uuid, numeric)                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_current_price(uuid, uuid)         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_auction_early(uuid)                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finish_auction(uuid)                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_trip(uuid)                      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_ride(uuid)                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_review(uuid, uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_or_create_conversation(uuid, uuid)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_trip_view(uuid)                      FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.place_bid(uuid, numeric)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_current_price(uuid, uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_auction_early(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_auction(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_trip(uuid)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ride(uuid)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(uuid, uuid)   TO authenticated;
-- get_trip_view — публичный просмотр поездки по deep-ссылке (read-only): и anon, и authenticated
GRANT EXECUTE ON FUNCTION public.get_trip_view(uuid)                      TO anon, authenticated;

-- Служебные cron-функции: недоступны через API никому (зовёт только pg_cron под владельцем)
REVOKE EXECUTE ON FUNCTION public.auto_complete_expired_rides() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_expired_auctions()      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_expired_auctions()    FROM PUBLIC;
