import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateSajuFoundation } from '../../supabase/functions/_shared/domain/saju.ts';
import { FOUNDATION_INDEPENDENT_FIXTURES } from './foundation-independent-expectations.ts';

// Comparison adapter only: no calendar, ten-god, void, or luck calculation is used
// to construct the expected side. The expectations were hashed before this file existed.
const stems: Record<string, string> = { 갑: '甲', 을: '乙', 병: '丙', 정: '丁', 무: '戊', 기: '己', 경: '庚', 신: '辛', 임: '壬', 계: '癸' };
const branches: Record<string, string> = { 자: '子', 축: '丑', 인: '寅', 묘: '卯', 진: '辰', 사: '巳', 오: '午', 미: '未', 신: '申', 유: '酉', 술: '戌', 해: '亥' };
const name = (pillar: { heavenlyStem: string; earthlyBranch: string } | null | undefined) => pillar ? stems[pillar.heavenlyStem]! + branches[pillar.earthlyBranch]! : null;
const positions = ['year', 'month', 'day', 'hour'] as const;

describe('frozen independent foundation evidence', () => {
  it('retains the expectation source frozen before comparison across checkout line endings', () => {
    // Git may transport LF as CRLF. Normalize that transport detail only; every
    // other character, including all literal expected values, remains hashed.
    const source = readFileSync(new URL('./foundation-independent-expectations.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(createHash('sha256').update(source).digest('hex')).toBe('498d2d4c82c290cd8e58d406d453ea1816c207c7a785f236bfe01efcd1cfaa1c');
    expect(new Set(FOUNDATION_INDEPENDENT_FIXTURES.map(item => item.acceptanceClass)).size).toBe(12);
  });
  it.each(FOUNDATION_INDEPENDENT_FIXTURES)('$id: $coverage', fixture => {
    if (fixture.error) {
      let actual: unknown;
      try { calculateSajuFoundation(fixture.input); } catch (error) { actual = error; }
      expect(actual).toMatchObject(fixture.error);
      return;
    }
    const actual = calculateSajuFoundation(fixture.input);
    const expected = fixture.expected!;
    expect(actual).toMatchObject({ status: 'FOUNDATION_ONLY', precision: 'MINUTE', engineVersion: 'manseryeok-2.0.0', conventionVersion: 'JumZipSajuConvention-v1', candidateCount: expected.candidateCount, hourStatus: expected.hourStatus });
    for (const position of positions) {
      if (Object.hasOwn(expected.pillars, position)) expect(name(actual.pillars[position]), `${position} pillar`).toBe(expected.pillars[position]);
      if (Object.hasOwn(expected.tenGods, position)) {
        const pair = actual.tenGods[position];
        expect(pair ? [pair.stem, pair.branch] : null, `${position} ten gods`).toEqual(expected.tenGods[position]);
      }
    }
    expect(actual.gongmang?.map(value => branches[value]).sort()).toEqual([...expected.gongmang].sort());
    for (const flag of expected.flags ?? []) expect(actual.uncertaintyFlags).toContain(flag);
    if (expected.charts) {
      const joint = actual.possible_values.charts.map(chart => positions.map(position => name(chart[position])));
      expect(joint.map(row => JSON.stringify(row)).sort()).toEqual(expected.charts.map(row => JSON.stringify(row)).sort());
      expect(actual.possible_values).not.toHaveProperty('hour');
      expect(actual.possible_values.charts.every(chart => !Object.hasOwn(chart, 'hour'))).toBe(true);
    }
    if (expected.direction) {
      expect(actual.daewoon?.forward).toBe(expected.direction.forward);
      expect(actual.daewoon?.pillars.slice(0, 3).map(row => name(row.pillar))).toEqual(expected.direction.firstThree);
    }
  });
});
