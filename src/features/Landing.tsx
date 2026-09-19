import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { characters, characterImage } from '../components/characters';
import { Eyebrow, Footer, Header, Icon } from '../components/ui';

export default function Landing() {
  const [selected, setSelected] = useState(1);
  const character = characters[selected];
  const reduced = useReducedMotion();
  return <div className={`landing theme-${character.slug}`}><Header /><main>
    <section className="hero" aria-label="오늘의 상담 파트너 선택">
      <div className="hero-grid" aria-hidden="true" /><div className="hero-circle" aria-hidden="true" /><div className="hero-orbit" aria-hidden="true" />
      <div className="hero-topline"><span>FORTUNE, WITH A PERSONALITY.</span><span>당신의 이야기가 시작되는 곳</span></div>
      <div className="hero-copy"><Eyebrow number="01">A CONVERSATION FOR YOU</Eyebrow><h1>오늘은 누구랑<br />이야기해볼까요<span>?</span></h1><p>답이 필요한 날에도,<br />그냥 누군가와 이야기하고 싶은 날에도.</p><div className="hero-tiny-rule"><span /> 마음이 향하는 사람을 골라보세요</div></div>
      <div className="hero-editorial" aria-hidden="true">{character.english}</div>
      <motion.div className="hero-characters" drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.15} onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 45) setSelected((selected + (info.offset.x < 0 ? 1 : 2)) % 3); }}>
        {characters.map((c, i) => { const position = i === selected ? 0 : i === (selected + 1) % 3 ? 1 : -1; return <motion.button key={c.id} type="button" className={`hero-character ${i === selected ? 'selected' : ''} position-${position}`} onClick={() => setSelected(i)} aria-label={`${c.name} 선택`} aria-pressed={i === selected} animate={{ x: position * 205, scale: position === 0 ? 1 : 0.83, opacity: position === 0 ? 1 : 0.32 }} transition={{ duration: reduced ? 0 : 0.5, ease: [0.2, 0.7, 0.2, 1] }} style={{ zIndex: position === 0 ? 40 : 30 }}><img src={characterImage(c)} alt={`${c.name} 정본 캐릭터 일러스트`} draggable={false} /></motion.button>; })}
      </motion.div>
      <div className="hero-character-note"><span className="character-number">{character.number} <i>/ 03</i></span><h2>{character.name}<span>{character.english}</span></h2><p>{character.subtitle}</p><div className="character-note-tags">{character.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div>
      <div className="hero-quote" key={character.id}><span aria-hidden="true">“</span><p>{character.quote}</p></div>
      <div className="hero-bottom"><span className="hero-scroll">SCROLL TO DISCOVER <span>↓</span></span><span className="hero-bottom-script">A different way to find your answer.</span></div>
    </section>
    <section className="selection-bar" aria-label="상담 시작"><div className="character-tabs" role="group" aria-label="캐릭터"><span className="selection-label">YOUR PERSON</span>{characters.map((c, i) => <button key={c.id} className={`character-tab ${selected === i ? 'active' : ''}`} onClick={() => setSelected(i)} aria-pressed={selected === i}><span>{c.name}</span><small>{c.english}</small>{selected === i && <span className="active-dot" />}</button>)}</div><Link to={`/chat/${character.slug}`} className="button primary hero-cta"><span>{character.withName} 이야기하기</span><Icon name="arrow" /></Link><span className="selection-caption"><Icon name="lock" size={13} /> 가입 없이, 편하게 시작해요</span></section>
    <section className="intro-section"><div><Eyebrow number="02">MORE THAN AN ANSWER</Eyebrow><h2>정해진 미래보다,<br /><em>지금의 당신</em>을 위한 이야기.</h2></div><div className="intro-details"><p>한 장의 카드, 타고난 흐름, 그리고 나를 기억하는 대화.<br />같은 고민도 누구와 나누느냐에 따라 다르게 보이니까.</p><div className="experience-links"><Link to={`/chat/${character.slug}?tool=tarot`}><Icon name="cards" /><span>마음을 비추는 타로<small>TAROT READING</small></span><Icon name="arrow" /></Link><Link to={`/chat/${character.slug}?tool=saju`}><Icon name="moon" /><span>나를 알아가는 사주<small>SAJU & COMPATIBILITY</small></span><Icon name="arrow" /></Link></div></div></section>
  </main><Footer /></div>;
}
