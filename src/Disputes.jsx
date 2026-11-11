import { useState } from 'react';
import { apiFetch, formatDateTime } from './api.js';
import { Empty, Feedback, Loading, Modal, PageHead, StatusBadge, useActions, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

/** "Report a problem" button for one work or booking. Props: { workId } or { bookingId }. */
export function DisputeButton({ workId, bookingId, onChange }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const actions = useActions(onChange);

  async function submit(event) {
    event.preventDefault();

    const body = { reason, [workId ? 'work_id' : 'booking_id']: workId || bookingId };
    const ok = await actions.run(() => apiFetch('/disputes', { method: 'POST', body }));
    if (ok) {
      setOpen(false);
      setReason('');
    }
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { actions.setError(''); setOpen(true); }}>
        <Icon name="alert" /> Report a problem
      </button>
      {actions.notice && !open && <small className="field-ok">{actions.notice}</small>}

      {open && (
        <Modal
          title="Report a problem"
          subtitle="An admin will review this. Any money held for this job stays on hold until they decide."
          onClose={() => setOpen(false)}
        >
          <Feedback error={actions.error} />
          <form className="form" onSubmit={submit}>
            <label className="field">
              <span>What went wrong?</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={10}
                maxLength={1000}
                required
                placeholder="Explain what happened. Include dates and anything the admin should know."
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn-danger" disabled={actions.busy}>{actions.busy ? 'Sending...' : 'Open dispute'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

const STATUS_TEXT = {
  open: 'Waiting for an admin',
  released: 'Decided: paid to the provider',
  refunded: 'Decided: refunded to the seeker',
  dismissed: 'Closed',
};

export default function Disputes() {
  const { data, loading, error } = useLoad(async () => (await apiFetch('/disputes/mine')).disputes);

  return (
    <div className="pg pg-narrow">
      <PageHead title="My disputes" subtitle="Problems you reported, or that were reported about your jobs." />

      <Feedback error={error} />
      {loading && !data && <Loading />}
      {data && data.length === 0 && (
        <Empty title="No disputes" text="If a job goes wrong, use “Report a problem” on its payment screen." />
      )}

      <div className="stack">
        {data?.map((dispute) => (
          <article className="card" key={dispute.id}>
            <div className="card-row">
              <h3>{dispute.title}</h3>
              <StatusBadge status={dispute.status === 'open' ? 'pending' : 'completed'} />
            </div>
            <p>{dispute.reason}</p>
            <div className="meta">
              <span>From <b>{dispute.opener_name}</b> about <b>{dispute.against_name}</b></span>
              <span>{formatDateTime(dispute.created_at)}</span>
            </div>
            <p className="quote"><b>{STATUS_TEXT[dispute.status]}</b>{dispute.resolution_note ? `: ${dispute.resolution_note}` : ''}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
