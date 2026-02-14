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

const TECH_STACK_GROUPS = {
  'CRM & Sales': [
    'Salesforce', 'HubSpot', 'Pipedrive', 'Zoho CRM', 'Microsoft Dynamics',
    'Close', 'Freshsales', 'Copper', 'Monday Sales CRM', 'Insightly',
  ],
  'Sales Engagement': [
    'Outreach', 'Salesloft', 'Apollo.io', 'Gong', 'Chorus',
    'Clari', 'ZoomInfo', 'Lusha', 'Cognism', 'Seamless.AI',
  ],
  'Marketing Automation': [
    'Marketo', 'Pardot', 'Mailchimp', 'ActiveCampaign', 'Klaviyo',
    'Brevo (Sendinblue)', 'Constant Contact', 'Drip', 'Iterable', 'Customer.io',
  ],
  'Analytics & BI': [
    'Google Analytics', 'Tableau', 'Power BI', 'Looker', 'Amplitude',
    'Mixpanel', 'Heap', 'Pendo', 'FullStory', 'Hotjar',
  ],
  'Cloud & Infrastructure': [
    'AWS', 'Google Cloud', 'Microsoft Azure', 'Heroku', 'DigitalOcean',
    'Cloudflare', 'Vercel', 'Netlify', 'Docker', 'Kubernetes',
  ],
  'Collaboration & Productivity': [
    'Slack', 'Microsoft Teams', 'Zoom', 'Notion', 'Asana',
    'Monday.com', 'Jira', 'Confluence', 'Trello', 'ClickUp',
  ],
  'Customer Support': [
    'Zendesk', 'Intercom', 'Freshdesk', 'ServiceNow', 'HubSpot Service Hub',
    'Drift', 'LiveChat', 'Help Scout', 'Front', 'Gladly',
  ],
  'Finance & HR': [
    'QuickBooks', 'Xero', 'NetSuite', 'Workday', 'BambooHR',
    'Gusto', 'Rippling', 'ADP', 'Bill.com', 'Brex',
  ],
  'Dev Tools & Engineering': [
    'GitHub', 'GitLab', 'Bitbucket', 'Jenkins', 'CircleCI',
    'Datadog', 'New Relic', 'Sentry', 'PagerDuty', 'Terraform',
  ],
}

const QUALIFYING_CRITERIA_GROUPS = {
  'Seniority Level': [
    { label: 'C-Suite (CEO, CTO, CFO)', value: 'c_suite' },
    { label: 'Founder', value: 'founder' },
    { label: 'Owner', value: 'owner' },
    { label: 'VP', value: 'vp' },
    { label: 'Head of Department', value: 'head' },
    { label: 'Director', value: 'director' },
    { label: 'Manager', value: 'manager' },
    { label: 'Senior', value: 'senior' },
    { label: 'Entry Level', value: 'entry' },
  ],
  'Department': [
    { label: 'Sales', value: 'dept_sales' },
    { label: 'Marketing', value: 'dept_marketing' },
    { label: 'Engineering', value: 'dept_engineering' },
    { label: 'Product Management', value: 'dept_product_management' },
    { label: 'Finance', value: 'dept_finance' },
    { label: 'Human Resources', value: 'dept_human_resources' },
    { label: 'Operations', value: 'dept_operations' },
    { label: 'IT', value: 'dept_it' },
    { label: 'Customer Support', value: 'dept_support' },
    { label: 'Legal', value: 'dept_legal' },
    { label: 'Business Development', value: 'dept_business_development' },
    { label: 'Data Science', value: 'dept_data_science' },
    { label: 'Consulting', value: 'dept_consulting' },
  ],
  'Company Revenue': [
    { label: 'Under $1M', value: 'rev_0_1M' },
    { label: '$1M – $10M', value: 'rev_1M_10M' },
    { label: '$10M – $50M', value: 'rev_10M_50M' },
    { label: '$50M – $100M', value: 'rev_50M_100M' },
    { label: '$100M – $500M', value: 'rev_100M_500M' },
    { label: '$500M – $1B', value: 'rev_500M_1B' },
    { label: '$1B+', value: 'rev_1B_plus' },
  ],
  'Funding Stage': [
    { label: 'Seed', value: 'fund_seed' },
    { label: 'Series A', value: 'fund_series_a' },
    { label: 'Series B', value: 'fund_series_b' },
    { label: 'Series C', value: 'fund_series_c' },
    { label: 'Series D+', value: 'fund_series_d' },
    { label: 'IPO / Public', value: 'fund_ipo' },
    { label: 'Private Equity', value: 'fund_private_equity' },
    { label: 'Bootstrapped', value: 'fund_bootstrapped' },
  ],
}

