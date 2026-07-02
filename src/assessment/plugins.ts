/**
 * The assessment plugins ported from the open-path engine, in execution order.
 *
 * Excluded from the engine's set, by design:
 *  - axe-core          — auto-a11y keeps its own configurable axe check (checks/axe.ts).
 *  - iframe-checker    — auto-a11y keeps its own iframe-title check (checks/iframe-title.ts).
 *  - image-inventory   — inventory feed for the review UI, not findings.
 *  - component-detection — its payoff is DB-side component-scoped dedup, which
 *                          auto-a11y's page/issue report does not use.
 */

import type { AssessmentPlugin } from './types.js';
import { headingStructurePlugin } from './plugins/heading-structure.js';
import { landmarksPlugin } from './plugins/landmarks.js';
import { linkTextPlugin } from './plugins/link-text.js';
import { pageTitlePlugin } from './plugins/page-title.js';
import { languagePlugin } from './plugins/language.js';
import { skipLinkPlugin } from './plugins/skip-link.js';
import { formsPlugin } from './plugins/forms.js';
import { tablesPlugin } from './plugins/tables.js';
import { multimediaPlugin } from './plugins/multimedia.js';
import { linkContextPlugin } from './plugins/link-context.js';
import { motionPlugin } from './plugins/motion.js';
import { consistentNavigationPlugin } from './plugins/consistent-navigation.js';
import { consistentHelpPlugin } from './plugins/consistent-help.js';
import { targetSizePlugin } from './plugins/target-size.js';
import { textSpacingPlugin } from './plugins/text-spacing.js';
import { reflowPlugin } from './plugins/reflow.js';
import { focusVisiblePlugin } from './plugins/focus-visible.js';
import { focusObscuredPlugin } from './plugins/focus-obscured.js';

/** Default assessment plugins in execution order. */
export const assessmentPlugins: AssessmentPlugin[] = [
    headingStructurePlugin,
    landmarksPlugin,
    linkTextPlugin,
    pageTitlePlugin,
    languagePlugin,
    skipLinkPlugin,
    formsPlugin,
    tablesPlugin,
    multimediaPlugin,
    linkContextPlugin,
    motionPlugin,
    consistentNavigationPlugin,
    consistentHelpPlugin,
    targetSizePlugin,
    textSpacingPlugin,
    // reflow mutates the viewport (and restores it); run it after the other
    // measurement plugins so its resize cannot affect them.
    reflowPlugin,
    // focus-visible and focus-obscured tab through the page (focus/scroll/JS side
    // effects); they run LAST since nothing downstream depends on them.
    focusVisiblePlugin,
    focusObscuredPlugin,
];
