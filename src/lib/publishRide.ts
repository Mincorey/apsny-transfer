// src/lib/publishRide.ts
// Публикация поездки.
//
// На время подключения платёжной системы Platega (platega.io) и прохождения
// модерации публикация поездки ВРЕМЕННО БЕСПЛАТНА: поездка-черновик (draft)
// публикуется сразу через RPC publish_ride_free (draft → active), без оплаты.
// Кнопки «Оплатить … 100 ₽» в интерфейсе сохранены намеренно.
//
// Когда Platega будет подключена, здесь снова появится инициация оплаты, а
// публикация вернётся на серверное подтверждение платежа.

import { supabase } from './supabase';

export const PUBLICATION_PRICE = 100; // ₽ — отображаемая цена публикации

/**
 * Бесплатно публикует поездку-черновик (draft → active) и запускает аукцион.
 * Бросает ошибку, если RPC вернул ошибку.
 * @param rideId id поездки-черновика, принадлежащей текущему пользователю
 */
export async function publishRideFree(rideId: string): Promise<void> {
  const { error } = await supabase.rpc('publish_ride_free', { p_ride_id: rideId });
  if (error) throw error;
}
