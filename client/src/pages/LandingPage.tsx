import { Link } from 'react-router-dom';
import { useIntersectionObserver } from '../hooks/useIntersectionObserver';

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
  { num: 1, title: 'Describe your product', desc: 'Tell us what you are building in a quick chat.' },
  { num: 2, title: 'We research your market', desc: 'AI scans competitors, communities & trends in real time.' },
  { num: 3, title: 'Execute & track', desc: 'Follow the plan on your Kanban board, check off items, iterate.' },
];

const stats = [
  { value: '500+', label: 'Plans Generated' },
  { value: '30s',  label: 'Average Setup'   },
  { value: '100%', label: 'Free to Start'   },
];

const testimonials = [
  {
    text: 'Generated a complete 8-week launch plan in under a minute. The community targeting alone saved me days of research.',
    name: 'Alex M.',
    role: 'Indie Hacker',
    initial: 'A',
  },
  {
    text: 'Finally a tool that gives you a real playbook instead of generic advice. The Kanban board keeps me on track.',
    name: 'Sarah K.',
    role: 'SaaS Founder',
    initial: 'S',
  },
  {
    text: 'Used LaunchForge for my DevTool launch on Product Hunt. Got 200+ upvotes by following the plan exactly.',
    name: 'Ravi T.',
    role: 'Developer',
    initial: 'R',
  },
];

export default function LandingPage() {
  // Activates scroll-reveal on all .reveal elements
  useIntersectionObserver();

  return (
    <div className="landing">
      {/* ── Nav ── */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <span className="landing-logo">
            <span className="landing-logo-icon">🚀</span>
            LaunchForge
          </span>
          <div className="landing-nav-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <Link to="/login"    className="btn btn-ghost btn-sm">Sign In</Link>
            <Link to="/register" className="btn btn-primary btn-sm">Get Started</Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="landing-hero">
        <div className="landing-hero-bg" />
        <div className="landing-hero-content">
          <h1>
            Your{' '}
            <span className="gradient-text typing-cursor">tactical launch plan</span>
            <br />in 30 seconds
          </h1>
          <p className="landing-hero-sub">
            Stop wasting time on generic advice. LaunchForge generates a personalized,
            step-by-step launch plan tailored to your product, audience, and niche.
          </p>

          <div className="landing-hero-cta">
            <Link
              to="/register"
              className="btn btn-primary btn-primary-glow btn-lg"
            >
              Generate Your Plan Free →
            </Link>
            <Link to="/login" className="btn btn-ghost btn-lg">
              Sign In
            </Link>
          </div>

          {/* Stats */}
          <div className="landing-stats">
            {stats.map((s, i) => (
              <div key={i} className={`landing-stat stagger-${i + 1}`}>
                <div className="landing-stat-value">{s.value}</div>
                <div className="landing-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="landing-section reveal" id="features">
        <div className="landing-section-inner">
          <h2 className="landing-section-title">Everything you need to launch</h2>
          <p className="landing-section-sub">
            Seven battle-tested modules in every plan
          </p>
          <div className="landing-features">
            {features.map((f, i) => (
              <div
                key={i}
                className={`landing-feature-card reveal stagger-${(i % 6) + 1}`}
              >
                <span className="landing-feature-icon">{f.icon}</span>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="landing-section reveal" style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
        <div className="landing-section-inner">
          <h2 className="landing-section-title">Trusted by founders</h2>
          <p className="landing-section-sub">
            Real results from indie hackers who shipped
          </p>
          <div className="landing-testimonials">
            {testimonials.map((t, i) => (
              <div key={i} className={`testimonial-card reveal stagger-${i + 1}`}>
                <div className="testimonial-stars">★★★★★</div>
                <p className="testimonial-text">"{t.text}"</p>
                <div className="testimonial-author">
                  <div className="testimonial-avatar">{t.initial}</div>
                  <div>
                    <div className="testimonial-name">{t.name}</div>
                    <div className="testimonial-role">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="landing-section reveal" id="how">
        <div className="landing-section-inner">
          <h2 className="landing-section-title">How it works</h2>
          <p className="landing-section-sub">Three simple steps to your launch plan</p>
          <div className="landing-steps">
            {steps.map((s, i) => (
              <div key={i} className={`landing-step reveal stagger-${i + 1}`}>
                <div className="landing-step-num">{s.num}</div>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 48 }}>
            <Link
              to="/register"
              className="btn btn-primary btn-primary-glow btn-lg"
            >
              Start Building Your Plan →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landing-footer">
        <p>
          Built for indie hackers who ship. &copy; 2026{' '}
          <strong style={{ color: 'var(--color-text)' }}>LaunchForge</strong>
        </p>
        <p style={{ marginTop: 6 }}>
          <a href="#features">Features</a>
          {' · '}
          <a href="#how">How it works</a>
          {' · '}
          <Link to="/register">Get Started</Link>
        </p>
      </footer>
    </div>
  );
}
