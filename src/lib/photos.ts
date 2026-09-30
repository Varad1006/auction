// Turns a photo link from a sheet/form into a URL an <img> can display.
//
// Google Form file uploads are Google Drive links, which aren't images
// themselves; Drive serves the image at lh3.googleusercontent.com/d/<id>.
// The files must be shared as "Anyone with the link can view".

const DRIVE_ID = [
  /drive\.google\.com\/file\/d\/([\w-]{10,})/,
  /drive\.google\.com\/(?:open|uc|thumbnail)\?(?:.*&)?id=([\w-]{10,})/,
  /docs\.google\.com\/uc\?(?:.*&)?id=([\w-]{10,})/,
  /lh3\.googleusercontent\.com\/d\/([\w-]{10,})/,
];

export function driveFileId(url: string): string | null {
  for (const re of DRIVE_ID) {
    const m = re.exec(url);
    if (m) return m[1];
  }
  return null;
}

export function photoUrlFrom(raw: string | null | undefined): string | null {
  // Forms can store several uploads comma-separated; use the first.
  const url = (raw ?? "").split(/[\s,]+/).find((s) => /^https?:\/\//.test(s));
  if (!url) return null;
  const id = driveFileId(url);
  if (id) return `https://lh3.googleusercontent.com/d/${id}=w800`;
  return url.startsWith("https://") ? url.slice(0, 500) : null;
}
