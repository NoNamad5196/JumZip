import { Link } from 'react-router-dom';
import { EmptyState, Icon, Notice } from '../components/ui';

export function ConnectionNotice() { return <Notice>지금은 서비스 연결을 준비하고 있어요. 캐릭터와 화면은 둘러볼 수 있고, 실제 대화와 점술은 연결이 완료되면 시작할 수 있어요.</Notice>; }
export function SessionRequired() { return <EmptyState icon="lock" title="우리의 이야기를 시작해볼까요?">이름 하나면 충분해요. 계정 연결은 이야기를 나눈 뒤에 해도 괜찮아요.<div><Link className="button primary" to="/onboarding">처음 이야기하기 <Icon name="arrow"/></Link></div><Link className="text-link" to="/auth">이미 연결한 계정이 있어요</Link></EmptyState>; }
