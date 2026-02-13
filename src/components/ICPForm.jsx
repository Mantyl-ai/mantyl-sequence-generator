import { useState } from 'react'

const INDUSTRY_GROUPS = {
  'Software & Technology': [
    'SaaS / Cloud Software', 'IT Services & Consulting', 'Cybersecurity', 'Data & Analytics',
    'AI / Machine Learning', 'DevOps / Infrastructure', 'Internet / Web Services', 'Mobile Apps',
    'Computer Hardware', 'Semiconductors', 'Computer Networking', 'Computer Games / Gaming',
    'Blockchain / Cryptocurrency', 'IoT / Connected Devices', 'Cloud Infrastructure', 'E-commerce Platforms',
  ],
  'Industry Verticals (Tech)': [
    'Fintech', 'Healthtech / Medtech', 'Edtech', 'Martech / Adtech', 'HR Tech', 'Legal Tech',
    'Proptech / Real Estate Tech', 'Cleantech / Climate Tech', 'Agritech / FoodTech', 'Insurtech',
    'Govtech', 'Construction Tech', 'Logistics Tech', 'RegTech / Compliance Tech', 'Biotech',
  ],
  'Financial Services': [
    'Banking', 'Investment Banking', 'Venture Capital & Private Equity', 'Insurance', 'Accounting',
    'Financial Planning & Advisory', 'Capital Markets', 'Lending & Mortgages', 'Payment Processing', 'Wealth Management',
  ],
  'Healthcare & Life Sciences': [
    'Hospitals & Health Systems', 'Pharmaceuticals', 'Medical Devices', 'Biotechnology',
    'Mental Health & Wellness', 'Dental', 'Veterinary', 'Clinical Research / CRO',
    'Health Insurance / Payers', 'Home Health & Elder Care', 'Telehealth',
  ],
  'Manufacturing & Industrial': [
    'Manufacturing', 'Industrial Automation', 'Chemicals', 'Plastics & Rubber', 'Metals & Mining',
    'Paper & Packaging', 'Textiles & Apparel Manufacturing', 'Electronics Manufacturing',
    'Machinery & Equipment', 'Building Materials',
  ],
  'Consumer & Retail': [
    'Retail', 'E-commerce / DTC', 'Consumer Goods / CPG', 'Luxury Goods', 'Fashion & Apparel',
    'Food & Beverage', 'Cosmetics & Personal Care', 'Sporting Goods', 'Consumer Electronics', 'Home & Garden',
  ],
  'Business Services': [
    'Professional Services', 'Management Consulting', 'Staffing & Recruiting', 'Outsourcing / BPO',
    'Market Research', 'Public Relations / Communications', 'Advertising & Creative Services',
    'Events & Conferences', 'Facilities Management', 'Security Services', 'Printing & Publishing Services',
  ],
  'Media & Communications': [
    'Media & Entertainment', 'Broadcasting (TV, Radio)', 'Publishing', 'Music', 'Film & Video Production',
    'Telecommunications', 'Wireless / Mobile', 'Satellite & Cable', 'Social Media / Creator Economy', 'News & Journalism',
  ],
  'Transportation & Logistics': [
    'Logistics & Supply Chain', 'Freight & Shipping', 'Airlines / Aviation', 'Maritime / Shipping',
    'Trucking & Ground Transport', 'Warehousing & Distribution', 'Railroad', 'Ride Sharing / Mobility',
    'Courier & Last Mile Delivery', 'Automotive',
  ],
  'Energy & Utilities': [
    'Oil & Gas', 'Renewable Energy / Solar / Wind', 'Electric Utilities', 'Water & Waste Management',
    'Nuclear Energy', 'Energy Storage / Batteries', 'Mining & Natural Resources',
  ],
  'Real Estate & Construction': [
    'Commercial Real Estate', 'Residential Real Estate', 'Property Management',
    'Construction & Engineering', 'Architecture & Design', 'Civil Engineering', 'Real Estate Investment (REITs)',
  ],
  'Education': [
    'Higher Education', 'K-12 Education', 'Corporate Training & L&D', 'Online Learning / MOOCs',
    'Test Prep & Tutoring', 'Education Administration', 'Libraries',
  ],
  'Government & Nonprofit': [
    'Federal Government', 'State & Local Government', 'Military & Defense', 'Aerospace & Defense Contractors',
    'Nonprofit / NGO', 'International Organizations', 'Political Organizations', 'Religious Organizations',
  ],
  'Other': [
    'Hospitality & Hotels', 'Restaurants & Food Service', 'Travel & Tourism', 'Sports & Fitness',
    'Legal Services / Law Firms', 'Agriculture & Farming', 'Forestry & Fishing', 'Cannabis / Hemp',
    'Funeral Services', 'Other',
  ],
}

