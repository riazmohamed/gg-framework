// IIFE entry — for HTML+CDN renderers (Electron multi-window apps,
// classic websites, anything without a bundler). When loaded via
// `<script src="gg-pixel.browser.iife.js"></script>`, it exposes the
// SDK as `globalThis.GGPixel` (and `window.GGPixel`):
//
//   <script src="gg-pixel.browser.iife.js"></script>
//   <script>
//     GGPixel.initPixel({ projectKey: "pk_live_...", ingestUrl: "..." });
//   </script>
import * as Pixel from "./browser.js";

const target =
  typeof globalThis !== "undefined"
    ? globalThis
    : typeof window !== "undefined"
      ? (window as unknown as Record<string, unknown>)
      : (undefined as unknown as Record<string, unknown>);
if (target) (target as Record<string, unknown>).GGPixel = Pixel;

export default Pixel;
