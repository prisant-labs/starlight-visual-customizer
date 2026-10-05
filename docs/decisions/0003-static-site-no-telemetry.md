# 0003. Ship a static build with no server, no accounts, and no telemetry

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

The studio edits a theme entirely in the browser. Every control, the preview, and the export
emitters run on the client, with no step that needs a server. Once the project moved toward a
public release, the hosting choice and the measurement choice both had to agree with that
design. Otherwise the privacy claim in the README would stop being true.

The maintainer settled on GitHub Pages as the host, served through a custom domain.
`.github/workflows/deploy.yml` builds and deploys the site on every change to `app/**`. A static
host with no origin server of its own rules out a database, an account system, and a page-side
analytics script.

Launch planning then raised a real tension. The maintainer wanted to measure adoption. But any
request-logging script on the page would break the README's promise that a theme never leaves
the visitor's browser.

## Decision

The site is a static build on GitHub Pages, with no server, no user accounts, and no telemetry
script on any page. The only third-party network requests the studio makes on its own are the
variable web-font previews it loads from `cdn.jsdelivr.net`. The README's Privacy section and
`SECURITY.md`'s scope both document this. `SECURITY.md` treats jsDelivr and GitHub Pages
themselves as out of scope. It also treats dependency advisories that only affect a shared server
cache as not applicable, because the site has no server.

To measure adoption without adding a script, the maintainer chose two kinds of signal together.
The first kind already exists outside the page: GitHub stars, forks, issues, and the GitHub
traffic API. The second is Google Search Console, verified through a DNS TXT record added at the
domain's DNS provider, with no code added to the site. The maintainer decided this on 2026-10-01,
after weighing it against two other measurement approaches.

## Consequences

- The privacy claim in the README and in the About page (`app/src/about/about.md`) stays
  literally true. Nothing about a visitor's theme or visit gets uploaded anywhere.
- There is no server to patch, scale or take down.
- Adoption numbers are weaker than a real analytics setup would give. GitHub's traffic API keeps
  only a short rolling window, and Search Console shows only search-driven visits. Counting
  exports that keep the tool's attribution line gives a lower bound on usage instead; see
  [0004 (MIT license and export attribution)](0004-mit-license-and-export-attribution.md).
- Some security advisories only matter for a server with shared caches, such as an HTTP caching
  library's advisory. Those advisories can be dismissed outright instead of investigated, because
  the site has no such server.

## Alternatives considered

- A hosted backend with accounts and saved themes server-side. Rejected, because the product's
  whole pitch is that nothing leaves the browser. A server would also need its own security and
  privacy review.
- Privacy-friendly page analytics, even a lightweight script with no cookies. Rejected, because
  it would still require rewriting the README's privacy promise.
- Outside signals alone, with no Search Console. Rejected, because it gives up search visibility
  that a DNS-verified property provides for free.
