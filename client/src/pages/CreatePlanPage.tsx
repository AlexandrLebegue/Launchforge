import { useState, useRef, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPlan, researchProduct, ResearchResult } from '../api/client';

interface Message {
  role: 'bot' | 'user' | 'system';
  text: string;
}

const questions = [
  { field: 'productName' as const, label: 'Product Name', placeholder: 'e.g. TaskFlow', bot: "Let's start! What's your product called?" },
  { field: 'description' as const, label: 'Description', placeholder: 'What problem does it solve?', bot: 'Nice! Tell me what your product does in a few sentences.' },
  { field: 'targetAudience' as const, label: 'Target Audience', placeholder: 'e.g. Remote dev teams of 5-50', bot: 'Who exactly is this for? Describe your ideal user.' },
  { field: 'goals' as const, label: 'Goals', placeholder: 'e.g. Get 100 users, launch on PH', bot: "What are your top goals? List them one per line." },
  { field: 'pricing' as const, label: 'Pricing', placeholder: 'e.g. $29/month per team', bot: "And finally — what's your pricing model?" },
];

type FormFields = { productName: string; description: string; targetAudience: string; niche: string; goals: string; pricing: string; };

const niches = [
  { value: 'saas', label: 'SaaS' }, { value: 'ai', label: 'AI / ML' },
  { value: 'devtool', label: 'DevTool' }, { value: 'nocode', label: 'No-Code' },
  { value: 'marketplace', label: 'Marketplace' }, { value: 'fintech', label: 'FinTech' },
  { value: 'health', label: 'Health' }, { value: 'education', label: 'EdTech' },
  { value: 'ecommerce', label: 'E-Commerce' }, { value: 'content', label: 'Content / Media' },
];

export default function CreatePlanPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'bot', text: "👋 Hey! I'll help you build a tactical launch plan. Let me ask you a few quick questions." },
  ]);
  const [step, setStep] = useState(0);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormFields>({ productName: '', description: '', targetAudience: '', niche: 'saas', goals: '', pricing: '' });
  const [waitingForNiche, setWaitingForNiche] = useState(false);
  const [researching, setResearching] = useState(false);
  const [researchResult, setResearchResult] = useState<ResearchResult | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, researching]);

  const addBot = (text: string, delay = 0) => {
    if (delay > 0) {
      setTimeout(() => setMessages((m) => [...m, { role: 'bot', text }]), delay);
    } else {
      setMessages((m) => [...m, { role: 'bot', text }]);
    }
  };

  const addUser = (text: string) => {
    setMessages((m) => [...m, { role: 'user', text }]);
  };

  const askNext = () => {
    const q = questions[step];
    if (q) {
      setTimeout(() => addBot(q.bot), 400);
    }
  };

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
      addBot("What category best fits your product?");
    } else if (step === 3 && waitingForNiche) {
      // Answer already processed via niche click
    } else if (step === 3) {
      setForm((f) => ({ ...f, goals: answer }));
      setStep(4);
      setTimeout(() => addBot(questions[4].bot), 500);
    } else if (step === 4) {
      setForm((f) => ({ ...f, pricing: answer }));
      setStep(5);
      doResearch();
    }
  };

  const selectNiche = (value: string) => {
    const label = niches.find((n) => n.value === value)?.label || value;
    addUser(label);
    setForm((f) => ({ ...f, niche: value }));
    setWaitingForNiche(false);
    setStep(4);
    setTimeout(() => addBot(questions[3].bot), 500);
  };

  const doResearch = async () => {
    setResearching(true);
    setMessages((m) => [...m, { role: 'system', text: '' }]);
    addBot("🔍 Researching your market... give me a sec.");

    const res = await researchProduct(form.productName, form.description, form.niche);
    setResearching(false);

    if (res.success && res.data) {
      setResearchResult(res.data);
      let researchMsg = '**Market Intelligence found:**\n';
      if (res.data.competitors.length > 0) researchMsg += `\n🔹 *Competitors:* ${res.data.competitors.map((c) => c.name).join(', ')}`;
      if (res.data.communities.length > 0) researchMsg += `\n🔹 *Communities:* ${res.data.communities.map((c) => c.name).join(', ')}`;
      if (res.data.trends.length > 0) researchMsg += `\n🔹 *Trend:* ${res.data.trends[0].slice(0, 120)}`;
      addBot(researchMsg);
    } else {
      addBot("Couldn't find specific market data, but no worries — I'll generate a solid plan anyway!");
    }

    setTimeout(() => {
      addBot("Ready to generate your plan? Just click below.");
    }, 800);
  };

  const generate = async () => {
    setBusy(true);
    addBot("⚡ Generating your tactical launch plan...");

    const goalsArr = form.goals.split('\n').map((g) => g.trim()).filter(Boolean);
    const res = await createPlan({
      productName: form.productName,
      description: form.description,
      targetAudience: form.targetAudience,
      niche: form.niche,
      goals: goalsArr.length > 0 ? goalsArr : ['launch successfully'],
      pricing: form.pricing,
    });
    setBusy(false);

    if (res.success && res.data) {
      const planId = res.data.id;
      addBot("✅ Your launch plan is ready! Taking you there now...");
      setTimeout(() => navigate(`/plan/${planId}`), 1000);
    } else {
      addBot(`❌ ${res.error || 'Something went wrong'}`);
    }
  };

  const isLastStep = step >= 5 && !researching;

  return (
    <div className="chat-page">
      <h1 style={{ fontSize: '1.3rem', textAlign: 'center', marginBottom: 16 }}>🚀 Launch Plan Builder</h1>
      <div className="chat-container">
        <div className="chat-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
              {msg.role === 'bot' && <div className="chat-avatar">🤖</div>}
              {msg.role === 'user' && <div className="chat-avatar">👤</div>}
              <div className={`chat-bubble ${msg.role}`}>{msg.text}</div>
            </div>
          ))}

          {researching && (
            <div className="chat-msg chat-msg-bot">
              <div className="chat-avatar">🤖</div>
              <div className="chat-bubble bot">
                <span className="research-dots"><span>.</span><span>.</span><span>.</span></span>
              </div>
            </div>
          )}

          {waitingForNiche && (
            <div className="chat-msg chat-msg-bot">
              <div className="chat-avatar">🤖</div>
              <div className="niche-picker">
                {niches.map((n) => (
                  <button key={n.value} className="niche-btn" onClick={() => selectNiche(n.value)}>
                    {n.label}
                  </button>
                ))}
              </div>
            </div>
          )}

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

        <form className="chat-input-bar" onSubmit={handleSend}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={waitingForNiche ? 'Click a niche above...' : 'Type your answer...'}
            disabled={waitingForNiche || researching || busy || isLastStep}
            autoFocus
          />
          {isLastStep ? (
            <button type="button" className="btn btn-primary" onClick={generate} disabled={busy}>
              {busy ? 'Generating...' : 'Generate Plan'}
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={waitingForNiche || researching || busy || !input.trim()}>
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
