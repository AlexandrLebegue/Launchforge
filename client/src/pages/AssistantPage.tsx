import { useState, useRef, useEffect, FormEvent, Fragment } from 'react';
import { streamAssistantChat, getOverview, PostChatMessage } from '../api/client';
import Markdown from '../components/Markdown';

const STORAGE_KEY = 'lf_assistant_chat';

const WELCOME: PostChatMessage = {
  role: 'assistant',
  text: 'Je suis ton **assistant LaunchForge** — le même que sur Telegram, avec tous les outils du projet.\n\nJe peux consulter l\'état de tes activités, rédiger et publier des posts, lire et envoyer des emails, gérer ton agenda Google Calendar, chercher sur le web et valider les contenus en attente. Que veut-on faire ?',
};

/** Suggestions affichées au démarrage et sous le fil — groupées par usage */
const SUGGESTIONS: { label: string; prompt: string }[] = [
  { label: 'Où en est-on ?',          prompt: 'Fais-moi un point complet sur le projet : posts à venir, validations, leads.' },
  { label: 'Rédiger un post',         prompt: 'Rédige un post LinkedIn sur notre actualité, en t\'appuyant sur une actu récente du secteur.' },
  { label: 'Lire mes mails',          prompt: 'Lis mes derniers emails et dis-moi s\'il y a quelque chose d\'important.' },
  { label: 'Mon agenda',              prompt: 'Qu\'est-ce que j\'ai dans mon agenda cette semaine ?' },
  { label: 'Contenus à valider',      prompt: 'Montre-moi les contenus en attente de validation.' },
  { label: 'Programmer un rappel',    prompt: 'Rappelle-moi demain à 9h de vérifier les métriques des posts.' },
];


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

export default function AssistantPage() {
  const [messages, setMessages] = useState<PostChatMessage[]>(loadHistory);
  const [input,    setInput]    = useState('');
  const [sending,  setSending]  = useState(false);
  const [streamText,    setStreamText]    = useState('');
  const [streamActions, setStreamActions] = useState<string[]>([]);
  const [error,    setError]    = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const chatEnd  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getOverview().then((res) => {
      if (res.success && res.data?.project) setProjectName(res.data.project.productName);
    });
  }, []);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
  }, [messages]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamText, streamActions.length]);

  const send = async (text: string) => {
    if (!text.trim() || sending) return;

    setError(null);
    setSending(true);
    setInput('');
    setStreamText('');
    setStreamActions([]);

    const nextHistory: PostChatMessage[] = [...messages, { role: 'user', text: text.trim() }];
    setMessages(nextHistory);

    await streamAssistantChat(
      nextHistory.filter((m) => m !== WELCOME).map(({ role, text: t }) => ({ role, text: t })),
      {
        onDelta:  (t) => setStreamText((prev) => prev + t),
        onAction: (a) => setStreamActions((prev) => [...prev, a]),
        onDone: (reply, actions) => {
          setSending(false);
          setStreamText('');
          setStreamActions([]);
          setMessages((prev) => [...prev, { role: 'assistant', text: reply, actions: actions.length ? actions : undefined }]);
          inputRef.current?.focus();
        },
        onError: (err) => {
          setSending(false);
          setStreamText('');
          setStreamActions([]);
          setError(err === 'AI_NOT_CONFIGURED' ? 'IA non configurée sur le serveur (OPENROUTER_API_KEY).' : err);
          setInput(text);
          setMessages((prev) => prev.slice(0, -1));
        },
      },
    );
  };

  const handleSend = (e?: FormEvent) => {
    e?.preventDefault();
    send(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const handleReset = () => {
    setMessages([WELCOME]);
    setError(null);
    sessionStorage.removeItem(STORAGE_KEY);
    inputRef.current?.focus();
  };

  const fresh = messages.length <= 1;

  return (
    <div className="assistant-page animate-fadeIn">
      {/* En-tête */}
      <div className="assistant-page-header">
        <div>
          <h1>Assistant</h1>
          <p>
            Pilote tout LaunchForge en discutant{projectName ? <> — projet : <strong>{projectName}</strong></> : ''}.
            Posts, emails, agenda, validations, recherche web.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={handleReset} title="Nouvelle conversation">
          ↺ Nouvelle conversation
        </button>
      </div>

      {/* Fil de conversation */}
      <div className="assistant-page-messages">
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

        {/* Suggestions (conversation vierge) */}
        {fresh && !sending && (
          <div className="assistant-suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s.label} className="assistant-suggestion" onClick={() => send(s.prompt)}>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        )}

        <div ref={chatEnd} />
      </div>

      {error && <div className="chat-error" style={{ margin: '0 0 8px' }}>{error}</div>}

      {/* Saisie */}
      <form className="assistant-page-input" onSubmit={handleSend}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Demande-moi n'importe quoi sur ton projet… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)"
          rows={2}
          disabled={sending}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={sending || !input.trim()}>
          {sending ? '⏳' : 'Envoyer →'}
        </button>
      </form>
    </div>
  );
}