const EMPLOYEE_SIZES = [
  { label: '1 to 10', value: '1-10' },
  { label: '11 to 20', value: '11-20' },
  { label: '21 to 50', value: '21-50' },
  { label: '51 to 100', value: '51-100' },
  { label: '101 to 200', value: '101-200' },
  { label: '201 to 500', value: '201-500' },
  { label: '501 to 1,000', value: '501-1,000' },
  { label: '1,001 to 2,000', value: '1,001-2,000' },
  { label: '2,001 to 5,000', value: '2,001-5,000' },
  { label: '5,001 to 10,000', value: '5,001-10,000' },
  { label: '10,001+', value: '10,001+' },
]

const COMPANY_SEGMENTS = [
  { label: 'SMB' },
  { label: 'Midmarket' },
  { label: 'Enterprise' },
]

const GEOGRAPHY_GROUPS = {
  'Global': [
    { label: 'Global (All Regions)', value: 'Global' },
  ],
  'Americas': [
    { label: 'Americas (All)', value: 'Americas' },
    { label: 'United States', value: 'United States' },
    { label: 'United States — Northeast', value: 'United States, Northeast' },
    { label: 'United States — Southeast', value: 'United States, Southeast' },
    { label: 'United States — Midwest', value: 'United States, Midwest' },
    { label: 'United States — West Coast', value: 'United States, West' },
    { label: 'United States — Southwest', value: 'United States, Southwest' },
    { label: 'Canada', value: 'Canada' },
    { label: 'Mexico', value: 'Mexico' },
    { label: 'Brazil', value: 'Brazil' },
    { label: 'Argentina', value: 'Argentina' },
    { label: 'Colombia', value: 'Colombia' },
    { label: 'Chile', value: 'Chile' },
    { label: 'Latin America (Other)', value: 'Latin America' },
  ],
  'Europe, Middle East & Africa': [
    { label: 'EMEA (All)', value: 'EMEA' },
    { label: 'United Kingdom', value: 'United Kingdom' },
    { label: 'Germany', value: 'Germany' },
    { label: 'France', value: 'France' },
    { label: 'Netherlands', value: 'Netherlands' },
    { label: 'Spain', value: 'Spain' },
    { label: 'Italy', value: 'Italy' },
    { label: 'Switzerland', value: 'Switzerland' },
    { label: 'Nordics (Sweden, Norway, Denmark, Finland)', value: 'Nordics' },
    { label: 'Eastern Europe', value: 'Eastern Europe' },
    { label: 'Israel', value: 'Israel' },
    { label: 'United Arab Emirates', value: 'United Arab Emirates' },
    { label: 'Saudi Arabia', value: 'Saudi Arabia' },
    { label: 'South Africa', value: 'South Africa' },
    { label: 'Nigeria', value: 'Nigeria' },
    { label: 'Middle East (Other)', value: 'Middle East' },
    { label: 'Africa (Other)', value: 'Africa' },
  ],
  'Asia Pacific': [
    { label: 'APAC (All)', value: 'APAC' },
    { label: 'Australia', value: 'Australia' },
    { label: 'New Zealand', value: 'New Zealand' },
    { label: 'India', value: 'India' },
    { label: 'Japan', value: 'Japan' },
    { label: 'South Korea', value: 'South Korea' },
    { label: 'China', value: 'China' },
    { label: 'Singapore', value: 'Singapore' },
    { label: 'Hong Kong', value: 'Hong Kong' },
    { label: 'Southeast Asia', value: 'Southeast Asia' },
    { label: 'Taiwan', value: 'Taiwan' },
    { label: 'Philippines', value: 'Philippines' },
    { label: 'Indonesia', value: 'Indonesia' },
  ],
}

const TONES = [
  { id: 'professional', label: 'Professional', desc: 'Polished, formal, executive ready', icon: '🎯' },
  { id: 'casual', label: 'Casual', desc: 'Friendly, conversational, approachable', icon: '💬' },
  { id: 'simple', label: 'Simple', desc: 'Short, direct, no fluff', icon: '⚡' },
]

