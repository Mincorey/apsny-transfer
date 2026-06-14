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

/**
 * Сжимает и ресайзит изображение на клиенте ДО загрузки в Storage.
 * На Free-тарифе Supabase нет серверных трансформаций изображений, поэтому
 * уменьшаем файл сами: меньше места в Storage (1 ГБ) и меньше egress (5 ГБ).
 * Возвращает новый File (JPEG); при ошибке или неподходящем типе — исходный файл.
 */
export async function compressImage(
  file: File,
  options: { maxSize?: number; quality?: number } = {}
): Promise<File> {
  const { maxSize = 1024, quality = 0.8 } = options;
  // Только растровые изображения; GIF не трогаем (потеряется анимация).
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;

  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('read error'));
      reader.readAsDataURL(file);
    });

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('decode error'));
      image.src = dataUrl;
    });

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
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    );
    // Нет выигрыша по размеру — оставляем оригинал.
    if (!blob || blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg' });
  } catch {
    return file; // при любой ошибке грузим как есть
  }
}
