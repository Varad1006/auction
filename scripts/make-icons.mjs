// Renders the app icons from an inline SVG. Run: npm run icons
import sharp from "sharp";

const svg = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 96}" fill="#020617"/>
  <g transform="translate(256 256) scale(${pad ? 0.72 : 1}) translate(-256 -256)">
    <circle cx="256" cy="256" r="176" fill="#fbbf24"/>
    <circle cx="256" cy="256" r="150" fill="#b91c1c"/>
    <path d="M138 190 C 168 225, 168 287, 138 322" stroke="#fde68a" stroke-width="10" fill="none" stroke-dasharray="14 12"/>
    <path d="M374 190 C 344 225, 344 287, 374 322" stroke="#fde68a" stroke-width="10" fill="none" stroke-dasharray="14 12"/>
    <text x="256" y="292" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="104" fill="#fff">BID</text>
  </g>
</svg>`;

const out = [
  ["public/icons/icon-192.png", 192, false],
  ["public/icons/icon-512.png", 512, false],
  ["public/icons/maskable-512.png", 512, true],
  ["public/icons/apple-touch-icon.png", 180, true],
  ["src/app/icon.png", 64, false],
];
for (const [file, size, pad] of out) {
  const img = sharp(Buffer.from(svg(pad))).resize(size, size);
  await img.png().toFile(file);
  console.log("wrote", file);
}
