// Browser platform checks (call only in the browser).

/** Whether the app runs from the home screen (installed PWA). */
export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function platform(): "ios" | "ios-inapp" | "other" | "installed" {
  if (isStandalone()) return "installed";
  if (!isIOS()) return "other";
  const ua = navigator.userAgent;
  // In-app browsers (WhatsApp, Instagram, Facebook...) can't add to home screen.
  return /FBAN|FBAV|Instagram|WhatsApp|Line\//.test(ua) ? "ios-inapp" : "ios";
}
