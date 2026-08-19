# Fix report: https://www.zuddl.com/compare/cvent

Tested as: **mobile**
Measured: 2026-08-19T19:46:05.422Z · Lighthouse 13.4.1

## Current scores

| Category | Score | |
|---|---:|---|
| Performance | 47 | poor |
| Accessibility | 90 | good |
| Best Practices | 54 | needs work |
| SEO | 92 | good |

## Metrics

| Metric | Lab | Real users (75th pct) | Target |
|---|---:|---:|---|
| LCP | 5.0 s | 2.5 s | under 2.5 s |
| CLS | 0.011 | 0.000 | under 0.1 |
| INP | not measurable in lab | 183 ms | under 200 ms |
| TBT | 1.1 s | — | under 200 ms |
| FCP | 3.7 s | 2.4 s | under 1.8 s |
| TTFB | 7 ms | 581 ms | under 800 ms |

> Real-user figures are site-wide, not this page: it has too little traffic of its own. Treat them as context, not as this page's behaviour.

## Problems to fix, highest impact first

Each entry lists the specific resources responsible.

### 1. Network dependency tree

[Avoid chaining critical requests](https://developer.chrome.com/docs/performance/insights/network-dependency-tree) by reducing the length of chains, reducing the download size of resources, or deferring the download of unnecessary resources to improve page load.

### 2. LCP request discovery

[Optimize LCP](https://developer.chrome.com/docs/performance/insights/lcp-discovery) by making the LCP image discoverable from the HTML immediately, and avoiding lazy-loading

### 3. Use efficient cache lifetimes
**Measured cost:** Est savings of 310 KiB

A long cache lifetime can speed up repeat visits to your page. [Learn more about caching](https://developer.chrome.com/docs/performance/insights/cache).

Affected:

| Request | Cache TTL | Transfer Size |
|---|---|---|
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 1209600.00 s | 221 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 1209600.00 s | 221 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 1209600.00 s | 221 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 1209600.00 s | 221 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 1209600.00 s | 221 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 1209600.00 s | 221 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 1209600.00 s | 221 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 1209600.00 s | 221 KiB |
| https://cdn.prod.website-files.com/601fab1cb6249b3cc9f592f0/664f2394b806d40a251df9e9_hero-img-asset-p-800.avif | 84600.00 s | 30 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js | 1209600.00 s | 94 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js | 1209600.00 s | 94 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js | 1209600.00 s | 94 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js | 1209600.00 s | 94 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js | 1209600.00 s | 94 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js | 1209600.00 s | 94 KiB |

_(first 15 shown)_

### 4. Legacy JavaScript
**Measured cost:** Est savings of 10 KiB

Polyfills and transforms enable older browsers to use new JavaScript features. However, many aren't necessary for modern browsers. Consider modifying your JavaScript build process to not transpile [Baseline](https://web.dev/articles/baseline-and-polyfills) features, unless you know you must support older browsers. [Learn why most sites can deploy ES6+ code without transpiling](https://developer.chrome.com/docs/performance/insights/legacy-javascript)

Affected:

| URL | Wasted bytes |
|---|---|
| https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js | 10 KiB |

### 5. Render-blocking requests
**Measured cost:** saves ~2.4 s · Est savings of 2,420 ms

Requests are blocking the page's initial render, which may delay LCP. [Deferring or inlining](https://developer.chrome.com/docs/performance/insights/render-blocking) can move these network requests out of the critical path.

Affected:

| URL | Transfer Size | Duration |
|---|---|---|
| https://use.typekit.net/aky8gqr.js | 7 KiB | 902 ms |
| https://cdn.prod.website-files.com/601fab1cb6249b3cc9f592f0/css/zuddlforevents.664eb89a53151a9999ffa058.03fd8c52e.opt.min.css | 84 KiB | 1.65 s |
| https://cdn.prod.website-files.com/601fab1cb6249b3cc9f592f0/css/zuddlforevents.shared.a74df9a86.min.css | 9 KiB | 751 ms |
| https://ajax.googleapis.com/ajax/libs/webfont/1.6.26/webfont.js | 6 KiB | 780 ms |

### 6. Font display
**Measured cost:** saves ~300 ms · Est savings of 320 ms

Consider setting [`font-display`](https://developer.chrome.com/docs/performance/insights/font-display) to `swap` or `optional` to ensure text is consistently visible. `swap` can be further optimized to mitigate layout shifts with [font metric overrides](https://developer.chrome.com/blog/font-fallbacks).

Affected:

| URL | Est Savings |
|---|---|
| https://use.typekit.net/af/dfd213/00000000000000007735f914/31/l?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=i4&v=3 | 315 ms |
| https://use.typekit.net/af/c87b5e/00000000000000007735f910/31/l?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n4&v=3 | 155 ms |
| https://use.typekit.net/af/cbe655/00000000000000007735f90b/31/l?subset_id=2&fvd=n6&v=3 | 155 ms |
| https://use.typekit.net/af/448a2a/00000000000000007735f911/31/l?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=i7&v=3 | 10 ms |
| https://use.typekit.net/af/f1d6d6/00000000000000007755a5e4/31/l?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=i4&v=3 | 10 ms |
| https://use.typekit.net/af/3b1c92/000000000000000077554a61/31/l?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n4&v=3 | 10 ms |
| https://use.typekit.net/af/43588d/0000000000000000775d8237/31/l?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n6&v=3 | 10 ms |
| https://use.typekit.net/af/f22fbb/0000000000000000775d8239/31/l?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n7&v=3 | 10 ms |
| https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9H6as8bTXq_nANBjzKo3IeZx8z6up5BeSl5jBNz_19PpbpMXuECpwUxJBOm_OJWiawA1XphjhQYg.woff2 | 5 ms |
| https://use.typekit.net/af/f84176/00000000000000007735f907/31/l?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n7&v=3 | 5 ms |

_(first 10 shown)_

## Diagnostics

Contributing factors rather than direct wins.

### 1. Reduce unused JavaScript
**Measured cost:** 1.4 MiB smaller · Est savings of 1,479 KiB

Reduce unused JavaScript and defer loading scripts until they are required to decrease bytes consumed by network activity. [Learn how to reduce unused JavaScript](https://developer.chrome.com/docs/lighthouse/performance/unused-javascript/).

Affected:

| URL | Transfer Size | Est Savings |
|---|---|---|
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 220 KiB | 128 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 220 KiB | 128 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 220 KiB | 127 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 220 KiB | 127 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 220 KiB | 127 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 220 KiB | 127 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 220 KiB | 127 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 220 KiB | 126 KiB |
| https://cdn.prod.website-files.com/601fab1cb6249b3cc9f592f0/js/zuddlforevents.achunk.c42549641b7d4501.js | 75 KiB | 50 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js | 93 KiB | 48 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js | 93 KiB | 48 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js | 93 KiB | 48 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js | 93 KiB | 48 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js | 93 KiB | 48 KiB |
| https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js | 93 KiB | 48 KiB |

_(first 15 shown)_

### 2. Avoid enormous network payloads
**Measured cost:** Total size was 40,716 KiB

Large network payloads cost users real money and are highly correlated with long load times. [Learn how to reduce payload sizes](https://developer.chrome.com/docs/lighthouse/performance/total-byte-weight/).

Affected:

| URL | Transfer Size |
|---|---|
| https://vod-adaptive-ak.vimeocdn.com/exp=1787172323~acl=%2F2a7d4c14-6301-4b90-9ff4-6b11908be2c7%2Fpsid%3D65ed7d6bfaa68bf9f4b3e30641170d54ab1544dd1787168723%2F%2A~hmac=f1a516cb3fa036401ff4fefad44776076… | 2.2 MiB |
| https://vod-adaptive-ak.vimeocdn.com/exp=1787172323~acl=%2F2a7d4c14-6301-4b90-9ff4-6b11908be2c7%2Fpsid%3Ded149c6422d573c3ef3a07d1a6653df1390f2c911787168723%2F%2A~hmac=e09b2629f07cb17428c6d4184c5887fd6… | 2.2 MiB |
| https://vod-adaptive-ak.vimeocdn.com/exp=1787172323~acl=%2F2a7d4c14-6301-4b90-9ff4-6b11908be2c7%2Fpsid%3D5dc5f0ef9f06b7098b9995aeb3e6958127a2cf421787168723%2F%2A~hmac=087632eb576c25515d46c505e823c10ab… | 2.2 MiB |
| https://vod-adaptive-ak.vimeocdn.com/exp=1787172323~acl=%2F2a7d4c14-6301-4b90-9ff4-6b11908be2c7%2Fpsid%3Df5a54c42ada49ec21b7ca64e1fb76cd2e86acf221787168723%2F%2A~hmac=92255224b1159c1ea25104e6feb787695… | 2.2 MiB |
| https://vod-adaptive-ak.vimeocdn.com/exp=1787172323~acl=%2F2a7d4c14-6301-4b90-9ff4-6b11908be2c7%2Fpsid%3Ded149c6422d573c3ef3a07d1a6653df1390f2c911787168723%2F%2A~hmac=e09b2629f07cb17428c6d4184c5887fd6… | 2.0 MiB |
| https://vod-adaptive-ak.vimeocdn.com/exp=1787172323~acl=%2F2a7d4c14-6301-4b90-9ff4-6b11908be2c7%2Fpsid%3Df5a54c42ada49ec21b7ca64e1fb76cd2e86acf221787168723%2F%2A~hmac=92255224b1159c1ea25104e6feb787695… | 2.0 MiB |
| https://vod-adaptive-ak.vimeocdn.com/exp=1787172323~acl=%2F2a7d4c14-6301-4b90-9ff4-6b11908be2c7%2Fpsid%3D5dc5f0ef9f06b7098b9995aeb3e6958127a2cf421787168723%2F%2A~hmac=087632eb576c25515d46c505e823c10ab… | 2.0 MiB |
| https://vod-adaptive-ak.vimeocdn.com/exp=1787172323~acl=%2F2a7d4c14-6301-4b90-9ff4-6b11908be2c7%2Fpsid%3D65ed7d6bfaa68bf9f4b3e30641170d54ab1544dd1787168723%2F%2A~hmac=f1a516cb3fa036401ff4fefad44776076… | 2.0 MiB |
| https://vod-adaptive-ak.vimeocdn.com/exp=1787172323~acl=%2F2a7d4c14-6301-4b90-9ff4-6b11908be2c7%2Fpsid%3D5dc5f0ef9f06b7098b9995aeb3e6958127a2cf421787168723%2F%2A~hmac=087632eb576c25515d46c505e823c10ab… | 2.0 MiB |
| https://vod-adaptive-ak.vimeocdn.com/exp=1787172323~acl=%2F2a7d4c14-6301-4b90-9ff4-6b11908be2c7%2Fpsid%3Ded149c6422d573c3ef3a07d1a6653df1390f2c911787168723%2F%2A~hmac=e09b2629f07cb17428c6d4184c5887fd6… | 2.0 MiB |

_(first 10 shown)_

### 3. Image elements do not have explicit `width` and `height`

Set an explicit width and height on image elements to reduce layout shifts and improve CLS. [Learn how to set image dimensions](https://web.dev/articles/optimize-cls#images_without_dimensions)

Affected:

| node | URL |
|---|---|
| <img src="https://cdn.prod.website-files.com/601fab1cb6249b3cc9f592f0/664f2394b806d4…" loading="lazy" sizes="(max-width: 1170px) 100vw, 1170px" srcset="https://cdn.prod.website-files.com/601fab1cb6249… | https://cdn.prod.website-files.com/601fab1cb6249b3cc9f592f0/664f2394b806d40a251df9e9_hero-img-asset-p-800.avif |
| <img class="full-width" style="max-width: 200px; max-height:56px" alt="Read Zuddl reviews on G2" src="https://www.g2.com/products/zuddl/widgets/stars?color=white&amp;type=read"> | https://www.g2.com/products/zuddl/widgets/stars?color=white&type=read |
| <img alt="Zuddl Reviews" src="https://b.sf-syn.com/badge_img/3350669/light-default?&amp;variant_id=sf&amp;r=http…" style="min-width: 60px; max-width:200px; width:100%;"> | https://b.sf-syn.com/badge_img/3350669/light-default?&variant_id=sf&r=https://www.zuddl.com/compare/cvent |

### 4. Reduce JavaScript execution time
**Measured cost:** saves ~1.4 s · 6.3 s

Consider reducing the time spent parsing, compiling, and executing JS. You may find delivering smaller JS payloads helps with this. [Learn how to reduce Javascript execution time](https://developer.chrome.com/docs/lighthouse/performance/bootup-time/).

Affected:

| URL | Total CPU Time | Script Evaluation | Script Parse |
|---|---|---|---|
| https://f.vimeocdn.com/p/4.46.93/js/player.module.js | 5.01 s | 3.40 s | 545 ms |
| https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js | 1.76 s | 1.34 s | 266 ms |
| Unattributable | 678 ms | 28 ms | 0 ms |
| https://cdn.prod.website-files.com/601fab1cb6249b3cc9f592f0/js/zuddlforevents.achunk.7c91bc2d2946f1ff.js | 637 ms | 270 ms | 94 ms |
| https://www.zuddl.com/compare/cvent | 430 ms | 76 ms | 5 ms |
| https://cdn.prod.website-files.com/601fab1cb6249b3cc9f592f0/js/zuddlforevents.achunk.58f76f2901951073.js | 328 ms | 65 ms | 7 ms |
| https://player.vimeo.com/video/929019372?quality=720p&autoplay=1&muted=1&loop=1&controls=1&background=0;badge=0&autopause=0&player_id=0&app_id=58479 | 80 ms | 48 ms | 22 ms |
| https://player.vimeo.com/api/player.js | 74 ms | 44 ms | 16 ms |
| https://f.vimeocdn.com/p/4.46.93/css/player.css | 67 ms | 4 ms | 0 ms |
| https://cdn.prod.website-files.com/601fab1cb6249b3cc9f592f0/js/zuddlforevents.achunk.c42549641b7d4501.js | 61 ms | 37 ms | 23 ms |

_(first 10 shown)_

### 5. Minimize main-thread work
**Measured cost:** saves ~1.1 s · 9.5 s

Consider reducing the time spent parsing, compiling and executing JS. You may find delivering smaller JS payloads helps with this. [Learn how to minimize main-thread work](https://developer.chrome.com/docs/lighthouse/performance/mainthread-work-breakdown/)

Affected:

| Category | Time Spent |
|---|---|
| Script Evaluation | 5.49 s |
| Other | 2.00 s |
| Script Parsing & Compilation | 1.04 s |
| Garbage Collection | 470 ms |
| Style & Layout | 237 ms |
| Parse HTML & CSS | 147 ms |
| Rendering | 105 ms |

### 6. Reduce unused CSS
**Measured cost:** saves ~450 ms · 98 KiB smaller · Est savings of 98 KiB

Reduce unused rules from stylesheets and defer CSS not used for above-the-fold content to decrease bytes consumed by network activity. [Learn how to reduce unused CSS](https://developer.chrome.com/docs/lighthouse/performance/unused-css-rules/).

Affected:

| URL | Transfer Size | Est Savings |
|---|---|---|
| https://cdn.prod.website-files.com/601fab1cb6249b3cc9f592f0/css/zuddlforevents.664eb89a53151a9999ffa058.03fd8c52e.opt.min.css | 83 KiB | 74 KiB |
| https://f.vimeocdn.com/p/4.46.93/css/player.css | 24 KiB | 24 KiB |

## Accessibility, best practices and SEO

Usually concrete and cheap to fix.

### 1. Links do not have a discernible name

Link text (and alternate text for images, when used as links) that is discernible, unique, and focusable improves the navigation experience for screen reader users. [Learn how to make links accessible](https://dequeuniversity.com/rules/axe/4.12/link-name).

Affected:

| Failing Elements |
|---|
| <a href="https://www.g2.com/products/zuddl/reviews" target="_blank" class="g2-home-center w-inline-block" data-faitracker-click-bind="true"> |

### 2. Links do not have descriptive text
**Measured cost:** 4 links found

Descriptive link text helps search engines understand your content. [Learn how to make links more accessible](https://developer.chrome.com/docs/lighthouse/seo/link-text/).

Affected:

| Link destination | Link Text |
|---|---|
| https://www.zuddl.com/agentic-events-platform | Learn more |
| https://www.zuddl.com/agentic-events-platform | Learn more |
| https://www.zuddl.com/agentic-events-platform | Learn more |
| https://www.zuddl.com/event-integrations | here |

### 3. Uses deprecated APIs
**Measured cost:** 1 warning found

Deprecated APIs will eventually be removed from the browser. [Learn more about deprecated APIs](https://developer.chrome.com/docs/lighthouse/best-practices/deprecations/).

Affected:

| Deprecation / Warning | Source |
|---|---|
| Unload event listeners are deprecated and will be removed. | https://f.vimeocdn.com/p/4.46.93/js/vendor.module.js |

### 4. Browser errors were logged to the console

Errors logged to the console indicate unresolved problems. They can come from network request failures and other browser concerns. [Learn more about this errors in console diagnostic audit](https://developer.chrome.com/docs/lighthouse/best-practices/errors-in-console/)

Affected:

| Source | Description |
|---|---|
| https://aplo-evnt.com/api/v1/intent_pixel/track_request?app_id=66325a2d722fff0571c68941 | Failed to load resource: the server responded with a status of 400 (Bad Request) |
| https://www.zuddl.com/compare/cvent | TypeError: Cannot read properties of undefined (reading 'addEventListener')
    at https://www.zuddl.com/compare/cvent:1947:24
    at NodeList.forEach (<anonymous>)
    at https://www.zuddl.com/compar… |

### 5. Uses third-party cookies
**Measured cost:** 3 cookies found

Third-party cookies may be blocked in some contexts. [Learn more about preparing for third-party cookie restrictions](https://privacysandbox.google.com/cookies/prepare/overview).

Affected:

| Name | URL |
|---|---|
| __cf_bm | https://player.vimeo.com/video/929019372?quality=720p&autoplay=1&muted=1&loop=1&controls=1&background=0;badge=0&autopause=0&player_id=0&app_id=58479 |
| player | https://player.vimeo.com/video/929019372?quality=720p&autoplay=1&muted=1&loop=1&controls=0&background=1;badge=0&autopause=0&player_id=0&app_id=58479 |
| vuid | https://player.vimeo.com/video/929019372?quality=720p&autoplay=1&muted=1&loop=1&controls=0&background=1;badge=0&autopause=0&player_id=0&app_id=58479 |

### 6. Heading elements are not in a sequentially-descending order

Properly ordered headings that do not skip levels convey the semantic structure of the page, making it easier to navigate and understand when using assistive technologies. [Learn more about heading order](https://dequeuniversity.com/rules/axe/4.12/heading-order).

Affected:

| Failing Elements |
|---|
| <h4 class="h4-24px p-600"> |

### 7. Issues were logged in the `Issues` panel in Chrome Devtools

Issues logged to the `Issues` panel in Chrome Devtools indicate unresolved problems. They can come from network request failures, insufficient security controls, and other browser concerns. Open up the Issues panel in Chrome DevTools for more details on each issue.

Affected:

| Issue type |
|---|
| Cookie |

### 8. Document does not have a main landmark.

One main landmark helps screen reader users navigate a web page. [Learn more about landmarks](https://dequeuniversity.com/rules/axe/4.12/landmark-one-main).

Affected:

| Failing Elements |
|---|
| <html data-wf-domain="www.zuddl.com" data-wf-page="664eb89a53151a9999ffa058" data-wf-site="601fab1cb6249b3cc9f592f0" lang="en" class="wf-bricolagegrotesque-n7-active wf-bricolagegrotesque-n3-active wf… |

### 9. Background and foreground colors do not have a sufficient contrast ratio.

Low-contrast text is difficult or impossible for many users to read. [Learn how to provide sufficient color contrast](https://dequeuniversity.com/rules/axe/4.12/color-contrast).

Affected:

| Failing Elements |
|---|
| <div class="h5-24px _600 b-300"> |

---

## Instructions

Work through the problems above in order; they are sorted by measured impact.

- The resource URLs and selectors above are real and taken from this page. Locate them in the codebase before changing anything.
- This report cannot see the codebase, so it does not know the framework or build setup. Determine that yourself and apply the fix in the way that stack actually supports.
- Some findings may not be fixable from application code — a third-party tag, a CDN setting, a CMS constraint. Say so rather than working around it.
- Do not change anything listed as already passing.
- Re-run the audit afterwards to confirm the numbers moved.