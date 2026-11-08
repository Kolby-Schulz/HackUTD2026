// Renders the toast queue from core/toast (call `toast('text')` from anywhere).
import { toasts } from '../../core/toast';
import { useStoreValue } from '../../core/react';
import '../../styles/toasts.css';

export function Toasts() {
  const list = useStoreValue(toasts.subscribe, toasts.getToasts);
  if (!list.length) return null;
  return (
    <div className="pg-toasts" role="status">
      {list.map((t) => <div key={t.id} className={`pg-toast ${t.variant}`}>{t.text}</div>)}
    </div>
  );
}
