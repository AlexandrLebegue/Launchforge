import { useState, useRef, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPlan, researchProduct, ResearchResult } from '../api/client';

interface Message {
  role: 'bot' | 'user' | 'system';
  text: string;
}

const questions = [
  {
    field:       'productName' as const,
    label:       'Product Name',
    placeholder: 'e.g. TaskFlow',
    bot:         "Let's start! What's your product called?",
  },
  {
    field:       'description' as const,
    label:       'Description',
    placeholder: 'What problem does it solve?',
    bot:         'Nice! Tell me what your product does in a few sentences.',
  },
  {
    field:       'targetAudience' as const,
    label:       'Target Audience',
    placeholder: 'e.g. Remote dev teams of 5–50',
    bot:         'Who exactly is this for? Describe your ideal user.',
  },
  {
    field:       'goals' as const,
    label:       'Goals',
    placeholder: 'e.g. Get 100 users, launch on PH',
    bot:         'What are your top goals? List them one per line.',
  },
  {
    field:       'pricing' as const,
    label:       'Pricing',
    placeholder: 'e.g. $29/month per team',
    bot:         "And finally — what's your pricing model?",
  },
];

type FormFields = {
  productName:    string;
  description:    string;
  targetAudience: string;
  niche:          string;
  goals:          string;
  pricing:        string;
};

const niches = [
  { value: 'saas',        label: 'SaaS',        emoji: '☁️'  },
  { value: 'ai',          label: 'AI / ML',     emoji: '🤖'  },
  { value: 'devtool',     label: 'DevTool',     emoji: '🛠️'  },
  { value: 'nocode',      label: 'No-Code',     emoji: '🧩'  },
  { value: 'marketplace', label: 'Marketplace', emoji: '🏪'  },
  { value: 'fintech',     label: 'FinTech',     emoji: '💳'  },
  { value: 'health',      label: 'Health',      emoji: '🏥'  },
  { value: 'education',   label: 'EdTech',      emoji: '🎓'  },
  { value: 'ecommerce',   label: 'E-Commerce',  emoji: '🛒'  },
  { value: 'content',     label: 'Content',     emoji: '✍️'  },
];

const fieldLabels: Record<keyof FormFields, string> = {
  productName:    'Product',
  description:    'Description',
  targetAudience: 'Audience',
  niche:          'Niche',
  goals:          'Goals',
  pricing:        'Pricing',
};

