"use client";

// Reads the text inside a QR code photo/screenshot in the browser. Photos of
// screens decode best when scaled down (it smooths out moiré), so several
// sizes are tried.
export async function decodeQrImage(file: File): Promise<string | null> {
  const jsQR = (await import("jsqr")).default;
  const bitmap = await createImageBitmap(file);
  try {
    for (const target of [400, 300, 500, 650, 800, 1200]) {
      const w = Math.min(target, bitmap.width);
      const h = Math.round((bitmap.height * w) / bitmap.width);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
      if (code?.data) return code.data;
      if (w === bitmap.width) break;
    }
    return null;
  } finally {
    bitmap.close();
  }
}