const RequiredAsterisk = () => <span className="required-asterisk">*</span>

export default function ICPForm({ onSubmit, isLoading }) {
  const [form, setForm] = useState({
    industry: '',
    companySegment: '',
    companySize: '',
    jobTitles: '',
    geography: '',
    techStack: '',
    otherCriteria: '',
    prospectCount: 10,
    touchpointCount: 6,
    daySpacing: 3,
    channels: ['email'],
    emailSendType: 'manual',
    tone: 'professional',
    productDescription: '',
    painPoint: '',
    proposedSolution: '',
    openToLearnMore: '',
    senderName: '',
    senderTitle: '',
    senderCompany: '',
    senderPhone: '',
    senderLinkedin: '',
    senderCalendly: '',
  })

  const update = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // Segment and size are INDEPENDENT — selecting a segment is optional context, not a filter
  const toggleSegment = (segment) => {
    setForm(prev => ({
      ...prev,
      companySegment: prev.companySegment === segment ? '' : segment,
    }))
  }

  const toggleChannel = (channel) => {
    setForm(prev => {
      const channels = prev.channels.includes(channel)
        ? prev.channels.filter(c => c !== channel)
        : [...prev.channels, channel]
      return { ...prev, channels: channels.length > 0 ? channels : prev.channels }
    })
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!isFormValid) return
    onSubmit(form)
  }

  const isFormValid = form.industry && form.companySize && form.geography && form.jobTitles.trim() && form.senderName.trim() && form.senderTitle.trim() && form.senderCompany.trim() && form.productDescription.trim()

  return (
    <form onSubmit={handleSubmit}>
      {/* Sender Profile */}
      <div className="form-section sender-section">
        <h3 className="form-section-title">
          <span className="icon" style={{ background: 'rgba(232,158,108,0.1)', color: '#E89E6C' }}>👤</span>
          Your Profile
          <span className="section-subtitle">— this info signs off your outbound copy</span>
        </h3>
        <div className="form-grid">
          <div className="form-group">
            <label>Your Name <RequiredAsterisk /></label>
            <input type="text" value={form.senderName} onChange={e => update('senderName', e.target.value)} placeholder="e.g. Sarah Chen" required />
          </div>
          <div className="form-group">
            <label>Your Title <RequiredAsterisk /></label>
            <input type="text" value={form.senderTitle} onChange={e => update('senderTitle', e.target.value)} placeholder="e.g. Account Executive" required />
          </div>
          <div className="form-group">
            <label>Your Company <RequiredAsterisk /></label>
            <input type="text" value={form.senderCompany} onChange={e => update('senderCompany', e.target.value)} placeholder="e.g. mantyl.ai" required />
          </div>
          <div className="form-group">
            <label>Phone <span className="optional-tag">Optional</span></label>
            <input type="text" value={form.senderPhone} onChange={e => update('senderPhone', e.target.value)} placeholder="e.g. (415) 555-0142" />
          </div>
          <div className="form-group">
            <label>LinkedIn Profile <span className="optional-tag">Optional</span></label>
            <input type="url" value={form.senderLinkedin} onChange={e => update('senderLinkedin', e.target.value)} placeholder="e.g. linkedin.com/in/sarahchen" />
          </div>
          <div className="form-group">
            <label>Calendly / Booking Link <span className="optional-tag">Optional</span></label>
            <input type="url" value={form.senderCalendly} onChange={e => update('senderCalendly', e.target.value)} placeholder="e.g. calendly.com/sarah-chen/30min" />
          </div>
        </div>
      </div>

      {/* ICP Parameters */}
      <div className="form-section">
        <h3 className="form-section-title">
          <span className="icon" style={{ background: 'rgba(107,138,219,0.1)', color: '#6B8ADB' }}>🎯</span>
          ICP Parameters
        </h3>
        <div className="form-grid">
          <div className="form-group">
            <label>Industry <RequiredAsterisk /></label>
            <select value={form.industry} onChange={e => update('industry', e.target.value)} required>
              <option value="">Select an Industry</option>
              {Object.entries(INDUSTRY_GROUPS).map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map(i => <option key={i} value={i}>{i}</option>)}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Company Segment <span className="optional-tag">Optional</span></label>
            <div className="segment-pills">
              {COMPANY_SEGMENTS.map(seg => (
                <button
                  key={seg.label}
                  type="button"
                  className={`segment-pill ${form.companySegment === seg.label ? 'active' : ''}`}
                  onClick={() => toggleSegment(seg.label)}
                >
                  {seg.label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Company Size (employees) <RequiredAsterisk /></label>
            <select value={form.companySize} onChange={e => update('companySize', e.target.value)} required>
              <option value="">Select Size</option>
              {EMPLOYEE_SIZES.map(s => <option key={s.value} value={s.value}>{s.label} employees</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Job Titles <RequiredAsterisk /></label>
            <input
              type="text"
              value={form.jobTitles}
              onChange={e => update('jobTitles', e.target.value)}
              placeholder="e.g. VP Sales, CRO, Head of Growth, SDR Manager"
              required
            />
          </div>

          <div className="form-group">
            <label>Geography / Region <RequiredAsterisk /></label>
            <select value={form.geography} onChange={e => update('geography', e.target.value)} required>
              <option value="">Select Region</option>
              {Object.entries(GEOGRAPHY_GROUPS).map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Tech Stack <span className="optional-tag">Optional</span> <span className="section-subtitle">— tools they currently use</span></label>
            <input
              type="text"
              value={form.techStack}
              onChange={e => update('techStack', e.target.value)}
              placeholder="e.g. Salesforce, HubSpot, Outreach, Gong"
            />
          </div>

          <div className="form-group full-width">
            <label>Other Qualifying Criteria <span className="optional-tag">Optional</span></label>
            <input
              type="text"
              value={form.otherCriteria}
              onChange={e => update('otherCriteria', e.target.value)}
              placeholder="e.g. Series B+ funding, recently hired SDRs, growing 50%+ YoY"
            />
          </div>
        </div>
      </div>

      {/* Product & Messaging Context */}
      <div className="form-section product-section">
        <h3 className="form-section-title">
          <span className="icon" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>💬</span>
          Product & Messaging
        </h3>
        <div className="form-grid">
          <div className="form-group full-width">
            <label>Product Description <RequiredAsterisk /> <span className="section-subtitle">— what your product is and what it solves</span></label>
            <textarea
              rows={3}
              value={form.productDescription}
              onChange={e => update('productDescription', e.target.value)}
              placeholder="e.g. Mantyl is an AI powered GTM platform that automates ICP research, prospect enrichment, and personalized sequence generation"
              required
            />
          </div>
          <div className="form-group full-width">
            <label>Common Pain Point Your Product Solves <span className="optional-tag">Optional</span></label>
            <input
              type="text"
              value={form.painPoint}
              onChange={e => update('painPoint', e.target.value)}
              placeholder="e.g. Reps spend 3+ hours/day on manual research before every outbound call"
            />
          </div>
          <div className="form-group full-width">
            <label>Proposed Solution <span className="optional-tag">Optional</span></label>
            <input
              type="text"
              value={form.proposedSolution}
              onChange={e => update('proposedSolution', e.target.value)}
              placeholder="e.g. AI powered ICP enrichment that auto generates personalized sequences"
            />
          </div>
          <div className="form-group full-width">
            <label>What You Want Them to Be Open to Learn More About <span className="optional-tag">Optional</span></label>
            <input
              type="text"
              value={form.openToLearnMore}
              onChange={e => update('openToLearnMore', e.target.value)}
              placeholder="e.g. How teams are using AI to 3x their outbound pipeline"
            />
          </div>
        </div>
      </div>

      {/* Sequence Settings */}
      <div className="form-section">
        <h3 className="form-section-title">
          <span className="icon" style={{ background: 'rgba(155,127,199,0.1)', color: '#9B7FC7' }}>⚡</span>
          Sequence Settings
        </h3>
        <div className="form-grid">
          <div className="form-group">
            <label>Number of Prospects (max 20) <RequiredAsterisk /></label>
            <div className="range-wrapper">
              <input type="range" min="1" max="20" value={form.prospectCount} onChange={e => update('prospectCount', parseInt(e.target.value))} />
              <span className="range-value">{form.prospectCount}</span>
            </div>
          </div>
          <div className="form-group">
            <label>Touchpoints per Sequence <RequiredAsterisk /></label>
            <div className="range-wrapper">
              <input type="range" min="3" max="12" value={form.touchpointCount} onChange={e => update('touchpointCount', parseInt(e.target.value))} />
              <span className="range-value">{form.touchpointCount}</span>
            </div>
          </div>
          <div className="form-group">
            <label>Days Between Touchpoints <RequiredAsterisk /></label>
            <div className="range-wrapper">
              <input type="range" min="1" max="7" value={form.daySpacing} onChange={e => update('daySpacing', parseInt(e.target.value))} />
              <span className="range-value">{form.daySpacing}</span>
            </div>
          </div>
          <div className="form-group">
            <label>Channels <RequiredAsterisk /></label>
            <div className="checkbox-group">
              {[
                { id: 'email', label: '📧 Email' },
                { id: 'linkedin', label: '💼 LinkedIn' },
                { id: 'calling', label: '📞 Calling' },
              ].map(ch => (
                <label key={ch.id} className={`checkbox-label ${form.channels.includes(ch.id) ? 'checked' : ''}`}>
                  <input type="checkbox" checked={form.channels.includes(ch.id)} onChange={() => toggleChannel(ch.id)} />
                  <span className="checkbox-icon" />
                  {ch.label}
                </label>
              ))}
            </div>
          </div>
          <div className="form-group full-width">
            <label>Copy Tone <RequiredAsterisk /></label>
            <div className="tone-selector">
              {TONES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  className={`tone-btn ${form.tone === t.id ? 'active' : ''}`}
                  onClick={() => update('tone', t.id)}
                >
                  <span className="tone-icon">{t.icon}</span>
                  <div className="tone-text">
                    <div className="tone-label">{t.label}</div>
                    <div className="tone-desc">{t.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          {form.channels.includes('email') && (
            <div className="form-group full-width">
              <label>Email Send Type <RequiredAsterisk /></label>
              <div className="send-type-toggle">
                <button type="button" className={`send-type-btn ${form.emailSendType === 'manual' ? 'active' : ''}`} onClick={() => update('emailSendType', 'manual')}>
                  <span className="send-type-icon">✍️</span>
                  <div>
                    <div className="send-type-label">Manual Send</div>
                    <div className="send-type-desc">Personal 1:1 emails from your inbox</div>
                  </div>
                </button>
                <button type="button" className={`send-type-btn ${form.emailSendType === 'automated' ? 'active' : ''}`} onClick={() => update('emailSendType', 'automated')}>
                  <span className="send-type-icon">🤖</span>
                  <div>
                    <div className="send-type-label">Automated Send</div>
                    <div className="send-type-desc">Sequenced via Outreach, Salesloft, etc.</div>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sequence Structure Preview — redesigned */}
      <div className="form-section preview-section">
        <h3 className="form-section-title" style={{ marginBottom: 16 }}>
          <span className="icon" style={{ background: 'rgba(212,132,154,0.1)', color: '#D4849A' }}>📋</span>
          Sequence Blueprint
          <span className="section-subtitle">— your {form.touchpointCount}-step outbound cadence over {(form.touchpointCount - 1) * form.daySpacing} days</span>
        </h3>
        <div className="preview-timeline">
          {buildPreviewSteps(form.touchpointCount, form.channels, form.daySpacing).map((step, i) => (
            <div key={i} className={`preview-step ${step.stage}`}>
              <div className="preview-step-day">Day {step.day}</div>
              <div className="preview-step-dot" />
              <div className="preview-step-info">
                <span className="preview-step-channel">{channelEmoji(step.channel)} {step.channel}</span>
                <span className={`preview-step-stage ${step.stage}`}>{step.stage.replace('_', ' ')}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button type="submit" className="generate-btn" disabled={isLoading || !isFormValid}>
        {isLoading ? (
          <><span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> Generating...</>
        ) : (
          <>
            <span className="generate-sparkle">✦</span>
            Generate Sequences
          </>
        )}
      </button>
    </form>
  )
}

function channelEmoji(channel) {
  return channel === 'email' ? '📧' : channel === 'linkedin' ? '💼' : '📞'
}

function buildPreviewSteps(count, channels, spacing) {
  const steps = []
  const available = channels.length > 0 ? channels : ['email']
  for (let i = 0; i < count; i++) {
    const day = 1 + i * spacing
    const position = i / (count - 1 || 1)
    const stage = position <= 0.3 ? 'opening' : position <= 0.7 ? 'value_add' : 'closing'
    let channel
    if (i === 0) channel = 'email'
    else if (i === count - 1 && available.includes('calling')) channel = 'calling'
    else channel = available[i % available.length]
    steps.push({ day, stage, channel })
  }
  return steps
}
