/**
 * Multimedia plugin.
 *
 * Static checks on native <video>/<audio> mapped to RAWeb topic 4 / WCAG 1.2.x,
 * 1.4.2, 2.1.1. Cross-origin embedded players (<iframe>, <object>) cannot be
 * introspected and are out of scope.
 *
 *  - video-missing-captions          — <video> with no captions/subtitles track
 *                                      (1.2.2 / RAWeb 4.3)
 *  - video-missing-audio-description — <video> with no descriptions track
 *                                      (1.2.5 / RAWeb 4.5) — verify manually, an
 *                                      integrated described version also satisfies this
 *  - media-autoplay-no-control       — autoplay media that is not muted and has
 *                                      no controls (1.4.2 / RAWeb 4.10)
 *  - media-no-controls               — media with no native controls and no
 *                                      autoplay; verify keyboard-accessible custom
 *                                      controls exist (2.1.1 / RAWeb 4.11)
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
    IssueSeverity,
} from '../types.js';

interface MediaData {
    tag: 'video' | 'audio';
    selector: string;
    hasControls: boolean;
    hasAutoplay: boolean;
    isMuted: boolean;
    hasCaptions: boolean;
    hasDescriptions: boolean;
    outerHTML: string;
}

function collectMediaData(el: HTMLMediaElement): MediaData {
    const kinds = Array.from(el.querySelectorAll('track')).map((t) =>
        (t.getAttribute('kind') || 'subtitles').toLowerCase(),
    );

    return {
        tag: el.tagName.toLowerCase() as 'video' | 'audio',
        selector: window.__a11y.cssPath(el),
        hasControls: el.hasAttribute('controls'),
        hasAutoplay: el.hasAttribute('autoplay'),
        isMuted: el.hasAttribute('muted'),
        hasCaptions: kinds.some((k) => k === 'captions' || k === 'subtitles'),
        hasDescriptions: kinds.some((k) => k === 'descriptions'),
        outerHTML: el.outerHTML.slice(0, 300),
    };
}

export const multimediaPlugin: AssessmentPlugin = {
    id: 'multimedia',
    name: 'Multimedia',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[multimedia] Scanning media elements...');

        const issues: AccessibilityIssue[] = [];
        const handles = await ctx.queryHandles('video, audio');
        const axInfos = await ctx.ax.resolveHandles(handles);
        let evaluated = 0;

        const push = (
            data: MediaData,
            ruleId: string,
            description: string,
            severity: IssueSeverity,
            wcagCriteria: string[],
            helpUrl: string,
        ) => {
            issues.push({
                ruleId,
                description,
                severity,
                wcagCriteria,
                helpUrl,
                target: data.selector,
                html: data.outerHTML,
                source: 'multimedia',
            });
        };

        for (let i = 0; i < handles.length; i++) {
            const handle = handles[i]!;
            const data = await handle.evaluate(collectMediaData);
            evaluated++;

            // Autoplaying audio plays even when the element is visually hidden
            // (a bare <audio> without controls is display:none by UA default), so
            // this check is intentionally NOT gated on AT visibility.
            if (data.hasAutoplay && !data.isMuted && !data.hasControls) {
                push(
                    data,
                    'media-autoplay-no-control',
                    `<${data.tag}> autoplays with sound but has no controls and is not muted. Users must be ` +
                        `able to pause, stop, or mute it (or autoplay muted).`,
                    'serious',
                    ['1.4.2'],
                    'https://www.w3.org/WAI/WCAG21/Techniques/general/G170',
                );
            }

            // The remaining checks concern visually-presented media; skip
            // author-hidden elements.
            if (!axInfos[i]!.visibleToAT) continue;

            if (data.tag === 'video') {
                if (!data.hasCaptions) {
                    push(
                        data,
                        'video-missing-captions',
                        `<video> has no captions/subtitles track. Add <track kind="captions"> for ` +
                            `pre-recorded synchronised media.`,
                        'serious',
                        ['1.2.2'],
                        'https://www.w3.org/WAI/WCAG21/Techniques/html/H95',
                    );
                }
                if (!data.hasDescriptions) {
                    push(
                        data,
                        'video-missing-audio-description',
                        `<video> has no audio-description track. Provide <track kind="descriptions"> (or an ` +
                            `integrated audio-described version) for visual information not in the audio. Verify manually.`,
                        'moderate',
                        ['1.2.5'],
                        'https://www.w3.org/WAI/WCAG21/Techniques/html/H96',
                    );
                }

                // <video> with no native controls and not autoplaying → verify
                // keyboard-accessible custom controls exist. (Audio without
                // controls is UA-hidden and inert, so it is out of scope here.)
                if (!data.hasControls && !data.hasAutoplay) {
                    push(
                        data,
                        'media-no-controls',
                        `<video> has no native controls attribute. Ensure keyboard-accessible custom ` +
                            `controls are provided (play/pause, volume).`,
                        'moderate',
                        ['2.1.1'],
                        'https://www.w3.org/WAI/WCAG21/Techniques/general/G4',
                    );
                }
            }
        }

        ctx.log(`[multimedia] ${evaluated} media elements evaluated, ${issues.length} issues`);

        return {
            pluginId: 'multimedia',
            issues,
            metadata: { totalMedia: handles.length, evaluatedMedia: evaluated },
        };
    },
};
