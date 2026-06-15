import { useState, useRef, useEffect, FormEvent, ChangeEvent, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Flame, User, Square, Send, Paperclip, X, FileText } from 'lucide-react';
import { streamAssistantChat, getOverview, PostChatMessage, AssistantAttachment } from '../api/client';
import Markdown from '../components/Markdown';

const STORAGE_KEY = 'lf_assistant_chat';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 Mo / fichier
const MAX_FILES = 4;
const ACCEPT = '.pdf,.docx,.xlsx,.xls,.txt,.md,.csv,image/*';

/** Lit un fichier en base64 (sans le préfixe data:) */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const WELCOME: PostChatMessage = {
  role: 'assistant',
  text: '👋 Je suis ton **assistant LaunchForge** — le même que sur Telegram, avec tous les outils du projet.\n\nJe peux consulter l\'état de tes activités, rédiger et publier des posts, lire et envoyer des emails, gérer ton agenda Google Calendar, chercher sur le web et valider les contenus en attente. Que veut-on faire ?',
};

/** Suggestions affichées au démarrage et sous le fil — groupées par usage */
const SUGGESTIONS: { icon: string; label: string; prompt: string }[] = [
  { icon: '📊', label: 'Où en est-on ?',          prompt: 'Fais-moi un point complet sur le projet : posts à venir, validations, leads.' },
  { icon: '✍️', label: 'Rédiger un post',         prompt: 'Rédige un post LinkedIn sur notre actualité, en t\'appuyant sur une actu récente du secteur.' },
  { icon: '📬', label: 'Lire mes mails',          prompt: 'Lis mes derniers emails et dis-moi s\'il y a quelque chose d\'important.' },
  { icon: '🗓️', label: 'Mon agenda',              prompt: 'Qu\'est-ce que j\'ai dans mon agenda cette semaine ?' },
  { icon: '✅', label: 'Contenus à valider',      prompt: 'Montre-moi les contenus en attente de validation.' },
  { icon: '⏰', label: 'Programmer un rappel',    prompt: 'Rappelle-moi demain à 9h de vérifier les métriques des posts.' },
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
  const [files,    setFiles]    = useState<AssistantAttachment[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const chatEnd  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef  = useRef<HTMLInputElement>(null);
  // Interruption : contrôleur du flux en cours + dernier texte/actions reçus
  const abortRef = useRef<AbortController | null>(null);
  const streamTextRef = useRef('');
  const actionsRef = useRef<string[]>([]);

  useEffect(() => {
    getOverview().then((res) => {
      if (res.success && res.data?.project) setProjectName(res.data.project.productName);
    });
  }, []);

  // Prompt pré-rempli depuis une autre page (ex. « Discuter avec l'IA » des analyses)
  useEffect(() => {
    const prefill = searchParams.get('prompt');
    if (prefill) {
      setInput(prefill);
      searchParams.delete('prompt');
      setSearchParams(searchParams, { replace: true });
      // Focus + curseur en fin de texte au prochain rendu
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
  }, [messages]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamText, streamActions.length]);

  const send = async (text: string, attachments: AssistantAttachment[] = []) => {
    if ((!text.trim() && attachments.length === 0) || sending) return;

    setError(null);
    setSending(true);
    setInput('');
    setFiles([]);
    setStreamText('');
    setStreamActions([]);
    streamTextRef.current = '';
    actionsRef.current = [];

    const controller = new AbortController();
    abortRef.current = controller;

    // Le message affiché signale les fichiers joints ; le contenu réel des
    // fichiers part séparément (attachments) et n'est analysé que ce tour-ci.
    const tag = attachments.length
      ? `${text.trim()}${text.trim() ? '\n\n' : ''}📎 _${attachments.map((a) => a.name).join(', ')}_`
      : text.trim();
    const nextHistory: PostChatMessage[] = [...messages, { role: 'user', text: tag }];
    setMessages(nextHistory);

    await streamAssistantChat(
      nextHistory.filter((m) => m !== WELCOME).map(({ role, text: t }) => ({ role, text: t })),
      {
        onDelta:  (t) => { streamTextRef.current += t; setStreamText((prev) => prev + t); },
        onAction: (a) => { actionsRef.current = [...actionsRef.current, a]; setStreamActions((prev) => [...prev, a]); },
        onDone: (reply, actions) => {
          abortRef.current = null;
          setSending(false);
          setStreamText('');
          setStreamActions([]);
          setMessages((prev) => [...prev, { role: 'assistant', text: reply, actions: actions.length ? actions : undefined }]);
          inputRef.current?.focus();
        },
        onError: (err) => {
          abortRef.current = null;
          setSending(false);
          setStreamText('');
          setStreamActions([]);
          setError(err === 'AI_NOT_CONFIGURED' ? 'IA non configurée sur le serveur (OPENROUTER_API_KEY).' : err);
          setInput(text);
          setFiles(attachments);
          setMessages((prev) => prev.slice(0, -1));
        },
        // Interruption volontaire : on conserve ce qui a déjà été généré
        onAbort: () => {
          abortRef.current = null;
          setSending(false);
          const partial = streamTextRef.current.trim();
          const acts = actionsRef.current;
          setStreamText('');
          setStreamActions([]);
          if (partial) {
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', text: `${partial}\n\n_(réponse interrompue)_`, actions: acts.length ? acts : undefined },
            ]);
          }
          inputRef.current?.focus();
        },
      },
      controller.signal,
      attachments,
    );
  };

  /** Interrompt la réponse en cours (le texte déjà reçu est conservé) */
  const stop = () => abortRef.current?.abort();

  const handleFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    setError(null);
    const next = [...files];
    for (const file of picked) {
      if (next.length >= MAX_FILES) { setError(`Maximum ${MAX_FILES} fichiers.`); break; }
      if (file.size > MAX_FILE_BYTES) { setError(`${file.name} dépasse 10 Mo.`); continue; }
      try {
        next.push({ name: file.name, mime: file.type || 'application/octet-stream', data: await readAsBase64(file) });
      } catch {
        setError(`Lecture impossible : ${file.name}.`);
      }
    }
    setFiles(next.slice(0, MAX_FILES));
  };

  const removeFile = (i: number) => setFiles((prev) => prev.filter((_, j) => j !== i));

  const handleSend = (e?: FormEvent) => {
    e?.preventDefault();
    send(input, files);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input, files);
    }
  };

  const handleReset = () => {
    setMessages([WELCOME]);
    setError(null);
    setFiles([]);
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
        <button className="btn btn-ghost" data-tour="asst-reset" onClick={handleReset} title="Nouvelle conversation">
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
              <div className={`chat-avatar ${msg.role === 'assistant' ? 'bot' : 'user'}`}>
                {msg.role === 'assistant' ? <Flame size={16} /> : <User size={16} />}
              </div>
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
            <div className="chat-avatar bot"><Flame size={16} /></div>
            {streamText
              ? <div className="chat-bubble bot"><Markdown text={streamText} /><span className="chat-cursor">▋</span></div>
              : <div className="chat-bubble-thinking"><span /><span /><span /></div>}
          </div>
        )}

        {/* Suggestions (conversation vierge) */}
        {fresh && !sending && (
          <div className="assistant-suggestions" data-tour="asst-suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s.label} className="assistant-suggestion" onClick={() => send(s.prompt)}>
                <span className="assistant-suggestion-icon">{s.icon}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        )}

        <div ref={chatEnd} />
      </div>

      {error && <div className="chat-error" style={{ margin: '0 0 8px' }}>{error}</div>}

      {/* Fichiers joints en attente d'envoi */}
      {files.length > 0 && (
        <div className="assistant-attachments">
          {files.map((f, i) => (
            <span key={i} className="assistant-attachment-chip" title={f.name}>
              <FileText size={13} />
              <span className="assistant-attachment-name">{f.name}</span>
              <button type="button" onClick={() => removeFile(i)} title="Retirer"><X size={13} /></button>
            </span>
          ))}
        </div>
      )}

      {/* Saisie */}
      <form className="assistant-page-input" data-tour="asst-input" onSubmit={handleSend}>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={handleFiles}
        />
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
        <button
          type="button"
          className="assistant-input-btn assistant-attach"
          onClick={() => fileRef.current?.click()}
          disabled={sending || files.length >= MAX_FILES}
          title="Joindre un fichier (PDF, Word, Excel, image)"
        >
          <Paperclip size={18} />
        </button>
        {sending ? (
          <button type="button" className="assistant-input-btn assistant-stop" onClick={stop} title="Interrompre la réponse">
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            className="assistant-input-btn assistant-send"
            disabled={!input.trim() && files.length === 0}
            title="Envoyer"
          >
            <Send size={18} />
          </button>
        )}
      </form>
    </div>
  );
}
