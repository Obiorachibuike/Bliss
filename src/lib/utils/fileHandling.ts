// Client-side file handling — images downscaled to max 2048px, base64 data URIs

export async function imageFileToDataUri(file: File, maxSize = 2048): Promise<string> {
  // Fast path: if file is small and already within limit, just read as data URI
  const bitmap = await createImageBitmapSafe(file);
  if (!bitmap) {
    // Fallback: FileReader
    return await fileToDataUri(file);
  }
  const { width, height } = bitmap;
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  // Use OffscreenCanvas if available, else regular canvas
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return await fileToDataUri(file);
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  // Preserve type, default to jpeg with 0.92 quality for compression
  const type = file.type.includes("png") ? "image/png" : "image/jpeg";
  return canvas.toDataURL(type, 0.92);
}

async function createImageBitmapSafe(file: File): Promise<ImageBitmap | null> {
  try {
    if (typeof createImageBitmap !== "undefined") {
      return await createImageBitmap(file);
    }
  } catch {}
  // Fallback via Image element
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      URL.revokeObjectURL(url);
      // Fake ImageBitmap-like object
      const fake = {
        width: w,
        height: h,
        close: () => {},
        // drawImage needs HTMLImageElement
        _img: img,
      } as unknown as ImageBitmap & { _img: HTMLImageElement };
      resolve(fake as unknown as ImageBitmap);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsDataURL(file);
  });
}

export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Failed to read text file"));
    r.readAsText(file);
  });
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(file.name);
}

export function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  const textExts = [".txt", ".md", ".csv", ".json", ".js", ".ts", ".tsx", ".jsx", ".py", ".java", ".c", ".cpp", ".css", ".html", ".xml", ".yaml", ".yml", ".toml", ".ini", ".sh", ".log"];
  return textExts.some((ext) => file.name.toLowerCase().endsWith(ext));
}

// Downscale already-existing data URI (for URL pasted images that may be large)
export async function downscaleDataUri(dataUri: string, maxSize = 2048): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      if (scale >= 1) return resolve(dataUri);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUri);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUri;
  });
}

// Tiny thumbnail for localStorage persistence (max 256px)
export async function toThumbnail(dataUri: string): Promise<string> {
  return downscaleDataUri(dataUri, 256);
}
