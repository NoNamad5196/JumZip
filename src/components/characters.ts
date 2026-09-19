export type CharacterId = 'BOMI' | 'SANI' | 'ARANG';
export const characters = [
  { id: 'SANI' as CharacterId, slug: 'sani', name: '산이', withName: '산이와', english: 'SANI', number: '02', subtitle: '가장 편한, 너의 편', description: '복잡한 마음도 조금은 가벼워지도록.\n친구처럼 편하게, 같이 들여다보자.', quote: '아, 그건 좀 신경 쓰이겠다.', greeting: '왔어? 오늘은 무슨 생각하고 있었어. 편하게 얘기해.', tags: ['관계의 흐름', '진로와 선택'], accent: '#C7A47C', loading: '잠깐, 같이 생각해 보고 있어.', error: '연결이 잠깐 끊겼어. 네 이야기는 여기 그대로 있어.' },
  { id: 'BOMI' as CharacterId, slug: 'bomi', name: '보미', withName: '보미와', english: 'BOMI', number: '01', subtitle: '오늘을 조금 더 반짝이게', description: '작은 고민부터 말 못 한 설렘까지.\n우리, 한 장씩 펼쳐볼까?', quote: '오늘은 그냥 가볍게 한 장만 뽑아볼래?', greeting: '왔구나! 오늘은 무슨 일 있었어? 좋은 얘기도, 신경 쓰이는 얘기도 다 좋아.', tags: ['오늘의 운세', '설레는 마음'], accent: '#FF7A21', loading: '잠깐만! 네 이야기 생각하고 있어.', error: '앗, 잠깐 연결이 안 됐어. 하려던 이야기는 그대로 남겨뒀어!' },
  { id: 'ARANG' as CharacterId, slug: 'arang', name: '아랑', withName: '아랑과', english: 'ARANG', number: '03', subtitle: '마음 너머의 답을 찾아서', description: '쉽게 꺼내지 못한 이야기일수록.\n서두르지 말고, 하나씩 봐요.', quote: '그럼 하나씩 봐요. 먼저 상대 마음부터.', greeting: '어서 와요. 그래서, 오늘은 무슨 얘기 하려고 왔어요?', tags: ['깊이 있는 상담', '사주와 궁합'], accent: '#D5AF62', loading: '조금만 기다려요. 찬찬히 살펴보고 있어요.', error: '잠시 연결이 어려운가 봐요. 이야기는 남아 있으니 다시 이어가면 돼요.' },
] as const;
export type Character = typeof characters[number];
export const characterFor = (value?: string | null): Character => characters.find((c) => c.slug === value?.toLowerCase() || c.id === value?.toUpperCase()) ?? characters[1];
export const characterImage = (c: Character) => `/assets/characters/${c.slug}/master.png`;
