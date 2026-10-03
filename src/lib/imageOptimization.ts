/**
 * Оптимизирует URL изображения для более быстрой загрузки
 * Поддерживает: lazy loading, уменьшение размера, webp
 */

export function getOptimizedImageUrl(
  originalUrl: string | null | undefined,
  options: {
    width?: number;
    quality?: number;
  } = {}
): string | undefined {
  if (!originalUrl) return undefined;

  const { width = 200, quality = 80 } = options;

  // Если это Supabase URL, добавляем параметры трансформации
  if (originalUrl.includes('supabase.co')) {
    // Supabase Image Optimization: добавляем параметры к URL
    const separator = originalUrl.includes('?') ? '&' : '?';
    return `${originalUrl}${separator}width=${width}&quality=${quality}`;
  }

  // Для других URL возвращаем как есть
  return originalUrl;
}

/**
 * Свойства для оптимизированного img элемента
 */
export function getImageProps(
  src: string | null | undefined,
  alt: string,
  options: {
    width?: number;
    quality?: number;
    className?: string;
  } = {}
) {
  const optimizedSrc = getOptimizedImageUrl(src, {
    width: options.width || 200,
    quality: options.quality || 80,
  });

  return {
    src: optimizedSrc || '',
    alt,
    loading: 'lazy' as const,
    decoding: 'async' as const,
    className: options.className || '',
  };
}

/** Форматы, которые принимает хранилище (аудит 29.09.2026, В-13). */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const ALLOWED = new Set<string>(ALLOWED_IMAGE_TYPES);

/**
 * Готовит фото к загрузке: уменьшает до maxSize по большей стороне и
 * перекодирует в JPEG.
 *
 * Раньше при любой неудаче функция молча возвращала исходный файл — так в
 * хранилище мог уйти файл любого типа (GIF, SVG, HEIC, вообще не картинка).
 * Теперь на выходе всегда JPEG, PNG или WebP; всё остальное — понятная
 * ошибка, которую страница показывает пользователю. Сервер (лимиты бакета
 * avatars) проверяет то же самое независимо от этой функции.
 */
export async function compressImage(
  file: File,
  options: { maxSize?: number; quality?: number } = {}
): Promise<File> {
  const { maxSize = 1024, quality = 0.8 } = options;
  const notAPhoto = new Error('Можно загрузить только фото в формате JPG, PNG или WebP');
  if (!file.type.startsWith('image/')) throw notAPhoto;

  let img: HTMLImageElement;
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('read error'));
      reader.readAsDataURL(file);
    });
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('decode error'));
      image.src = dataUrl;
    });
  } catch {
    // Браузер не смог прочитать картинку (например, HEIC не в Safari).
    // Пропускаем только разрешённые форматы — остальное отклоняем.
    if (ALLOWED.has(file.type)) return file;
    throw notAPhoto;
  }

  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  if (width > maxSize || height > maxSize) {
    if (width >= height) {
      height = Math.round(height * (maxSize / width));
      width = maxSize;
    } else {
      width = Math.round(width * (maxSize / height));
      height = maxSize;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    if (ALLOWED.has(file.type)) return file;
    throw notAPhoto;
  }
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality)
  );
  if (!blob) {
    if (ALLOWED.has(file.type)) return file;
    throw notAPhoto;
  }
  // Оригинал оставляем, только если он и меньше, и в разрешённом формате.
  if (blob.size >= file.size && ALLOWED.has(file.type)) return file;

  const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], newName, { type: 'image/jpeg' });
}
