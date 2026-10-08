# Architecture decision records

A decision record is a short, dated page that explains one choice this project made and why. A
later contributor should not have to guess, or re-litigate it. Add one when a change is hard to
reverse, affects more than one file, or is likely to come up again as a question. An example
question is "why does the root show a product page and not the studio?"

| # | Title | Status | Date |
|---|---|---|---|
| 0001 | [The root URL serves a product page; the studio stays at /studio/](0001-product-page-at-root.md) | Accepted | 2026-10-01 |
| 0002 | [Check every outside theme on entry, and guard export output again](0002-sanitize-outside-themes-and-exports.md) | Accepted | 2026-10-03 |
| 0003 | [Ship a static build with no server, no accounts, and no telemetry](0003-static-site-no-telemetry.md) | Accepted | 2026-10-01 |
| 0004 | [The code is MIT; exports belong to the user; attribution is optional](0004-mit-license-and-export-attribution.md) | Accepted | 2026-10-01 |
| 0005 | [Pin each release to one Starlight version, enforced by a test](0005-pin-one-starlight-version.md) | Accepted | 2026-09-25 |
| 0006 | [The About page is a standalone Astro page, not Starlight content](0006-standalone-about-page.md) | Accepted | 2026-10-01 |
| 0007 | [The Export dialog leads with two ways to reach your own site](0007-export-dialog.md) | Accepted | 2026-10-07 |

To add a record, copy [`_template.md`](_template.md), take the next number, and fill in the four
sections. Open it in the same pull request as the change it documents, so the reasoning and the
code land together.
