import { Component, Suspense, lazy, useEffect, type ReactNode } from 'react';
import { Route, Routes, useLocation, Link } from 'react-router-dom';
import { Header, Footer, EmptyState } from './components/ui';
import Landing from './features/Landing';
import { SessionProvider } from './features/session';
import './styles/app.css';

const Chat=lazy(()=>import('./features/Chat'));
const Reading=lazy(()=>import('./features/Reading'));
const Onboarding=lazy(()=>import('./features/AccountPages').then((page)=>({default:page.Onboarding})));
const AuthPage=lazy(()=>import('./features/AccountPages').then((page)=>({default:page.AuthPage})));
const HistoryPage=lazy(()=>import('./features/AccountPages').then((page)=>({default:page.HistoryPage})));
const ProfilePage=lazy(()=>import('./features/AccountPages').then((page)=>({default:page.ProfilePage})));
const SettingsPage=lazy(()=>import('./features/AccountPages').then((page)=>({default:page.SettingsPage})));
const PrivacyPage=lazy(()=>import('./features/AccountPages').then((page)=>({default:page.PrivacyPage})));
class PageBoundary extends Component<{children:ReactNode},{failed:boolean}> { state={failed:false};static getDerivedStateFromError(){return{failed:true};}render(){return this.state.failed?<main className="content-page"><EmptyState title="화면을 다시 불러올게요.">잠시 연결이 끊겼거나 화면을 불러오지 못했어요. 저장한 이야기는 그대로 남아 있어요.<div><button className="button primary" onClick={()=>window.location.reload()}>다시 불러오기</button></div></EmptyState></main>:this.props.children;} }

function ApplicationRoutes() { const location=useLocation();const isChat=location.pathname.startsWith('/chat/');const isLanding=location.pathname==='/';useEffect(()=>{if(!isChat)window.scrollTo(0,0);document.title='JumZip — 오늘은 누구랑 이야기해볼까요?';},[location.pathname,isChat]);return <div className="app-shell">{!isChat&&!isLanding&&<Header/>}<PageBoundary key={location.pathname}><Suspense fallback={<main className="content-page" role="status"><p className="muted">이야기의 자리를 준비하고 있어요…</p></main>}><Routes><Route path="/" element={<Landing/>}/><Route path="/onboarding" element={<Onboarding/>}/><Route path="/auth" element={<AuthPage/>}/><Route path="/chat/:characterId" element={<Chat/>}/><Route path="/reading/:consultationId" element={<Reading/>}/><Route path="/history" element={<HistoryPage/>}/><Route path="/profile" element={<ProfilePage/>}/><Route path="/settings" element={<SettingsPage/>}/><Route path="/privacy" element={<PrivacyPage/>}/><Route path="*" element={<main className="content-page"><EmptyState title="잠깐, 다른 길로 왔네요."><Link className="button primary" to="/">처음으로 돌아가기</Link></EmptyState></main>}/></Routes></Suspense></PageBoundary>{!isChat&&!isLanding&&<Footer/>}</div>; }
export default function App(){return <SessionProvider><ApplicationRoutes/></SessionProvider>;}
