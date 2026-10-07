import { IntegrationGuide } from '../guide/IntegrationGuide';
import { useUi } from '../store/ui';
import { Modal } from './Modal';

export function GuideModal() {
  const close = () => useUi.getState().setGuideOpen(false);
  return (
    <Modal
      id="guide"
      title={<strong>Connect your app</strong>}
      style={{ width: 'min(940px, 96vw)', height: 'min(720px, 92vh)' }}
      onClose={close}
    >
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 2 }}>
        <IntegrationGuide />
      </div>
    </Modal>
  );
}
