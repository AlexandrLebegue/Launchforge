import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPlan } from '../api/client';

export default function CreatePlanPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    productName: '',
    description: '',
    targetAudience: '',
    niche: '',
    goals: '',
    pricing: '',
  });

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    const goals = form.goals
      .split('\n')
      .map((g) => g.trim())
      .filter(Boolean);

    if (goals.length === 0) {
      setError('Please enter at least one goal.');
      setBusy(false);
      return;
    }

    const res = await createPlan({
      productName: form.productName,
      description: form.description,
      targetAudience: form.targetAudience,
      niche: form.niche,
      goals,
      pricing: form.pricing,
    });

    setBusy(false);

    if (!res.success || !res.data) {
      setError(res.error || 'Failed to generate plan');
      return;
    }

    navigate(`/plan/${res.data.id}`);
  };

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 24 }}>Create Launch Plan</h1>

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label>Product Name</label>
            <input
              value={form.productName}
              onChange={(e) => handleChange('productName', e.target.value)}
              placeholder="e.g. TaskFlow"
              required
            />
          </div>
          <div className="form-group">
            <label>Niche / Category</label>
            <select
              value={form.niche}
              onChange={(e) => handleChange('niche', e.target.value)}
              required
            >
              <option value="">Select niche...</option>
              <option value="saas">SaaS</option>
              <option value="ai">AI / ML</option>
              <option value="devtool">DevTool</option>
              <option value="nocode">No-Code</option>
              <option value="marketplace">Marketplace</option>
              <option value="fintech">FinTech</option>
              <option value="health">Health / Wellness</option>
              <option value="education">EdTech</option>
              <option value="ecommerce">E-Commerce</option>
              <option value="content">Content / Media</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea
            value={form.description}
            onChange={(e) => handleChange('description', e.target.value)}
            placeholder="What does your product do? Describe the problem it solves..."
            required
          />
        </div>

        <div className="form-group">
          <label>Target Audience</label>
          <input
            value={form.targetAudience}
            onChange={(e) => handleChange('targetAudience', e.target.value)}
            placeholder="e.g. Remote software teams of 5-50 people"
            required
          />
        </div>

        <div className="form-group">
          <label>Goals (one per line)</label>
          <textarea
            value={form.goals}
            onChange={(e) => handleChange('goals', e.target.value)}
            placeholder="e.g. first 100 users&#10;product hunt launch&#10;10 paying customers"
            required
          />
        </div>

        <div className="form-group">
          <label>Pricing</label>
          <input
            value={form.pricing}
            onChange={(e) => handleChange('pricing', e.target.value)}
            placeholder="e.g. $29/month per team"
            required
          />
        </div>

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Generating your plan...' : 'Generate Launch Plan'}
        </button>
      </form>
    </div>
  );
}
