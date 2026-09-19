import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { service } from '../lib/service';
import { characterFor } from '../components/characters';
import { Modal, Notice } from '../components/ui';
import { useSession } from './session';

type Props = {
  kind: 'CONSULTATION' | 'CONVERSATION'; recordId: string; recordTitle: string;
  busy: boolean; error: string | null; onClose: () => void; onConfirm: (memoryIds: string[]) => void;
};
export function RecordDeletionDialog({ kind, recordId, recordTitle, busy, error, onClose, onConfirm }: Props) {
  const { session } = useSession();
  const memories = useQuery({ queryKey: ['deletion-memories', session?.user.id, kind, recordId], queryFn: () => service.getDeletionMemories(kind, recordId), enabled: !!session });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const ready = memories.isSuccess && !memories.error && !memories.isFetching;
  const candidates = new Set((memories.data || []).map((memory) => memory.id));
  const selected = ready ? selectedIds.filter((id) => candidates.has(id)) : [];
  function toggle(id: string, checked: boolean) {
    setSelectedIds((previous) => {
      const current = previous.filter((value) => candidates.has(value));
      if (!checked) return current.filter((value) => value !== id);
      return current.length < 1000 && !current.includes(id) ? [...current, id] : current;
    });
  }
  return <Modal title={kind === 'CONSULTATION' ? '이 상담을 지울까요?' : '이 대화를 지울까요?'} onClose={() => { if (!busy) onClose(); }}>
    <p>{kind === 'CONSULTATION' ? '이 상담의 대화와 점술 결과가 삭제돼요. 같은 전체 대화 안의 다른 상담은 남아 있어요.' : '이 전체 대화 안의 상담과 점술 결과가 모두 삭제돼요.'}</p>
    <p className="deletion-record-title">{recordTitle}</p>
    <section className="deletion-memory-section" aria-label="함께 삭제할 기억 선택">
      <h3>함께 지울 기억이 있나요?</h3>
      <p>{kind === 'CONSULTATION' ? '같은 대화에서 저장한 기억이에요. 다른 상담에서 나온 기억도 포함될 수 있으니 함께 지울 항목만 골라주세요.' : '이 대화에서 저장한 기억 중 함께 지울 항목만 골라주세요.'}</p>
      {memories.isFetching && <p className="muted" role="status">기억을 확인하고 있어요. 기록만 삭제하면 기억은 남아요.</p>}
      {memories.error ? <Notice tone="error">기억 목록을 불러오지 못했어요. 다시 확인하거나 기록만 삭제할 수 있어요.<div><button className="button ghost compact" disabled={busy || memories.isFetching} onClick={() => memories.refetch()}>기억 다시 불러오기</button></div></Notice> : memories.isSuccess && !memories.data.length ? <p className="muted">이 대화에 연결된 기억이 없어요.</p> : memories.data && <fieldset className="deletion-memory-list" disabled={busy || !ready}>
        <legend className="sr-only">함께 삭제할 기억</legend>
        {memories.data.map((memory) => <label key={memory.id} className="deletion-memory-choice"><input type="checkbox" checked={selectedIds.includes(memory.id)} disabled={!selectedIds.includes(memory.id) && selected.length >= 1000} onChange={(event) => toggle(memory.id, event.target.checked)}/><span><strong>{memory.content}</strong><small>{memory.scope === 'GLOBAL' ? '함께 기억하는 이야기' : `${characterFor(memory.character_id).withName} 나눈 기억`}{memory.disabled_at ? ' · 사용 중지됨' : ''}</small></span></label>)}
      </fieldset>}
      {selected.length >= 1000 && <Notice>한 번에 기억 1,000개까지 선택할 수 있어요. 나머지는 기억 관리에서 정리할 수 있어요.</Notice>}
      <p className="deletion-memory-note">선택하지 않은 기억은 남아요. 함께 삭제한 기억은 다른 대화에서도 사용할 수 없어요.</p>
      <Link className="text-link" to="/history?tab=memory" onClick={(event) => { if (busy) event.preventDefault(); else onClose(); }}>기억 관리에서 살펴보기</Link>
    </section>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="form-actions deletion-actions"><button className="button secondary" disabled={busy} onClick={onClose}>취소</button><button className="button danger" disabled={busy} onClick={() => onConfirm(selected)}>{busy ? '삭제 중…' : selected.length ? `기록과 기억 ${selected.length}개 삭제` : '기록만 삭제'}</button></div>
  </Modal>;
}
