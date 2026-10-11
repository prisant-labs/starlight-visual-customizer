/**
 * @file The project's own public addresses. Every page that links to the source repo or the
 * projects hub (the studio's top bar, the About dialog, the standalone /about/ page) imports these,
 * so a repo rename or a hub move touches one line.
 */
export const REPO_URL = 'https://github.com/prisant-labs/starlight-visual-customizer';
/** GitHub's issue chooser: the bug form, the feature form and the contact links in `.github/ISSUE_TEMPLATE/`. */
export const ISSUES_URL = `${REPO_URL}/issues/new/choose`;
export const HUB_URL = 'https://projects.prisantlabs.com/';
/** The tool's own public address: the product page, with the studio at `studio/` below it. */
export const TOOL_URL = 'https://projects.prisantlabs.com/starlight-visual-customizer/';
