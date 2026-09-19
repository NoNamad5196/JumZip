import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateSajuFoundation } from '../../supabase/functions/_shared/domain/saju.ts';
import { FOUNDATION_INDEPENDENT_FIXTURES } from './foundation-independent-expectations.ts';
import { FOUNDATION_SUPPLEMENT } from './foundation-supplement-expectations.ts';

const stems: Record<string, string> = { 갑: '甲', 을: '乙', 병: '丙', 정: '丁', 무: '戊', 기: '己', 경: '庚', 신: '辛', 임: '壬', 계: '癸' };
const branches: Record<string, string> = { 자: '子', 축: '丑', 인: '寅', 묘: '卯', 진: '辰', 사: '巳', 오: '午', 미: '未', 신: '申', 유: '酉', 술: '戌', 해: '亥' };
const positions = ['year', 'month', 'day', 'hour'] as const;
describe('independent added Jie evidence closes selected month-field omissions', () => {
  it('retains the manually frozen expectation content across Git line-ending transport', () => {
    const source = readFileSync(new URL('./foundation-supplement-expectations.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(createHash('sha256').update(source).digest('hex')).toBe('f50a970cd773232ce95dfdfc40d460f71bcc816993f9993b04bd9997a1cab4fb');
  });
  it.each(FOUNDATION_SUPPLEMENT)('$originalId complete adopted fields', (expected) => {
    const original = FOUNDATION_INDEPENDENT_FIXTURES.find((fixture) => fixture.id === expected.originalId)!;
    expect(original.coverage).toBe('PARTIAL_ADOPTED_FIELDS');
    const actual = calculateSajuFoundation(original.input);
    expect(actual.candidateCount).toBe(expected.candidateCount);
    expect(positions.map((position) => {
      const pillar = actual.pillars[position];
      return pillar ? stems[pillar.heavenlyStem]! + branches[pillar.earthlyBranch]! : null;
    })).toEqual(expected.pillars);
    expect(positions.map((position) => {
      const pair = actual.tenGods[position]; return pair ? [pair.stem, pair.branch] : null;
    })).toEqual(expected.tenGods);
    expect(actual.gongmang?.map((branch) => branches[branch]).sort()).toEqual([...expected.gongmang].sort());
  });
});
