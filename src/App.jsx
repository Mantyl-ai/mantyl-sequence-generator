import { useState } from 'react'
import ICPForm from './components/ICPForm'
import ProspectList from './components/ProspectList'
import SequenceCopy from './components/SequenceCopy'
import MantylLoader from './components/MantylLoader'
import { findProspects, generateSequence } from './utils/apiClient'

const CALENDLY_URL = 'https://calendly.com/mantyl/demo'

function getUsageCount() {
  try { return parseInt(localStorage.getItem('mantyl_usage') || '0', 10) } catch { return 0 }
}
function incrementUsage() {
  try { const c = getUsageCount() + 1; localStorage.setItem('mantyl_usage', String(c)); return c } catch { return 1 }
}

export default function App() {
  const [step, setStep] = useState('form')
  const [prospects, setProspects] = useState([])
  const [sequences, setSequences] = useState([])
  const [selectedProspect, setSelectedProspect] = useState(0)
  const [error, setError] = useState(null)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [loadingSub, setLoadingSub] = useState('')
  const [formData, setFormData] = useState(null)
  const [usageCount, setUsageCount] = useState(getUsageCount())

  const handleSubmit = async (form) => {
    setError(null)
    setFormData(form)

    setStep('loading')
    setLoadingMessage('Searching for prospects matching your ICP...')
    setLoadingSub('Enriching contact data via Apollo')

    try {
      const prospectData = await findProspects({
        industry: form.industry,
        companySegment: form.companySegment,
        companySize: form.companySize,
        jobTitles: form.jobTitles,
        geography: form.geography,
        techStack: form.techStack,
        otherCriteria: form.otherCriteria,
        prospectCount: form.prospectCount,
      })

      if (!prospectData.prospects || prospectData.prospects.length === 0) {
        throw new Error('No prospects found matching your ICP. Try broadening your criteria.')
      }

      setProspects(prospectData.prospects)

      setLoadingMessage(`Writing personalized copy for ${prospectData.prospects.length} prospects...`)
      setLoadingSub('Claude is generating unique messages for each touchpoint')

      const seqData = await generateSequence({
        prospects: prospectData.prospects,
        channels: form.channels,
        touchpointCount: form.touchpointCount,
        daySpacing: form.daySpacing,
        emailSendType: form.emailSendType,
        tone: form.tone,
        productDescription: form.productDescription,
        painPoint: form.painPoint,
        proposedSolution: form.proposedSolution,
        openToLearnMore: form.openToLearnMore,
        sender: {
          name: form.senderName,
          title: form.senderTitle,
          company: form.senderCompany,
          phone: form.senderPhone,
          linkedin: form.senderLinkedin,
          calendly: form.senderCalendly,
        },
      })

      setSequences(seqData.sequences || [])
      setSelectedProspect(0)
      const newCount = incrementUsage()
      setUsageCount(newCount)
      setStep('results')

    } catch (err) {
      console.error(err)
      setError(err.message)
      if (prospects.length > 0) {
        setStep('results')
      } else {
        setStep('form')
      }
    }
  }

  const handleReset = () => {
    setStep('form')
    setProspects([])
    setSequences([])
    setSelectedProspect(0)
    setError(null)
  }

  const isLoading = step === 'loading'

  return (
    <div className="app">
      {/* ── Enterprise Header ─────────────────────────── */}
      <header className="header">
        <div className="header-left">
          <a href="https://mantyl.ai" target="_blank" rel="noopener noreferrer" className="header-logo-link">
            <img src="/logos/mantyl-full-light.svg" alt="Mantyl" className="header-logo-img" />
          </a>
          <div className="header-divider" />
          <span className="header-product-name">Sequence Generator</span>
        </div>
        <div className="header-right">
          <span className="header-badge-ai">
            <span className="ai-sparkle">✦</span>
            AI-Powered
          </span>
          <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer" className="header-cta-btn">
            Book Now
          </a>
        </div>
      </header>

      {/* ── Hero Section — Compact Aurora Style ─────────── */}
      <section className="hero">
        {/* Aurora gradient blobs */}
        <div className="aurora-blob aurora-1" />
        <div className="aurora-blob aurora-2" />
        <div className="aurora-blob aurora-3" />

        {/* Animated beam lines */}
        <svg className="hero-beams" viewBox="0 0 1200 300" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="beam-grad-1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(107,138,219,0)" />
              <stop offset="50%" stopColor="rgba(107,138,219,0.3)" />
              <stop offset="100%" stopColor="rgba(155,127,199,0)" />
            </linearGradient>
            <linearGradient id="beam-grad-2" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(155,127,199,0)" />
              <stop offset="50%" stopColor="rgba(212,132,154,0.25)" />
              <stop offset="100%" stopColor="rgba(232,158,108,0)" />
            </linearGradient>
            <linearGradient id="beam-grad-3" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(232,158,108,0)" />
              <stop offset="50%" stopColor="rgba(107,138,219,0.2)" />
              <stop offset="100%" stopColor="rgba(155,127,199,0)" />
            </linearGradient>
          </defs>
          <path className="beam beam-1" d="M-100,180 Q300,80 600,150 T1300,100" stroke="url(#beam-grad-1)" strokeWidth="1" fill="none" />
          <path className="beam beam-2" d="M-100,220 Q400,120 700,200 T1300,140" stroke="url(#beam-grad-2)" strokeWidth="1" fill="none" />
          <path className="beam beam-3" d="M-100,140 Q200,200 500,130 T1300,180" stroke="url(#beam-grad-3)" strokeWidth="0.8" fill="none" />
          <path className="beam beam-4" d="M-100,260 Q350,160 650,240 T1300,170" stroke="url(#beam-grad-1)" strokeWidth="0.6" fill="none" />
          <path className="beam beam-5" d="M-100,100 Q250,180 550,110 T1300,200" stroke="url(#beam-grad-2)" strokeWidth="0.7" fill="none" />
        </svg>

        {/* Dot grid overlay */}
        <div className="hero-dot-grid" />

        <div className="hero-content">
          <div className="hero-eyebrow">
            <span className="eyebrow-pill">
              <span className="eyebrow-pulse" />
              AI Agent
            </span>
          </div>
          <h1>
            <span className="hero-gradient-text hero-shimmer">Sequences in Seconds.</span>
          </h1>
          <p className="hero-subtitle">
            Define your ICP. Our AI finds prospects, enriches data, and writes multi-channel sequences — ready to launch.
          </p>
          <div className="hero-chips">
            <span className="hero-chip"><span className="chip-dot" />270M+ contacts</span>
            <span className="hero-chip"><span className="chip-dot" />3 channels</span>
            <span className="hero-chip"><span className="chip-dot" />&lt;60s generation</span>
          </div>
        </div>
      </section>

      {/* ── Floating Progress Indicator ──────────────── */}
      <div className="progress-bar">
        <div className={`progress-step ${step === 'form' ? 'active' : (step !== 'form' ? 'completed' : '')}`}>
          <span className="progress-num">{step !== 'form' ? '✓' : '1'}</span>
          Define ICP
        </div>
        <div className="progress-connector" />
        <div className={`progress-step ${step === 'loading' ? 'active' : (step === 'results' ? 'completed' : '')}`}>
          <span className="progress-num">{step === 'results' ? '✓' : '2'}</span>
          Find & Enrich
        </div>
        <div className="progress-connector" />
        <div className={`progress-step ${step === 'results' ? 'completed' : ''}`}>
          <span className="progress-num">{step === 'results' ? '✓' : '3'}</span>
          Generate Copy
        </div>
      </div>

      <main className="main">
        {error && (
          <div className="error-banner fade-in">
            <span className="error-icon">⚠️</span>
            <div>
              <p><strong>Something went wrong:</strong> {error}</p>
              {step === 'form' && (
                <p style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
                  Check that your API keys are configured in Netlify environment variables.
                </p>
              )}
            </div>
          </div>
        )}

        {isLoading && (
          <MantylLoader message={loadingMessage} subMessage={loadingSub} />
        )}

        {step === 'form' && !isLoading && (
          <>
            <ICPForm onSubmit={handleSubmit} isLoading={isLoading} />
            <div className="cta-banner fade-in">
              <div className="cta-content">
                <span className="cta-icon">✦</span>
                <div>
                  <div className="cta-title">Want this built custom for your team?</div>
                  <div className="cta-desc">We build personalized outbound automation tools tailored to your ICP, messaging, and sales workflow.</div>
                </div>
              </div>
              <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer" className="cta-btn">Book a Call</a>
            </div>
          </>
        )}

        {step === 'results' && (
          <>
            {usageCount >= 3 && (
              <div className="usage-limit-banner fade-in">
                <div className="usage-limit-icon">🎉</div>
                <div className="usage-limit-text">
                  <strong>Thank you for using our tool!</strong>
                  <p>If you're interested in learning more, we'd love to build a custom version tailored to your team's exact workflow, ICP, and messaging.</p>
                </div>
                <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer" className="usage-limit-btn">Book a Meeting</a>
              </div>
            )}
            <div className="results-top-bar fade-in">
              <div className="results-summary">
                <span className="results-icon">✦</span>
                <span><strong>{prospects.length} prospects</strong> found &amp; enriched · <strong>{sequences.length} sequences</strong> generated</span>
              </div>
              <button className="btn-secondary" onClick={handleReset}>← New Search</button>
            </div>
            <div className="stacked-layout fade-in">
              <ProspectList
                prospects={prospects}
                sequences={sequences}
                selectedIndex={selectedProspect}
                onSelectProspect={setSelectedProspect}
              />
              <SequenceCopy
                sequences={sequences}
                prospects={prospects}
                selectedProspectIndex={selectedProspect}
                onSelectProspect={setSelectedProspect}
                senderProfile={formData}
              />
            </div>
            <div className="cta-banner cta-banner-results fade-in">
              <div className="cta-content">
                <span className="cta-icon">✦</span>
                <div>
                  <div className="cta-title">Like what you see?</div>
                  <div className="cta-desc">Let us build a custom outbound engine for your team with your brand, sequences, and integrations baked in.</div>
                </div>
              </div>
              <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer" className="cta-btn">Book a Call</a>
            </div>
          </>
        )}
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <img src="/logos/mantyl-icon.svg" alt="" className="footer-logo-icon" />
          <span>Powered by <a href="https://mantyl.ai" target="_blank" rel="noopener noreferrer">mantyl.ai</a> — AI-Powered GTM Automation</span>
        </div>
      </footer>
    </div>
  )
}
