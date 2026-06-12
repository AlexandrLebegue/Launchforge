import { useState, useRef, useEffect, FormEvent, Fragment } from 'react';
import { streamPostChat, PostChatMessage } from '../api/client';
import Markdown from './Markdown';

const STORAGE_KEY = 'lf_post_chat';

const WELCOME: PostChatMessage = {
  role: 'assistant',
  text: 'Je suis ton assistant de création de posts. Dis-moi ce que tu veux publier — je peux chercher des actus et des chiffres sur le web, proposer des angles, rédiger, et enregistrer le post dans ton Hub quand il te plaît.\n\nExemples : « Un post LinkedIn sur notre nouvelle fonctionnalité », « Trouve une actu de mon secteur et fais un post dessus », « 3 idées de threads X ».',
};


function loadHistory(): PostChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* corrompu → repartir de zéro */ }
  return [WELCOME];
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Appelé quand l'assistant a enregistré un ou des posts dans le Hub */
  onPostsSaved: () => void;
}

export default function PostAssistant({ open, onClose, onPostsSaved }: Props) {
  const [messages, setMessages] = useState<PostChatMessage[]>(loadHistory);
  const [input,    setInput]    = useState('');
  const [sending,  setSending]  = useState(false);
  const [streamText,    setStreamText]    = useState('');
  const [streamActions, setStreamActions] = useState<string[]>([]);
  const [savedFlash,    setSavedFlash]    = useState<string | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
  }, [messages]);

  useEffect(() => {
    if (open) chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamText, streamActions.length, open]);

  const handleSend = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setError(null);
    setSending(true);
    setInput('');
    setStreamText('');
    setStreamActions([]);

    const nextHistory: PostChatMessage[] = [...messages, { role: 'user', text }];
    setMessages(nextHistory);

    let savedAny = false;

    await streamPostChat(
      nextHistory.filter((m) => m !== WELCOME).map(({ role, text: t }) => ({ role, text: t })),
      {
        onDelta:  (t) => setStreamText((prev) => prev + t),
        onAction: (a) => setStreamActions((prev) => [...prev, a]),
        onSaved:  (_postId, title) => {
          savedAny = true;
          setSavedFlash(title);
          setTimeout(() => setSavedFlash(null), 4000);
        },
        onDone: (reply, actions) => {
          setSending(false);
          setStreamText('');
          setStreamActions([]);
          setMessages((prev) => [...prev, { role: 'assistant', text: reply, actions: actions.length ? actions : undefined }]);
          if (savedAny) onPostsSaved();
        },
        onError: (err) => {
          setSending(false);
          setStreamText('');
          setStreamActions([]);
          setError(err === 'AI_NOT_CONFIGURED' ? 'IA non configurée sur le serveur (OPENROUTER_API_KEY).' : err);
          setInput(text);
          setMessages((prev) => prev.slice(0, -1));
          if (savedAny) onPostsSaved();
        },
      },
    );
  };

  const handleReset = () => {
    setMessages([WELCOME]);
    sessionStorage.removeItem(STORAGE_KEY);
  };

  if (!open) return null;

  return (
    <>
      <div className="assistant-overlay" onClick={onClose} />
      <aside className="assistant-drawer">
        <div className="assistant-header">
          <span className="assistant-title">Assistant de création</span>
          <span className="form-hint-inline">cherche sur le web · enregistre dans le Hub</span>
          <button className="btn btn-ghost btn-sm" onClick={handleReset} title="Nouvelle conversation">↺</button>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="assistant-messages">
          {messages.map((msg, i) => (
            <Fragment key={i}>
              {msg.actions && msg.actions.length > 0 && (
                <div className="chat-actions" style={{ padding: '2px 0 6px' }}>
                  {msg.actions.map((a, j) => <span key={j} className="chat-action-chip">{a}</span>)}
                </div>
              )}
              <div className={`chat-msg chat-msg-${msg.role === 'assistant' ? 'bot' : 'user'}`}>
                <div className="chat-avatar">{msg.role === 'assistant' ? '' : ''}</div>
                <div className={`chat-bubble ${msg.role === 'assistant' ? 'bot' : 'user'}`}>
                  <Markdown text={msg.text} />
                </div>
              </div>
            </Fragment>
          ))}

          {sending && streamActions.length > 0 && (
            <div className="chat-actions" style={{ padding: '2px 0 6px' }}>
              {streamActions.map((a, j) => <span key={j} className="chat-action-chip">{a}</span>)}
            </div>
          )}
          {sending && (
            <div className="chat-msg chat-msg-bot">
              <div className="chat-avatar"></div>
              {streamText
                ? <div className="chat-bubble bot"><Markdown text={streamText} /><span className="chat-cursor">▋</span></div>
                : <div className="chat-bubble-thinking"><span /><span /><span /></div>}
            </div>
          )}

          <div ref={chatEnd} />
        </div>

        {savedFlash && (
          <div className="approval-feedback" style={{ margin: '0 0 8px' }}>
            « {savedFlash} » enregistré dans le Hub
          </div>
        )}
        {error && <div className="chat-error" style={{ margin: '0 0 8px' }}>{error}</div>}

        <form className="chat-input-bar" onSubmit={handleSend} style={{ padding: 0 }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Décris le post que tu veux créer…"
            disabled={sending}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={sending || !input.trim()}>
            {sending ? '⏳' : 'Envoyer →'}
          </button>
        </form>
      </aside>
    </>
  );
}
