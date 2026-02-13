import { useState } from 'react'
import ICPForm from './components/ICPForm'
import ProspectList from './components/ProspectList'
import SequenceCopy from './components/SequenceCopy'
import MantylLoader from './components/MantylLoader'
import { findProspects, generateSequence } from './utils/apiClient'

const LOGO_SVG = `<svg viewBox="0 0 220 50" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="a" x1="0%" y1="100%" x2="50%" y2="0%"><stop offset="0%" stop-color="#5A79CA"/><stop offset="100%" stop-color="#8B6DB3"/></linearGradient>
<linearGradient id="b" x1="50%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#C06E85"/><stop offset="100%" stop-color="#D4856A"/></linearGradient></defs>
<g transform="translate(2,3) scale(1)"><path d="M4 38 L18 6 L26 30 Z" fill="url(#a)" opacity="0.85"/><path d="M22 30 L30 6 L44 38 Z" fill="url(#b)" opacity="0.75"/></g>
<text x="58" y="37" font-family="Inter,sans-serif" font-weight="800" font-size="30" letter-spacing="-0.5" fill="#ffffff">mantyl</text>
</svg>`

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

    // Step 1: Find prospects
    setStep('loading')
    setLoadingMessage('Searching for prospects matching your ICP...')
    setLoadingSub('Enriching contact data via Clay')

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

      // Step 2: Generate sequences
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
      <header className="header">
        <div dangerouslySetInnerHTML={{ __html: LOGO_SVG }} style={{ height: 32, width: 'auto' }} />
        <span className="header-badge">Free Tool</span>
      </header>

      <section className="hero">
        <h1>ICP-to-<span>Sequence</span> Generator</h1>
        <p>Find prospects matching your ICP, then generate personalized multi-channel outbound sequences — powered by AI.</p>
        <div className="progress-bar">
          <div className={`progress-step ${step === 'form' ? 'active' : (step !== 'form' ? 'completed' : '')}`}>
            {step !== 'form' ? '✓' : '1'} Define ICP
          </div>
          <div className={`progress-step ${step === 'loading' ? 'active' : (step === 'results' ? 'completed' : '')}`}>
            {step === 'results' ? '✓' : '2'} Find & Enrich
          </div>
          <div className={`progress-step ${step === 'results' ? 'completed' : ''}`}>
            {step === 'results' ? '✓' : '3'} Generate Copy
          </div>
        </div>
      </section>

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
            <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'flex-end' }}>
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
        Powered by <a href="https://mantyl.ai" target="_blank" rel="noopener noreferrer">mantyl.ai</a> — AI-Powered GTM Automation
      </footer>
    </div>
  )
}
