import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch, formatDateTime } from './api.js';
import { useAuth } from './auth.jsx';
import { CallButton } from './calls.jsx';
import LiveLocation from './LiveLocation.jsx';
import { useRealtime } from './realtime.jsx';
import { Avatar, Feedback, Loading, PageHead } from './ui.jsx';
import Icon from './Icon.jsx';

export default function Messages() {
  const { userId } = useParams();
  const { user } = useAuth();
  const { socket, connected } = useRealtime();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState(null);
  const [thread, setThread] = useState(null);
  const [threadError, setThreadError] = useState('');
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);

  const bodyRef = useRef(null);
  const typingTimer = useRef(null);
  const lastTypingSent = useRef(0);
  const peerId = Number(userId) || null;

  const loadConversations = useCallback(async () => {
    try {
      const data = await apiFetch('/chat/conversations');
      setConversations(data.conversations);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const loadThread = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await apiFetch(`/chat/${userId}`);
      setThread(data);
      setThreadError('');
    } catch (err) {
      setThread(null);
      setThreadError(err.message);
    }
  }, [userId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    setThread(null);
    setTyping(false);
    loadThread();
  }, [loadThread]);

  // Real-time: new messages and typing arrive over the socket.
  useEffect(() => {
    if (!socket) return undefined;

    const onMessage = (message) => {
      const involvesPeer = message.sender_id === peerId || message.receiver_id === peerId;

      if (involvesPeer) {
        setThread((current) => {
          if (!current || current.messages.some((m) => m.id === message.id)) return current;
          return { ...current, messages: [...current.messages, message] };
        });

        // A message from the open chat is read right away.
        if (message.sender_id === peerId) {
          apiFetch(`/chat/${peerId}`).catch(() => {});
          setTyping(false);
        }
      }

      loadConversations();
    };

    const onTyping = ({ from }) => {
      if (from !== peerId) return;
      setTyping(true);
      window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(() => setTyping(false), 3000);
    };

    socket.on('message:new', onMessage);
    socket.on('typing', onTyping);

    return () => {
      socket.off('message:new', onMessage);
      socket.off('typing', onTyping);
      window.clearTimeout(typingTimer.current);
    };
  }, [socket, peerId, loadConversations]);

  // Slow fallback poll in case the socket is down.
  useEffect(() => {
    if (connected) return undefined;

    const timer = window.setInterval(() => {
      if (document.hidden) return;
      loadConversations();
      loadThread();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [connected, loadConversations, loadThread]);

  const messageCount = thread?.messages.length;
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messageCount, typing]);

  function onType(event) {
    setText(event.target.value);

    const now = Date.now();
    if (socket && peerId && now - lastTypingSent.current > 1500) {
      lastTypingSent.current = now;
      socket.emit('typing', { to: peerId });
    }
  }

  async function send(event) {
    event.preventDefault();
    const body = text.trim();
    if (!body || sending) return;

    setSending(true);
    try {
      const data = await apiFetch(`/chat/${userId}`, { method: 'POST', body: { body } });
      setText('');
      setThreadError('');

      // The socket echo may already have added it; avoid duplicates.
      setThread((current) =>
        current && !current.messages.some((m) => m.id === data.message.id)
          ? { ...current, messages: [...current.messages, data.message] }
          : current
      );
      loadConversations();
    } catch (err) {
      setThreadError(err.message);
    } finally {
      setSending(false);
    }
  }

  const peerOnly =
    userId && thread && !conversations?.some((c) => String(c.user_id) === String(userId));

  return (
    <div className="pg">
      <PageHead
        title="Messages"
        subtitle={connected ? 'Live chat with seekers and providers you work with.' : 'Reconnecting to live chat...'}
      />
      <Feedback error={error} />

      <div className={`chat ${userId ? 'has-peer' : ''}`}>
        <aside className="chat-list">
          {!conversations && <Loading />}

          {conversations?.length === 0 && !peerOnly && (
            <div className="chat-empty">
              <p>No conversations yet. Start a chat from a work post, application or booking.</p>
              {user.role !== 'admin' && (
                <button className="btn btn-soft btn-sm" onClick={() => navigate('/support')}>
                  Contact support
                </button>
              )}
            </div>
          )}

          {peerOnly && (
            <button className="chat-item on">
              <Avatar name={thread.peer.full_name} imageId={thread.peer.avatar_image_id} />
              <div>
                <strong>{thread.peer.full_name}</strong>
                <small>New conversation</small>
              </div>
            </button>
          )}

          {conversations?.map((c) => (
            <button
              key={c.user_id}
              className={`chat-item ${String(c.user_id) === String(userId) ? 'on' : ''}`}
              onClick={() => navigate(`/messages/${c.user_id}`)}
            >
              <Avatar name={c.full_name} imageId={c.avatar_image_id} />
              <div>
                <strong>{c.full_name}</strong>
                <small>
                  {c.last_sender_id === user.id ? 'You: ' : ''}
                  {c.last_message}
                </small>
              </div>
              {c.unread > 0 && <i>{c.unread}</i>}
            </button>
          ))}
        </aside>

        <section className="chat-pane">
          {!userId && (
            <div className="chat-empty">
              <p>Select a conversation to start chatting.</p>
            </div>
          )}

          {userId && threadError && !thread && (
            <div className="chat-empty">
              <div>
                <p>{threadError}</p>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/messages')}>
                  Back to messages
                </button>
              </div>
            </div>
          )}

          {userId && !thread && !threadError && <Loading />}

          {thread && (
            <>
              <div className="chat-head">
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/messages')} aria-label="Back">
                  ←
                </button>
                <Avatar name={thread.peer.full_name} imageId={thread.peer.avatar_image_id} />
                <div>
                  <strong>{thread.peer.full_name}</strong>
                  <br />
                  <small style={{ color: typing ? 'var(--mh-green)' : 'var(--mh-muted)', textTransform: 'capitalize' }}>
                    {typing ? 'typing...' : thread.peer.role}
                  </small>
                </div>
                <div className="chat-head-actions">
                  <CallButton peer={thread.peer} label={<><Icon name="phone" /> Call</>} />
                  {thread.peer.phone && (
                    <a className="btn btn-ghost btn-sm" href={`tel:${thread.peer.phone}`}>
                      <Icon name="mobile" /> Phone
                    </a>
                  )}
                  {thread.peer.role === 'provider' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/providers/${thread.peer.id}`)}>
                      Profile
                    </button>
                  )}
                </div>
              </div>

              <LiveLocation peer={thread.peer} />

              <div className="chat-body" ref={bodyRef}>
                {thread.messages.length === 0 && (
                  <div className="chat-empty">
                    <p>Say hello to {thread.peer.full_name}.</p>
                  </div>
                )}

                {thread.messages.map((message) => (
                  <div key={message.id} className={`bubble ${message.sender_id === user.id ? 'mine' : ''}`}>
                    {message.body}
                    <small>{formatDateTime(message.created_at)}</small>
                  </div>
                ))}

                {typing && (
                  <div className="bubble typing" aria-label="typing">
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </div>

              {threadError && (
                <div className="alert" style={{ margin: '0 14px' }}>
                  {threadError}
                </div>
              )}

              <form className="chat-form" onSubmit={send}>
                <input
                  value={text}
                  onChange={onType}
                  placeholder="Type a message..."
                  maxLength={2000}
                  aria-label="Message"
                />
                <button className="btn" disabled={sending || !text.trim()}>
                  Send
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
