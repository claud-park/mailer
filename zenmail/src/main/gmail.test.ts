import { describe, expect, it } from 'vitest';
import { MockGmailProvider } from './gmail';

describe('MockGmailProvider label CRUD', () => {
  // label-crud R1: 생성은 labels 목록에 즉시 반영되고 unreadCount 0/visible true로 시작한다.
  it('createLabel adds a new user label with unreadCount 0 and visible true', async () => {
    const provider = new MockGmailProvider('demo@zenmail.app');
    const created = await provider.createLabel('Rocket');
    expect(created).toMatchObject({ name: 'Rocket', type: 'user', unreadCount: 0, visible: true });
    const labels = await provider.listLabels();
    expect(labels.find((l) => l.id === created.id)).toMatchObject({ name: 'Rocket' });
  });

  // label-crud D4: 삭제는 labels 목록에서 제거함과 동시에, 그 라벨이 붙어있던 모든 스레드의
  // summary.labelIds/detail.labelIds에서도 제거되어야 한다(실계정의 서버측 동작을 흉내).
  it('deleteLabel removes the label and strips it from every thread summary/detail', async () => {
    const provider = new MockGmailProvider('demo@zenmail.app');
    const before = await provider.listThreads({ labelIds: ['Label_work'] });
    expect(before.threads.length).toBeGreaterThan(0);
    const targetId = before.threads[0].id;

    await provider.deleteLabel('Label_work');

    const labels = await provider.listLabels();
    expect(labels.find((l) => l.id === 'Label_work')).toBeUndefined();

    const after = await provider.listThreads({ labelIds: ['Label_work'] });
    expect(after.threads).toEqual([]);

    const detail = await provider.getThread(targetId);
    expect(detail.labelIds).not.toContain('Label_work');
  });
});
