<!--
Release notes template. Copy this file to docs/releases/vX.Y.Z.md in the release-prep pull request,
fill it in, and delete every comment. See docs/releasing.md for the whole release process.

Rules that keep the notes readable:
- Do not start the file with a "# vX.Y.Z" heading. GitHub shows the release title above the body,
  so a heading here would print the title twice.
- Use absolute links only. A release page cannot resolve a relative link such as docs/studio.md.
  Pin images to the tag, for example
  https://github.com/prisant-labs/starlight-visual-customizer/raw/vX.Y.Z/docs/images/studio.png.
- Write for someone who uses the studio, not for someone who reads the code. CHANGELOG.md keeps the
  short technical list; these notes say what changed for people and why it matters.
- Pair each highlight with an "Under the hood" note only when the mechanism builds trust or helps
  someone apply the change. Skip it for small items.
- Keep sentences short. Each one should carry one idea.
-->

**<One sentence: what this release lets people do that they could not do before.>**

**[Open the studio](https://projects.prisantlabs.com/starlight-visual-customizer/studio/)** · [See the product page](https://projects.prisantlabs.com/starlight-visual-customizer/)

<!-- Optional: one screenshot of the headline change, pinned to this release's tag. -->

## Highlights

<!--
Order the highlights along the path a person takes through the studio:
start, design, check, export, share. Leave out the steps this release does not touch.
-->

### <Highlight, stated as what a person can now do>

<Two to four sentences: the change, and why it matters to the person using it.>

> **Under the hood:** <One to three sentences on how it works, when that helps someone trust or apply it.>

### <Next highlight>

<...>

## Fixes

<!-- One bullet per fix that a person could have noticed. Say what went wrong and what happens now. -->

- **<What was wrong, in the user's terms>.** <What happens now.>

## Upgrading

<!--
Required when the targeted Starlight or Astro version changes, or when an export changes shape.
Delete the section otherwise.
-->

- **This release targets Starlight <version> and Astro <version>.** <What someone with an older export should do, if anything.>
- **Exports changed.** <What is different in theme.css or APPLY-THEME.md, and whether to re-export.>

## Known limits

<!-- Carry forward the limits that still apply from the previous release, and add new ones. -->

- **<Limit>.** <What it means for the person, and the workaround if one exists.>

## What's next

<!-- Optional. Only name work that is genuinely planned; this is a public commitment. -->

## Get involved

- **Found a bug?** [Open an issue](https://github.com/prisant-labs/starlight-visual-customizer/issues/new/choose).
- **Made a theme you like?** Post its share link in [Show and tell](https://github.com/prisant-labs/starlight-visual-customizer/discussions/categories/show-and-tell).
- **Have a question?** Ask it in [Q&A](https://github.com/prisant-labs/starlight-visual-customizer/discussions/categories/q-a).

---

**Full changelog:** [CHANGELOG.md](https://github.com/prisant-labs/starlight-visual-customizer/blob/vX.Y.Z/CHANGELOG.md)
