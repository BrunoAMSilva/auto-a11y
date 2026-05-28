import { describe, it, expect } from 'vitest';
import { StandardsService } from '../../src/services/StandardsService.js';

describe('StandardsService.tagToId', () => {
  it('parses dotted wcag tags', () => {
    expect(StandardsService.tagToId('wcag4.1.2')).toBe('4.1.2');
    expect(StandardsService.tagToId('wcag1.1.1')).toBe('1.1.1');
  });

  it('parses axe-style compact tags', () => {
    expect(StandardsService.tagToId('wcag412')).toBe('4.1.2');
    expect(StandardsService.tagToId('wcag111')).toBe('1.1.1');
    expect(StandardsService.tagToId('wcag1411')).toBe('1.4.11');
  });

  it('ignores non-criterion tags', () => {
    expect(StandardsService.tagToId('wcag2aa')).toBeNull();
    expect(StandardsService.tagToId('best-practice')).toBeNull();
  });
});

describe('StandardsService.criteriaFromTags', () => {
  it('resolves tags to WCAG criteria', () => {
    const svc = StandardsService.load();
    const criteria = svc.criteriaFromTags(['wcag4.1.2', 'wcag111']);
    expect(criteria).toHaveLength(2);
    expect(criteria[0]!.id).toBe('4.1.2');
    expect(criteria[0]!.title).toBe('Name, Role, Value');
    expect(criteria[1]!.id).toBe('1.1.1');
    expect(criteria[1]!.title).toBe('Non-text Content');
  });

  it('dedupes', () => {
    const svc = StandardsService.load();
    const criteria = svc.criteriaFromTags(['wcag412', 'wcag4.1.2']);
    expect(criteria).toHaveLength(1);
  });
});