const TONES = [
  { id: 'professional', label: 'Professional', desc: 'Polished, formal, executive ready', icon: 'professional' },
  { id: 'casual', label: 'Casual', desc: 'Friendly, conversational, approachable', icon: 'casual' },
  { id: 'simple', label: 'Simple', desc: 'Short, direct, no fluff', icon: 'simple' },
]

/* ── Inline SVG Icons ─────────────────────────── */
const SvgIcon = ({ name, size = 16, color = 'currentColor' }) => {
  const icons = {
    user: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    target: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
    messageSquare: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    zap: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    layout: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>,
    mail: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
    linkedin: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>,
    phone: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
    professional: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
    casual: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    simple: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    penTool: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>,
    cpu: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>,
  }
  return icons[name] || null
}

const RequiredAsterisk = () => <span className="required-asterisk">*</span>

export default function ICPForm({ onSubmit, isLoading }) {
  const [form, setForm] = useState({
    industries: [],
    companySegments: [],
    companySizes: [],
    jobTitles: '',
    geographies: [],
    techStack: [],
    otherCriteria: [],
    prospectCount: 10,
    touchpointCount: 6,
    daySpacing: 3,
    channels: ['email'],
    emailSendType: 'manual',
    tones: ['professional'],
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

  // Track which industry/geography groups are expanded
  const [expandedIndustries, setExpandedIndustries] = useState({})
  const [expandedGeographies, setExpandedGeographies] = useState({})
  const [expandedTech, setExpandedTech] = useState({})
  const [expandedCriteria, setExpandedCriteria] = useState({})

  const update = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // Generic multi-toggle: add/remove from array, optionally enforce min 1
  const toggleArrayField = (field, value, minOne = false) => {
    setForm(prev => {
      const arr = prev[field]
      const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value]
      if (minOne && next.length === 0) return prev
      return { ...prev, [field]: next }
    })
  }

  const toggleSegment = (segment) => toggleArrayField('companySegments', segment)
  const toggleSize = (size) => toggleArrayField('companySizes', size)
  const toggleTone = (toneId) => toggleArrayField('tones', toneId, true)

  const toggleIndustry = (industry) => toggleArrayField('industries', industry)
  const toggleGeography = (geo) => toggleArrayField('geographies', geo)
  const toggleTech = (tool) => toggleArrayField('techStack', tool)
  const toggleCriteria = (val) => toggleArrayField('otherCriteria', val)

  // Select/deselect all industries in a category
  const toggleIndustryGroup = (groupName) => {
    const items = INDUSTRY_GROUPS[groupName] || []
    setForm(prev => {
      const allSelected = items.every(i => prev.industries.includes(i))
      const next = allSelected
        ? prev.industries.filter(i => !items.includes(i))
        : [...new Set([...prev.industries, ...items])]
      return { ...prev, industries: next }
    })
  }

  // Select/deselect all tech tools in a category
  const toggleTechGroup = (groupName) => {
    const items = TECH_STACK_GROUPS[groupName] || []
    setForm(prev => {
      const allSelected = items.every(i => prev.techStack.includes(i))
      const next = allSelected
        ? prev.techStack.filter(i => !items.includes(i))
        : [...new Set([...prev.techStack, ...items])]
      return { ...prev, techStack: next }
    })
  }

  // Select/deselect all criteria in a group
  const toggleCriteriaGroup = (groupName) => {
    const items = (QUALIFYING_CRITERIA_GROUPS[groupName] || []).map(c => c.value)
    setForm(prev => {
      const allSelected = items.every(c => prev.otherCriteria.includes(c))
      const next = allSelected
        ? prev.otherCriteria.filter(c => !items.includes(c))
        : [...new Set([...prev.otherCriteria, ...items])]
      return { ...prev, otherCriteria: next }
    })
  }

  // Select/deselect all geographies in a region group
  const toggleGeoGroup = (groupName) => {
    const items = (GEOGRAPHY_GROUPS[groupName] || []).map(g => g.value)
    setForm(prev => {
      const allSelected = items.every(g => prev.geographies.includes(g))
      const next = allSelected
        ? prev.geographies.filter(g => !items.includes(g))
        : [...new Set([...prev.geographies, ...items])]
      return { ...prev, geographies: next }
    })
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

  const isFormValid = form.industries.length > 0 && (form.companySizes.length > 0 || form.companySegments.length > 0) && form.geographies.length > 0 && form.jobTitles.trim() && form.senderName.trim() && form.senderTitle.trim() && form.senderCompany.trim() && form.productDescription.trim()

  return (
    <form onSubmit={handleSubmit}>
      {/* Sender Profile */}
      <div className="form-section sender-section">
        <h3 className="form-section-title">
          <span className="icon" style={{ background: 'rgba(212,132,154,0.1)', color: '#D4849A' }}><SvgIcon name="user" size={16} color="#D4849A" /></span>
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
      <div className="form-section icp-section">
        <h3 className="form-section-title">
          <span className="icon" style={{ background: 'rgba(107,138,219,0.1)', color: '#6B8ADB' }}><SvgIcon name="target" size={16} color="#6B8ADB" /></span>
          ICP Parameters
        </h3>
        <div className="form-grid">
          <div className="form-group full-width">
            <label>Industries <RequiredAsterisk /> {form.industries.length > 0 && <span className="multi-count">{form.industries.length} selected</span>}</label>
            <div className="multi-checkbox-groups">
              {Object.entries(INDUSTRY_GROUPS).map(([group, items]) => {
                const isExpanded = expandedIndustries[group]
                const selectedCount = items.filter(i => form.industries.includes(i)).length
                const allSelected = items.every(i => form.industries.includes(i))
                return (
                  <div key={group} className="checkbox-group">
                    <div className="checkbox-group-header" onClick={() => setExpandedIndustries(prev => ({ ...prev, [group]: !prev[group] }))}>
                      <span className="checkbox-group-arrow">{isExpanded ? '▾' : '▸'}</span>
                      <span className="checkbox-group-name">{group}</span>
                      {selectedCount > 0 && <span className="checkbox-group-count">{selectedCount}</span>}
                      <button type="button" className="checkbox-group-toggle" onClick={e => { e.stopPropagation(); toggleIndustryGroup(group) }}>
                        {allSelected ? 'Clear' : 'All'}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="checkbox-group-items">
                        {items.map(i => (
                          <label key={i} className={`checkbox-item ${form.industries.includes(i) ? 'checked' : ''}`}>
                            <input type="checkbox" checked={form.industries.includes(i)} onChange={() => toggleIndustry(i)} />
                            <span>{i}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="form-group">
            <label>Company Segment <span className="optional-tag">Optional — select multiple</span></label>
            <div className="segment-pills">
              {COMPANY_SEGMENTS.map(seg => (
                <button
                  key={seg.label}
                  type="button"
                  className={`segment-pill ${form.companySegments.includes(seg.label) ? 'active' : ''}`}
                  onClick={() => toggleSegment(seg.label)}
                >
                  {seg.label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group full-width">
            <label>Company Size (employees) {form.companySizes.length === 0 && form.companySegments.length === 0 && <RequiredAsterisk />} {form.companySizes.length > 0 && <span className="multi-count">{form.companySizes.length} selected</span>}</label>
            <div className="size-pills">
              {EMPLOYEE_SIZES.map(s => (
                <button
                  key={s.value}
                  type="button"
                  className={`segment-pill ${form.companySizes.includes(s.value) ? 'active' : ''}`}
                  onClick={() => toggleSize(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>
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

          <div className="form-group full-width">
            <label>Geography / Regions <RequiredAsterisk /> {form.geographies.length > 0 && <span className="multi-count">{form.geographies.length} selected</span>}</label>
            <div className="multi-checkbox-groups">
              {Object.entries(GEOGRAPHY_GROUPS).map(([group, items]) => {
                const isExpanded = expandedGeographies[group]
                const selectedCount = items.filter(g => form.geographies.includes(g.value)).length
                const allSelected = items.every(g => form.geographies.includes(g.value))
                return (
                  <div key={group} className="checkbox-group">
                    <div className="checkbox-group-header" onClick={() => setExpandedGeographies(prev => ({ ...prev, [group]: !prev[group] }))}>
                      <span className="checkbox-group-arrow">{isExpanded ? '▾' : '▸'}</span>
                      <span className="checkbox-group-name">{group}</span>
                      {selectedCount > 0 && <span className="checkbox-group-count">{selectedCount}</span>}
                      <button type="button" className="checkbox-group-toggle" onClick={e => { e.stopPropagation(); toggleGeoGroup(group) }}>
                        {allSelected ? 'Clear' : 'All'}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="checkbox-group-items">
                        {items.map(g => (
                          <label key={g.value} className={`checkbox-item ${form.geographies.includes(g.value) ? 'checked' : ''}`}>
                            <input type="checkbox" checked={form.geographies.includes(g.value)} onChange={() => toggleGeography(g.value)} />
                            <span>{g.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="form-group full-width">
            <label>Tech Stack <span className="optional-tag">Optional</span> {form.techStack.length > 0 && <span className="multi-count">{form.techStack.length} selected</span>} <span className="section-subtitle">— tools they currently use</span></label>
            <div className="multi-checkbox-groups">
              {Object.entries(TECH_STACK_GROUPS).map(([group, items]) => {
                const isExpanded = expandedTech[group]
                const selectedCount = items.filter(i => form.techStack.includes(i)).length
                const allSelected = items.every(i => form.techStack.includes(i))
                return (
                  <div key={group} className="checkbox-group">
                    <div className="checkbox-group-header" onClick={() => setExpandedTech(prev => ({ ...prev, [group]: !prev[group] }))}>
                      <span className="checkbox-group-arrow">{isExpanded ? '▾' : '▸'}</span>
                      <span className="checkbox-group-name">{group}</span>
                      {selectedCount > 0 && <span className="checkbox-group-count">{selectedCount}</span>}
                      <button type="button" className="checkbox-group-toggle" onClick={e => { e.stopPropagation(); toggleTechGroup(group) }}>
                        {allSelected ? 'Clear' : 'All'}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="checkbox-group-items">
                        {items.map(i => (
                          <label key={i} className={`checkbox-item ${form.techStack.includes(i) ? 'checked' : ''}`}>
                            <input type="checkbox" checked={form.techStack.includes(i)} onChange={() => toggleTech(i)} />
                            <span>{i}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="form-group full-width">
            <label>Qualifying Criteria <span className="optional-tag">Optional</span> {form.otherCriteria.length > 0 && <span className="multi-count">{form.otherCriteria.length} selected</span>} <span className="section-subtitle">— seniority, department, revenue, funding</span></label>
            <div className="multi-checkbox-groups">
              {Object.entries(QUALIFYING_CRITERIA_GROUPS).map(([group, items]) => {
                const isExpanded = expandedCriteria[group]
                const selectedCount = items.filter(c => form.otherCriteria.includes(c.value)).length
                const allSelected = items.every(c => form.otherCriteria.includes(c.value))
                return (
                  <div key={group} className="checkbox-group">
                    <div className="checkbox-group-header" onClick={() => setExpandedCriteria(prev => ({ ...prev, [group]: !prev[group] }))}>
                      <span className="checkbox-group-arrow">{isExpanded ? '▾' : '▸'}</span>
                      <span className="checkbox-group-name">{group}</span>
                      {selectedCount > 0 && <span className="checkbox-group-count">{selectedCount}</span>}
                      <button type="button" className="checkbox-group-toggle" onClick={e => { e.stopPropagation(); toggleCriteriaGroup(group) }}>
                        {allSelected ? 'Clear' : 'All'}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="checkbox-group-items">
                        {items.map(c => (
                          <label key={c.value} className={`checkbox-item ${form.otherCriteria.includes(c.value) ? 'checked' : ''}`}>
                            <input type="checkbox" checked={form.otherCriteria.includes(c.value)} onChange={() => toggleCriteria(c.value)} />
                            <span>{c.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Product & Messaging Context */}
      <div className="form-section product-section">
        <h3 className="form-section-title">
          <span className="icon" style={{ background: 'rgba(155,127,199,0.1)', color: '#9B7FC7' }}><SvgIcon name="messageSquare" size={16} color="#9B7FC7" /></span>
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
      <div className="form-section sequence-section">
        <h3 className="form-section-title">
          <span className="icon" style={{ background: 'rgba(232,158,108,0.1)', color: '#D4956A' }}><SvgIcon name="zap" size={16} color="#D4956A" /></span>
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
            <label>Touchpoints per Sequence (max 20) <RequiredAsterisk /></label>
            <div className="range-wrapper">
              <input type="range" min="3" max="20" value={form.touchpointCount} onChange={e => update('touchpointCount', parseInt(e.target.value))} />
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
            <label>Channels <RequiredAsterisk /> <span className="section-subtitle">— click in the order you want them sequenced</span></label>
            <div className="channel-order-group">
              {[
                { id: 'email', label: 'Email', iconName: 'mail' },
                { id: 'linkedin', label: 'LinkedIn', iconName: 'linkedin' },
                { id: 'calling', label: 'Calling', iconName: 'phone' },
              ].map(ch => {
                const orderIndex = form.channels.indexOf(ch.id)
                const isSelected = orderIndex !== -1
                return (
                  <button
                    key={ch.id}
                    type="button"
                    className={`channel-order-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleChannel(ch.id)}
                  >
                    <span className={`channel-order-badge ${isSelected ? 'active' : ''}`}>
                      {isSelected ? orderIndex + 1 : ''}
                    </span>
                    <SvgIcon name={ch.iconName} size={16} />
                    <span className="channel-order-label">{ch.label}</span>
                    {isSelected && form.channels.length > 1 && orderIndex === 0 && (
                      <span className="channel-primary-tag">Primary</span>
                    )}
                  </button>
                )
              })}
            </div>
            {form.channels.length > 1 && (
              <div className="channel-order-hint">
                Touchpoints will rotate: {form.channels.map((ch, i) => (
                  <span key={ch} className="channel-order-hint-item">
                    {i > 0 && ' → '}
                    {ch.charAt(0).toUpperCase() + ch.slice(1)}
                  </span>
                ))}
                {' → '}
                <span className="channel-order-hint-item">{form.channels[0].charAt(0).toUpperCase() + form.channels[0].slice(1)}</span>
                <span className="channel-order-hint-dots"> …</span>
              </div>
            )}
          </div>
          <div className="form-group full-width">
            <label>Copy Tone <RequiredAsterisk /> <span className="section-subtitle">— select one or more</span></label>
            <div className="tone-selector">
              {TONES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  className={`tone-btn ${form.tones.includes(t.id) ? 'active' : ''}`}
                  onClick={() => toggleTone(t.id)}
                >
                  <span className="tone-icon"><SvgIcon name={t.icon} size={22} /></span>
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
                  <span className="send-type-icon"><SvgIcon name="penTool" size={20} /></span>
                  <div>
                    <div className="send-type-label">Manual Send</div>
                    <div className="send-type-desc">Personal 1:1 emails from your inbox</div>
                  </div>
                </button>
                <button type="button" className={`send-type-btn ${form.emailSendType === 'automated' ? 'active' : ''}`} onClick={() => update('emailSendType', 'automated')}>
                  <span className="send-type-icon"><SvgIcon name="cpu" size={20} /></span>
                  <div>
                    <div className="send-type-label">Automated Send</div>
                    <div className="send-type-desc">Sequenced via Outreach, Salesloft, etc.</div>
                  </div>
                </button>
                <button type="button" className={`send-type-btn ${form.emailSendType === 'combo' ? 'active' : ''}`} onClick={() => update('emailSendType', 'combo')}>
                  <span className="send-type-icon"><SvgIcon name="zap" size={20} /></span>
                  <div>
                    <div className="send-type-label">Manual + Automated</div>
                    <div className="send-type-desc">Mix of personal 1:1 and sequenced sends</div>
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
          <span className="icon" style={{ background: 'rgba(90,107,138,0.1)', color: '#5a6b8a' }}><SvgIcon name="layout" size={16} color="#5a6b8a" /></span>
          Sequence Blueprint
          <span className="section-subtitle">— your {form.touchpointCount}-step outbound cadence over {(form.touchpointCount - 1) * form.daySpacing} days</span>
        </h3>
        <div className="preview-timeline">
          {buildPreviewSteps(form.touchpointCount, form.channels, form.daySpacing).map((step, i) => (
            <div key={i} className={`preview-step ${step.stage}`}>
              <div className="preview-step-day">Day {step.day}</div>
              <div className="preview-step-dot" />
              <div className="preview-step-info">
                <span className="preview-step-channel">{channelIcon(step.channel)} {step.channel}</span>
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

function channelIcon(channel) {
  const iconMap = { email: 'mail', linkedin: 'linkedin', calling: 'phone' }
  return <SvgIcon name={iconMap[channel] || 'mail'} size={12} />
}

function buildPreviewSteps(count, channels, spacing) {
  const steps = []
  const available = channels.length > 0 ? channels : ['email']
  for (let i = 0; i < count; i++) {
    const day = 1 + i * spacing
    const position = i / (count - 1 || 1)
    const stage = position <= 0.3 ? 'opening' : position <= 0.7 ? 'value_add' : 'closing'
    // Respect user-defined channel order — cycle through in the order they clicked
    const channel = available[i % available.length]
    steps.push({ day, stage, channel })
  }
  return steps
}
