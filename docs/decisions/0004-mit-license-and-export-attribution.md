# 0004. The code is MIT; exports belong to the user; attribution is optional

- **Status:** Accepted
- **Date:** 2026-10-01 (license and export ownership); 2026-10-02 (attribution placement)

## Context

Every exported `theme.css` file carries a header comment that the studio writes. Once the
project's own code was released under the MIT license, a question followed. A user who exported
a theme could reasonably ask whether MIT's notice requirement travels with that file into their
own site. The project also wanted a way to notice adoption without adding any tracking script
(see [0003 (static site, no telemetry)](0003-static-site-no-telemetry.md)). A link back to the
tool inside each export was one option, provided it did not read as a license obligation.

## Decision

The project's own source stays MIT licensed. The three files a user exports, `theme.css`,
`APPLY-THEME.md`, and the state file, belong to the person who exports them. The README and the
About page both state that these files are the user's. The user may use, change, and publish them
however they like, with no attribution or license notice required. This was decided on 2026-10-01
and shipped in PR #8 (exported themes belong to the user).

`theme.css` names the tool, with a link, in its header comment. `APPLY-THEME.md` ends with the
same line. Both come from one shared `TOOL_URL` constant in `app/src/customizer/core/project.js`,
and both lines can be deleted without losing anything the license requires. The placement and
wording were decided on 2026-10-02 and shipped in PR #15 (export attribution). A review caught
that an earlier draft of the credit line read as if it contradicted the no-attribution promise.

## Consequences

- Users get a clean answer to "can I keep this and strip out every mention of the tool": yes.
  The README says so next to the credit line itself, so the promise and the files agree.
- The credit line gives the project a way to estimate adoption, by searching public code for the
  header string. It needs no script added to any page. The count is only a lower bound, because
  users may delete the line.
- Keeping the exported files free of license obligations costs nothing in the exporters.
  `theme.css` and `APPLY-THEME.md` were already generated fresh per theme, rather than copied from
  a template.
- The golden test files in `app/tests/golden/` had to be regenerated, because the header change
  touched the first lines of every export. PR #15 (export attribution) added
  `npm run golden:update` to do that.

## Alternatives considered

- Require the credit line to stay in every export. Rejected: it would conflict with the
  philosophy that exported output is the user's own file, not a licensed template.
- Add no link to exports at all. Considered, but rejected once the no-telemetry measurement
  problem (0003) made a removable credit line the simplest adoption signal available.
