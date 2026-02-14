import { useState } from 'react'
import ICPForm from './components/ICPForm'
import ProspectList from './components/ProspectList'
import SequenceCopy from './components/SequenceCopy'
import MantylLoader from './components/MantylLoader'
import { findProspects, generateSequence, pollForPhones, checkUsage, incrementUsage } from './utils/apiClient'

const CALENDLY_URL = 'https://calendly.com/jose-mantyl/free-consultation-ai-automation'

export default function App() {
  const [step, setStep] = useState('form')
  const [prospects, setProspects] = useState([])
  const [sequences, setSequences] = useState([])
  const [selectedProspect, setSelectedProspect] = useState(0)
  const [error, setError] = useState(null)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [loadingSub, setLoadingSub] = useState('')
  const [formData, setFormData] = useState(null)
  const [phonePollingActive, setPhonePollingActive] = useState(false)
  const [usageLimitHit, setUsageLimitHit] = useState(false)

  const handleSubmit = async (form) => {
    setError(null)
    setFormData(form)

    // ── Usage gate: check if this email has exceeded the free limit ──
    const userEmail = (form.senderEmail || '').trim().toLowerCase()
    if (userEmail) {
      try {
        const usage = await checkUsage(userEmail)
        if (!usage.allowed) {
          setUsageLimitHit(true)
          setStep('paywall')
          return
        }
      } catch (e) {
        console.warn('[Usage] Check failed, proceeding:', e.message)
      }
    }

    setStep('loading')
    setLoadingMessage('Searching for prospects matching your ICP...')
    setLoadingSub('Enriching contact data via Apollo')

    let foundProspects = null
    try {
      const prospectData = await findProspects({
        industries: form.industries,
        companySegments: form.companySegments,
        companySizes: form.companySizes,
        jobTitles: form.jobTitles,
        geographies: form.geographies,
        techStack: form.techStack,
        otherCriteria: form.otherCriteria,
        prospectCount: form.prospectCount,
      })

      if (!prospectData.prospects || prospectData.prospects.length === 0) {
        throw new Error('No prospects found matching your ICP. Try broadening your criteria.')
      }

      foundProspects = prospectData.prospects
      setProspects(foundProspects)

      // Start polling for async phone data from Apollo webhook
      if (prospectData.sessionId) {
        setPhonePollingActive(true)
        const stopPolling = pollForPhones(
          prospectData.sessionId,
          foundProspects,
          (updatedProspects) => {
            setProspects(updatedProspects)
            foundProspects = updatedProspects // Update local ref too
          },
          { interval: 8000, maxDuration: 300000 } // Poll every 8s for up to 5 min (Apollo webhook takes "several minutes")
        )
        // Stop polling after 5 min regardless
        setTimeout(() => {
          stopPolling()
          setPhonePollingActive(false)
        }, 300000)

      }

      const totalProspects = foundProspects.length
      setLoadingMessage(`Writing personalized sequences for ${totalProspects} prospects...`)
      setLoadingSub(`Starting generation...`)

      const seqData = await generateSequence({
        prospects: prospectData.prospects,
        channels: form.channels,
        touchpointCount: form.touchpointCount,
        daySpacing: form.daySpacing,
        emailSendType: form.emailSendType,
        tones: form.tones,
        productDescription: form.productDescription,
        painPoint: form.painPoint,
        proposedSolution: form.proposedSolution,
        openToLearnMore: form.openToLearnMore,
        sender: {
          name: form.senderName,
          title: form.senderTitle,
          company: form.senderCompany,
          email: form.senderEmail,
          linkedin: form.senderLinkedin,
          calendly: form.senderCalendly,
        },
      }, (completed, total) => {
        setLoadingSub(`Generating sequences: ${completed} of ${total} complete`)
      })

      const generatedSeqs = seqData.sequences || []
      setSequences(generatedSeqs)
      setSelectedProspect(0)

      // Increment server-side usage count for this email
      const userEmail = (form.senderEmail || '').trim().toLowerCase()
      if (userEmail) {
        try { await incrementUsage(userEmail) } catch (e) { console.warn('[Usage] Increment failed:', e.message) }
      }

      // Show partial-failure warning but still display results
      if (seqData.partialFailure && generatedSeqs.length < totalProspects) {
        setError(`Generated ${generatedSeqs.length} of ${totalProspects} sequences. Some prospects timed out — you can retry or write those manually.`)
      }

      setStep('results')

      // Scroll to top so user sees results from the beginning
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      })

    } catch (err) {
      console.error(err)
      setError(err.message)
      // Use local variable — React state (prospects) is stale inside this closure
      if (foundProspects && foundProspects.length > 0) {
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
              <stop offset="50%" stopColor="rgba(107,138,219,0.55)" />
              <stop offset="100%" stopColor="rgba(155,127,199,0)" />
            </linearGradient>
            <linearGradient id="beam-grad-2" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(155,127,199,0)" />
              <stop offset="50%" stopColor="rgba(212,132,154,0.45)" />
              <stop offset="100%" stopColor="rgba(232,158,108,0)" />
            </linearGradient>
            <linearGradient id="beam-grad-3" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(232,158,108,0)" />
              <stop offset="50%" stopColor="rgba(107,138,219,0.4)" />
              <stop offset="100%" stopColor="rgba(155,127,199,0)" />
            </linearGradient>
          </defs>
          <path className="beam beam-1" d="M-100,180 Q300,80 600,150 T1300,100" stroke="url(#beam-grad-1)" strokeWidth="1.5" fill="none" />
          <path className="beam beam-2" d="M-100,220 Q400,120 700,200 T1300,140" stroke="url(#beam-grad-2)" strokeWidth="1.5" fill="none" />
          <path className="beam beam-3" d="M-100,140 Q200,200 500,130 T1300,180" stroke="url(#beam-grad-3)" strokeWidth="1.2" fill="none" />
          <path className="beam beam-4" d="M-100,260 Q350,160 650,240 T1300,170" stroke="url(#beam-grad-1)" strokeWidth="1" fill="none" />
          <path className="beam beam-5" d="M-100,100 Q250,180 550,110 T1300,200" stroke="url(#beam-grad-2)" strokeWidth="1" fill="none" />
        </svg>

        {/* Dot grid overlay */}
        <div className="hero-dot-grid" />

        <div className="hero-content">
          <div className="hero-eyebrow">
            <span className="eyebrow-pill">
              <span className="eyebrow-pulse" />
              AI-Powered
            </span>
          </div>
          <h1>
            <span className="hero-gradient-text">Sequences in Seconds.</span>
          </h1>
          <p className="hero-subtitle">
            Define your ICP. Our AI finds prospects, enriches data, and writes multi-channel sequences — ready to launch.
          </p>
          <div className="hero-chips">
            <span className="hero-chip"><span className="chip-dot" />270M+ contacts</span>
            <span className="hero-chip"><span className="chip-dot" />3 channels</span>
            <span className="hero-chip"><span className="chip-dot" />Waterfall verified</span>
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
            <span className="error-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
            <div>
              <p><strong>Something went wrong:</strong> {error}</p>
              {step === 'form' && error.toLowerCase().includes('no prospects found') && (
                <p style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
                  Try broadening your search — use a wider company size range, fewer job titles, or a larger geography.
                </p>
              )}
              {step === 'form' && (error.toLowerCase().includes('api key') || error.toLowerCase().includes('not configured')) && (
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

        {step === 'paywall' && (
          <div className="paywall-screen fade-in">
            <div className="paywall-card">
              <div className="paywall-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-peach, #D4956A)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </div>
              <h2 className="paywall-title">Thanks for trying this free tool!</h2>
              <p className="paywall-desc">
                It looks like you've exceeded the free usage limit. If you'd like this custom-built for your business with <strong>unlimited usage</strong>, personalized to your exact ICP, messaging, and workflow — let's talk.
              </p>
              <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer" className="paywall-cta">
                Book a Free Consultation
              </a>
              <button className="paywall-back" onClick={handleReset}>
                ← Back to form
              </button>
            </div>
          </div>
        )}

        {step === 'results' && (
          <>
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
                phonePollingActive={phonePollingActive}
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
