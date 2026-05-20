# Polymarket Ticker — WSJ MarketWatch Front Page Creatives

Banner ad creatives for the Polymarket × WSJ MarketWatch Front Page private-markets buy. Self-contained static site with two creative variants (V1 — Private Markets, V2 — AI Race) across 8 IAB-standard and custom sizes.

## Live preview

```
https://<your-host>/preview.html
```

The preview UI lets you flip between V1/V2 and every size, with cache-busted iframe reloads so the latest deploy is always shown.

## Available sizes

| Size | Use |
|---|---|
| 728×90  | Leaderboard |
| 970×250 | Billboard |
| 300×250 | Medium Rectangle |
| 300×600 | Half Page |
| 600×500 | WSJ Custom |
| 1280×500 | WSJ Wide Takeover |
| 1960×500 | WSJ Super Wide |
| 3800×800 | WSJ Masthead |

## Two flavors per size

- **`/embed/{w}x{h}.html`** — ~13 KB, references shared assets at `/assets/`. Best for serving on the same domain.
- **`/standalone/{w}x{h}.html`** — ~365 KB, fully self-contained (every PNG/SVG base64-inlined). Drop-in for any host.

Both variants render an identical creative.

## Embed snippet

```html
<iframe src="https://<your-host>/embed/728x90.html"
        width="728" height="90"
        frameborder="0" scrolling="no"
        style="border:none;display:block;"></iframe>
```

Swap the path for any size or for `/standalone/{w}x{h}.html`.

## Click attribution

Every creative click-throughs to a Polymarket AppsFlyer OneLink:

```
https://polymarket-app.onelink.me/S8ac
  ?pid=WSJ
  &c=MWFP
  &deep_link_sub1=PRIVATES
  &af_sub1=wsj_mwfp_<format>
  &af_ad=privates_v1
  &af_xp=referral
  &is_retargeting=true
  &af_reengagement_window=30d
```

Per-format `af_sub1` lets you slice CTR by placement in AppsFlyer.

## Folder layout

```
public/
  index.html              # landing
  preview.html            # internal preview UI (size + variant picker)
  embed/                  # V1 creatives — lightweight, refs /assets/
  embed-v2/               # V2 creatives — same
  standalone/             # V1 creatives — self-contained
  standalone-v2/          # V2 creatives — same
  assets/                 # 35 shared SVG/PNG files used by /embed/
    fonts/                # self-hosted font (Reckless trial)
api/
  markets.js              # serverless gamma-api proxy, 1 h edge cache
vercel.json               # CORS + X-Frame-Options: ALLOWALL + frame-ancestors *
```

## Live data

The bottom ticker on each creative pulls live odds from Polymarket's gamma-api. The repo includes a serverless proxy at `api/markets.js` (1-hour edge-cached) but the creatives currently call gamma-api directly — flip them to the proxy if you hit rate limits.

## Hosting recommendation

These creatives are **already cleaned of all common ad-blocker triggers** — no `/ads/` paths, no `ad-*` CSS classes, no `<meta name="ad.size">`, no DoubleClick Studio Enabler.js, no Google Fonts CDN. They render in Chrome, Safari, Arc, Dia, and Brave-without-shields.

For best results across **all** browsers (some aggressive blockers still pattern-match on generic `*.vercel.app` hosts):

- **Recommended:** serve from a polymarket.com subdomain — e.g. `ticker.polymarket.com` or `private-banners.polymarket.com`. Subdomains of known brand domains pass tracker blockers' allow-lists automatically.
- DNS: add a `CNAME` from `<chosen-subdomain>.polymarket.com` → `cname.vercel-dns.com` (Vercel) or your host's equivalent.

## Local dev

```bash
cd public
python3 -m http.server 8000
open http://localhost:8000/preview.html
```

The `api/markets` proxy needs a Node runtime — for local dev use `vercel dev` instead.

## Deploy

```bash
vercel --prod --yes
```

Vercel auto-detects `vercel.json` for headers and `api/*.js` for serverless functions.
