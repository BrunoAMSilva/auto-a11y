import { describe, expect, it } from 'vitest';
import {
  bestSelector,
  hasNavigationEvent,
  isOverlayInteraction,
  parseRecording,
  stepLabel,
  toPwSelector,
  type RecordingStep,
} from '../../src/recording/parser.js';

describe('parseRecording', () => {
  it('parses a valid recording', () => {
    const rec = parseRecording(
      JSON.stringify({ title: 'My flow', steps: [{ type: 'navigate', url: 'https://x.test' }] }),
    );
    expect(rec.title).toBe('My flow');
    expect(rec.steps).toHaveLength(1);
  });

  it('defaults the title when missing', () => {
    const rec = parseRecording(JSON.stringify({ steps: [{ type: 'setViewport', width: 1, height: 1 }] }));
    expect(rec.title).toBe('Untitled Recording');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseRecording('{not json')).toThrow(/not valid JSON/);
  });

  it('throws on a missing steps array', () => {
    expect(() => parseRecording(JSON.stringify({ title: 'x' }))).toThrow(/non-empty "steps"/);
  });

  it('throws on an empty steps array', () => {
    expect(() => parseRecording(JSON.stringify({ steps: [] }))).toThrow(/non-empty "steps"/);
  });
});

describe('toPwSelector', () => {
  it('maps xpath selectors, preserving leading slashes', () => {
    expect(toPwSelector('xpath//html/body/a')).toBe('xpath=/html/body/a');
    expect(toPwSelector('xpath///*[@id="x"]')).toBe('xpath=//*[@id="x"]');
  });

  it('strips the pierce prefix to plain CSS', () => {
    expect(toPwSelector('pierce/#host .inner')).toBe('#host .inner');
  });

  it('maps text selectors to a substring match', () => {
    expect(toPwSelector('text/View All Career')).toBe('text=View All Career');
  });

  it('leaves plain CSS untouched', () => {
    expect(toPwSelector('a[href="/x"]')).toBe('a[href="/x"]');
  });

  it('falls back to an aria-label attribute for aria selectors', () => {
    expect(toPwSelector('aria/Submit')).toBe('[aria-label="Submit"]');
  });
});

describe('bestSelector', () => {
  it('prefers aria for readability', () => {
    expect(bestSelector([['#id'], ['aria/Save']])).toBe('aria/Save');
  });

  it('prefers data-test over a bare id', () => {
    expect(bestSelector([["[data-test='x']"], ['#id']])).toBe("[data-test='x']");
  });

  it('skips xpath and pierce when a CSS alternative exists', () => {
    expect(bestSelector([['xpath//a'], ['nav > a'], ['pierce/nav > a']])).toBe('nav > a');
  });

  it('returns a placeholder when there are no selectors', () => {
    expect(bestSelector(undefined)).toBe('(unknown)');
  });
});

describe('stepLabel', () => {
  it('masks values that could be secrets', () => {
    const step: RecordingStep = { type: 'change', value: 'hunter2pass', selectors: [['#pw']] };
    expect(stepLabel(step)).toBe('Set value "hu***" on #pw');
  });

  it('labels navigation', () => {
    expect(stepLabel({ type: 'navigate', url: 'https://x.test' })).toBe('Navigate to https://x.test');
  });
});

describe('navigation / overlay detection', () => {
  it('detects a navigation event', () => {
    const step: RecordingStep = { type: 'click', assertedEvents: [{ type: 'navigation' }] };
    expect(hasNavigationEvent(step)).toBe(true);
    expect(isOverlayInteraction(step)).toBe(false);
  });

  it('treats a non-navigating asserted interaction as an overlay', () => {
    const step: RecordingStep = { type: 'click', assertedEvents: [{ type: 'something' }] };
    expect(isOverlayInteraction(step)).toBe(true);
  });

  it('a plain click with no asserted events is neither', () => {
    const step: RecordingStep = { type: 'click', selectors: [['#x']] };
    expect(hasNavigationEvent(step)).toBe(false);
    expect(isOverlayInteraction(step)).toBe(false);
  });
});
