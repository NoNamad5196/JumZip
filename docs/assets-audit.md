# Canonical asset audit

Verified 2026-09-20 against [Illustration Asset Library](https://www.notion.so/3e07cdef782d81ca9502c0f1ca17074e) and the [main product document](https://www.notion.so/3df7cdef782d812d943bf132a3dc743b).

## Runtime assets — READY

- Three original character masters: `public/assets/characters/{bomi,sani,arang}/master.png` (1024 × 1536, RGBA, transparent corners).
- All 22 original Major Arcana fronts: `public/assets/tarot/major/00_The_Fool.png` through `21_The_World.png`, with the exact canonical filenames. Strength is 08, Justice is 11, Judgement is 20.
- Canonical back: `public/assets/tarot/back.png`, extracted from `jumzip-tarot-support-assets.zip` (`tarot_back.png` is its source filename). Supplier SHA-256: `3ed93e615c3b475813bb453fe9c0191bbe9868eda29bd6812f8c9dc958c2cc38`.
- All 26 runtime files were compared byte-for-byte with their source ZIP contents. Total PNG size: 58,216,319 bytes. No generated, recolored, compressed, or substituted artwork.
- `public/assets/manifest.json` records paths, dimensions, sizes, SHA-256, and source packages. Run `node scripts/check-assets.mjs` to verify them.

## Design references — READY

`references/frontend/index.json` maps 19 original reference images to their product-document sections and classifications. This includes desktop/mobile hero, desktop/mobile chat, tarot selection/result, history, UI system, responsive rules, onboarding, login, error/settings states, and character crop guidance. The two Mobile Chat images in section 38.8 are identical in the source and both are preserved.

References are not public runtime images. Mockup character art, text, sample reading data, logos, and card imagery must not replace canonical runtime artwork or technical/API contracts.

## Supplier guidance

The five runtime packages' `manifest.json` and `README.md` files are preserved under `references/packages/`. Their manifests and usage rules were read before use. Additional character and tarot sidecar guides were read in the authenticated Notion browser; their rules agree with the package guidance.

The PNG originals remain unchanged. Hero/chat/avatar variations use CSS position, scale, crop, mask, opacity and layers. Preserve THE WORLD's intentionally different internal composition. Optional WebP derivatives may be introduced separately while preserving original masters.

## Intentional follow-up

Final wordmark/app icon SVG/PNG remains provisional in the source specification; it is not a runtime asset blocker. The wordmark text is `JumZip` with only `Zi` in `#FF7A21`. Saju visuals are structural references, not additional raster runtime assets; Saju-specific reference packages can be loaded when that milestone begins.

No temporary signed URLs or browser cookies are persisted in the repository.