export default function CreatePlanPage() {
  const navigate = useNavigate();

  const [messages,         setMessages]         = useState<Message[]>([
    { role: 'bot', text: "👋 Hey! I'll help you build a tactical launch plan. Let me ask you a few quick questions." },
  ]);
  const [step,             setStep]             = useState(0);
  const [input,            setInput]            = useState('');
  const [busy,             setBusy]             = useState(false);
  const [form,             setForm]             = useState<FormFields>({
    productName: '', description: '', targetAudience: '',
    niche: 'saas', goals: '', pricing: '',
  });
  const [waitingForNiche,  setWaitingForNiche]  = useState(false);
  const [researching,      setResearching]      = useState(false);
  const [researchResult,   setResearchResult]   = useState<ResearchResult | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, researching]);

  const addBot  = (text: string, delay = 0) => {
    const push = () => setMessages((m) => [...m, { role: 'bot', text }]);
    delay > 0 ? setTimeout(push, delay) : push();
  };
  const addUser = (text: string) => setMessages((m) => [...m, { role: 'user', text }]);

  const handleSend = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;

    const answer = input.trim();
    setInput('');
    addUser(answer);

    if (step === 0) {
      setForm((f) => ({ ...f, productName: answer }));
      setStep(1);
      setTimeout(() => addBot(questions[1].bot), 500);
    } else if (step === 1) {
      setForm((f) => ({ ...f, description: answer }));
      setStep(2);
      setTimeout(() => addBot(questions[2].bot), 500);
    } else if (step === 2) {
      setForm((f) => ({ ...f, targetAudience: answer }));
      setStep(3);
      setWaitingForNiche(true);
      setTimeout(() => addBot('What category best fits your product?'), 400);
    } else if (step === 3 && waitingForNiche) {
      // handled by selectNiche
    } else if (step === 3) {
      setForm((f) => ({ ...f, goals: answer }));
      setStep(4);
      setTimeout(() => addBot(questions[4].bot), 500);
    } else if (step === 4) {
      setForm((f) => ({ ...f, pricing: answer }));
      setStep(5);
      doResearch(form);
    }
  };

  const selectNiche = (value: string) => {
    const niche = niches.find((n) => n.value === value);
    const label = niche ? `${niche.emoji} ${niche.label}` : value;
    addUser(label);
    setForm((f) => ({ ...f, niche: value }));
    setWaitingForNiche(false);
    setStep(3);
    setTimeout(() => addBot(questions[3].bot), 500);
  };

  const doResearch = async (currentForm: FormFields) => {
    setResearching(true);
    addBot('🔍 Researching your market… give me a sec.');

    const res = await researchProduct(
      currentForm.productName,
      currentForm.description,
      currentForm.niche,
    );
    setResearching(false);

    if (res.success && res.data) {
      setResearchResult(res.data);
      let msg = '**Market Intelligence found:**\n';
      if (res.data.competitors.length  > 0) msg += `\n🔹 *Competitors:* ${res.data.competitors.map((c) => c.name).join(', ')}`;
      if (res.data.communities.length  > 0) msg += `\n🔹 *Communities:* ${res.data.communities.map((c) => c.name).join(', ')}`;
      if (res.data.trends.length       > 0) msg += `\n🔹 *Trend:* ${res.data.trends[0].slice(0, 120)}`;
      addBot(msg);
    } else {
      addBot("Couldn't find specific market data, but no worries — I'll generate a solid plan anyway!");
    }

    setTimeout(() => addBot('Ready to generate your plan? Just click below.'), 800);
  };

  const generate = async () => {
    setBusy(true);
    addBot('⚡ Generating your tactical launch plan…');

    const goalsArr = form.goals.split('\n').map((g) => g.trim()).filter(Boolean);
    const res = await createPlan({
      productName:    form.productName,
      description:    form.description,
      targetAudience: form.targetAudience,
      niche:          form.niche,
      goals:          goalsArr.length > 0 ? goalsArr : ['launch successfully'],
      pricing:        form.pricing,
    });
    setBusy(false);

    if (res.success && res.data) {
      addBot('✅ Your launch plan is ready! Taking you there now…');
      setTimeout(() => navigate(`/plan/${res.data!.id}`), 1000);
    } else {
      addBot(`❌ ${res.error || 'Something went wrong'}`);
    }
  };

  const isLastStep    = step >= 5 && !researching;
  const progressPct   = Math.min((step / questions.length) * 100, 100);
  const stepLabel     = step < questions.length
    ? `Step ${step + 1} of ${questions.length}`
    : 'Almost done!';

  // Which form fields have values so far
  const summaryFields: (keyof FormFields)[] = [
    'productName', 'description', 'targetAudience', 'niche', 'goals', 'pricing',
  ];

  return (
    <div>
      {/* Page title */}
      <div className="chat-page-title">🚀 Launch Plan Builder</div>
      <div className="chat-page-subtitle">Answer a few questions and get your personalized launch plan</div>

      {/* Progress */}
      <div className="chat-progress-wrap">
        <div className="chat-step-label">{stepLabel}</div>
        <div className="chat-progress-bar">
          <div className="chat-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {/* Layout: chat + summary panel */}
      <div className="chat-layout">
        {/* Chat area */}
        <div className="chat-page">
          <div className="chat-container">
            {/* Messages */}
            <div className="chat-messages">
              {messages.map((msg, i) => (
                <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
                  {msg.role === 'bot'  && <div className="chat-avatar">🤖</div>}
                  {msg.role === 'user' && <div className="chat-avatar">👤</div>}
                  <div className={`chat-bubble ${msg.role}`}>{msg.text}</div>
                </div>
              ))}

              {/* Bot thinking */}
              {researching && (
                <div className="chat-msg chat-msg-bot">
                  <div className="chat-avatar">🤖</div>
                  <div className="chat-bubble-thinking">
                    <span /><span /><span />
                  </div>
                </div>
              )}

              {/* Niche picker */}
              {waitingForNiche && (
                <div className="chat-msg chat-msg-bot">
                  <div className="chat-avatar">🤖</div>
                  <div className="niche-picker">
                    {niches.map((n) => (
                      <button
                        key={n.value}
                        className={`niche-btn ${form.niche === n.value ? 'selected' : ''}`}
                        onClick={() => selectNiche(n.value)}
                      >
                        <span className="niche-btn-icon">{n.emoji}</span>
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Research chips */}
              {researchResult && !researching && (
                <div className="chat-research-results">
                  {researchResult.competitors.length > 0 && (
                    <div className="research-chip-group">
                      <span className="research-label">Competitors</span>
                      {researchResult.competitors.slice(0, 4).map((c, i) => (
                        <span key={i} className="chip chip-warning">{c.name}</span>
                      ))}
                    </div>
                  )}
                  {researchResult.communities.length > 0 && (
                    <div className="research-chip-group">
                      <span className="research-label">Communities</span>
                      {researchResult.communities.slice(0, 5).map((c, i) => (
                        <span key={i} className="chip chip-success">{c.name}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div ref={chatEnd} />
            </div>

            {/* Input bar */}
            <form className="chat-input-bar" onSubmit={handleSend}>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  waitingForNiche ? 'Click a category above…'
                  : isLastStep    ? 'Plan ready to generate!'
                  : 'Type your answer…'
                }
                disabled={waitingForNiche || researching || busy || isLastStep}
                autoFocus
              />
              {isLastStep ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={generate}
                  disabled={busy}
                >
                  {busy ? '⏳ Generating…' : '⚡ Generate Plan'}
                </button>
              ) : (
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={waitingForNiche || researching || busy || !input.trim()}
                >
                  Send →
                </button>
              )}
            </form>
          </div>
        </div>

        {/* Live summary panel (hidden on mobile) */}
        <div className="chat-summary-panel">
          <div className="chat-summary-title">Your Plan So Far</div>
          {summaryFields.map((field) => (
            <div key={field} className="chat-summary-field">
              <div className="chat-summary-label">{fieldLabels[field]}</div>
              {form[field]
                ? <div className="chat-summary-value">{form[field]}</div>
                : <div className="chat-summary-empty">—</div>
              }
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
