// Main manually derived these additional expectations from newly read KASI2020
// and HKO1988 calendar evidence, before the supplemental engine comparison.
// The original 22-case expectation file is unchanged. No engine/library imports.
export const FOUNDATION_SUPPLEMENT = [
  {
    originalId: 'ordinary-fourth-month',
    pillars: ['庚子', '庚辰', '丙申', '甲午'],
    tenGods: [['편재', '정관'], ['편재', '식신'], ['일간', '편재'], ['편인', '겁재']],
    gongmang: ['辰', '巳'], candidateCount: 1,
    basis: 'KASI2020 p18 Apr23 is after Apr4 16:38 Qingming and before May5 09:51 Lixia (p20). Geng year starts Wu-Yin; second increment gives Geng-Chen. For Bing DM, Geng is indirect wealth and Chen core Wu is eating god.',
  },
  {
    originalId: 'leap-fourth-month',
    pillars: ['庚子', '辛巳', '丙寅', '甲午'],
    tenGods: [['편재', '정관'], ['정재', '비견'], ['일간', '편인'], ['편인', '겁재']],
    gongmang: ['戌', '亥'], candidateCount: 1,
    basis: 'KASI2020 p20 May23 follows May5 09:51 Lixia and precedes Jun5 13:58 Mangzhong (p22). The third step from Wu-Yin is Xin-Si. For Bing DM, Xin is direct wealth and Si core Bing is peer.',
  },
  {
    originalId: 'korea-dst-fold',
    pillars: ['戊辰', '壬戌', '丁酉', '辛丑'],
    tenGods: [['상관', '상관'], ['정관', '상관'], ['일간', '편재'], ['편재', '식신']],
    gongmang: ['辰', '巳'], candidateCount: 2,
    basis: 'HKO1988 p1 Cold Dew occurs on Oct8 HKT (UTC+8), hence before Oct8 16:00Z. Both IANA fold instants Oct8 16:30Z/17:30Z are later; Winter Commences Nov7 is later. Wu year starts Jia-Yin; eight month steps gives Ren-Xu. Ding DM sees Ren as direct officer and Xu core Wu as hurting officer.',
  },
] as const;
