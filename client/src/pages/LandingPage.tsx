import { Link } from 'react-router-dom';

const features = [
  {
    icon: '📋',
    title: 'Tactical Weekly Plans',
    desc: 'No generic advice. Get a week-by-week action plan with concrete tasks and KPIs tailored to your product.',
  },
  {
    icon: '🎯',
    title: 'Community Targeting',
    desc: 'Know exactly where your audience hangs out — Reddit, Discord, Twitter, Slack — and how to approach each community.',
  },
  {
    icon: '📝',
    title: 'Content Strategy',
    desc: 'Pre-written content angles and formats optimized for your niche. Threads, posts, guides — ready to publish.',
  },
  {
    icon: '🚀',
    title: 'Launch Sequencing',
    desc: 'A day-by-day launch playbook: pre-launch, launch day, post-launch. No more guessing what to do next.',
  },
  {
    icon: '✅',
    title: 'Validation Checklist',
    desc: 'Know if your idea is ready. A scored checklist to validate before you ship.',
  },
  {
    icon: '🤝',
    title: 'First User Tactics',
    desc: 'Proven tactics to get your first 100 users. DMs, communities, newsletters, partnerships — ranked by effort.',
  },
];

const steps = [
  { num: 1, title: 'Describe your product', desc: 'Tell us what you are building.' },
  { num: 2, title: 'We generate your plan', desc: 'AI-powered engine creates a tailored launch plan.' },
  { num: 3, title: 'Execute & track', desc: 'Follow the plan, check off items, iterate.' },
];

export default function LandingPage() {
  return (
    <div className="landing">
      {/* Nav */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <span className="landing-logo">🚀 LaunchForge</span>
          <div className="landing-nav-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <Link to="/login" className="btn btn-ghost" style={{ fontSize: '0.85rem' }}>Sign In</Link>
            <Link to="/register" className="btn btn-primary" style={{ fontSize: '0.85rem' }}>Get Started</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero-bg" />
        <div className="landing-hero-content">
          <h1>
            Your <span className="gradient-text">tactical launch plan</span>
            <br />in 30 seconds
          </h1>
          <p className="landing-hero-sub">
            Stop wasting time on generic advice. LaunchForge generates a personalized,
            step-by-step launch plan tailored to your product, audience, and niche.
          </p>
          <div className="landing-hero-cta">
            <Link to="/register" className="btn btn-primary" style={{ padding: '14px 32px', fontSize: '1.05rem' }}>
              Generate Your Plan Free
            </Link>
            <Link to="/login" className="btn btn-ghost" style={{ padding: '14px 32px', fontSize: '1.05rem' }}>
              Sign In
            </Link>
          </div>
          <p className="landing-hero-social" style={{fontSize:'0.8rem',color:'var(--color-text-muted)',marginTop:12}}>
            Used by founders building in public on Indie Hackers, Product Hunt, and Twitter/X
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="landing-section" id="features">
        <h2 className="landing-section-title">Everything you need to launch</h2>
        <p className="landing-section-sub">Seven battle-tested modules in every plan</p>
        <div className="landing-features">
          {features.map((f, i) => (
            <div key={i} className="landing-feature-card">
              <span className="landing-feature-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="landing-section" id="how" style={{ background: 'var(--color-surface)' }}>
        <h2 className="landing-section-title">How it works</h2>
        <p className="landing-section-sub">Three simple steps to your launch plan</p>
        <div className="landing-steps">
          {steps.map((s, i) => (
            <div key={i} className="landing-step">
              <div className="landing-step-num">{s.num}</div>
              <div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
              {i < steps.length - 1 && <div className="landing-step-arrow">→</div>}
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <Link to="/register" className="btn btn-primary" style={{ padding: '14px 48px', fontSize: '1.05rem' }}>
            Start Building Your Plan
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <p>Built for indie hackers who ship. &copy; 2026 LaunchForge</p>
      </footer>
    </div>
  );
}
