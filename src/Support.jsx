import { useNavigate } from 'react-router-dom';
import { apiFetch } from './api.js';
import { Avatar, Empty, Feedback, Loading, PageHead, useLoad } from './ui.jsx';
import Icon from './Icon.jsx';

export default function Support() {
  const navigate = useNavigate();
  const { data, loading, error } = useLoad(async () => (await apiFetch('/support/team')).team);

  return (
    <div className="pg pg-narrow">
      <PageHead title="Help and support" subtitle="Message our team about verification, payments, reports or anything that is not working." />

      <Feedback error={error} />
      {loading && !data && <Loading />}

      {data && data.length === 0 && (
        <Empty title="No one is available right now" text="Please try again later." />
      )}

      <div className="stack">
        {data?.map((member) => (
          <article className="card" key={member.id}>
            <div className="card-row">
              <div className="person">
                <Avatar name={member.full_name} />
                <div>
                  <strong>{member.full_name}</strong>
                  <small>{member.admin_level === 'full' ? 'Admin' : 'Support team'}</small>
                </div>
              </div>
              <button className="btn" onClick={() => navigate(`/messages/${member.id}`)}>
                <Icon name="chat" /> Start chat
              </button>
            </div>
          </article>
        ))}
      </div>

      <section className="panel" style={{ marginTop: 20 }}>
        <h2>Before you write</h2>
        <p className="sub">These answers solve most questions.</p>
        <ul className="faq">
          <li>
            <b>I cannot post or apply.</b> Verify your NID first (Profile menu, Identity verification).
          </li>
          <li>
            <b>My payment is not confirmed.</b> The provider confirms bKash, Nagad and cash payments. Chat with them from the booking or work page.
          </li>
          <li>
            <b>Someone is behaving badly.</b> Use the Report button on their work, listing or profile.
          </li>
        </ul>
      </section>
    </div>
  );
}
