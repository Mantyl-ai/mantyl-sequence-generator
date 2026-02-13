import { useState, useEffect } from 'react'

const STAGES = [
  { key: 'search', label: 'Searching prospect database', icon: SearchIcon },
  { key: 'enrich', label: 'Enriching contact data', icon: EnrichIcon },
  { key: 'write', label: 'Writing personalized copy', icon: WriteIcon },
  { key: 'build', label: 'Building your sequence', icon: BuildIcon },
]

export default function MantylLoader({ message, subMessage }) {
  const [activeStage, setActiveStage] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  // Detect stage from message text
  useEffect(() => {
    if (!message) return
    const m = message.toLowerCase()
    if (m.includes('searching') || m.includes('finding')) setActiveStage(0)
    else if (m.includes('enriching')) setActiveStage(1)
    else if (m.includes('writing') || m.includes('generating')) setActiveStage(2)
    else if (m.includes('building') || m.includes('finalizing')) setActiveStage(3)
  }, [message])

  // Elapsed time counter
  useEffect(() => {
    const interval = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const formatTime = (s) => {
    const mins = Math.floor(s / 60)
    const secs = s % 60
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }

  return (
    <div className="enterprise-loader">
      {/* Background ambient effect */}
      <div className="loader-ambient" />

      <div className="loader-card">
        {/* Processing animation */}
        <div className="loader-visual">
          <div className="processing-ring">
            <svg viewBox="0 0 100 100" className="ring-svg">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(107,138,219,0.08)" strokeWidth="2" />
              <circle cx="50" cy="50" r="42" fill="none" stroke="url(#loaderGrad)" strokeWidth="2.5"
                strokeDasharray="66 198" strokeLinecap="round" className="ring-active" />
              <defs>
                <linearGradient id="loaderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6B8ADB" />
                  <stop offset="50%" stopColor="#9B7FC7" />
                  <stop offset="100%" stopColor="#D4849A" />
                </linearGradient>
              </defs>
            </svg>
            {/* Center logo */}
            <div className="ring-center">
              <svg viewBox="0 0 80 72" fill="none" xmlns="http://www.w3.org/2000/svg" className="center-logo">
                <defs>
                  <linearGradient id="lcA" x1="0%" y1="100%" x2="50%" y2="0%">
                    <stop offset="0%" stopColor="#5A79CA" />
                    <stop offset="100%" stopColor="#8B6DB3" />
                  </linearGradient>
                  <linearGradient id="lcB" x1="50%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#C06E85" />
                    <stop offset="100%" stopColor="#D4856A" />
                  </linearGradient>
                </defs>
                <path d="M8 62 L30 8 L42 50 Z" fill="url(#lcA)" opacity="0.85" />
                <path d="M38 50 L50 8 L72 62 Z" fill="url(#lcB)" opacity="0.75" />
              </svg>
            </div>
          </div>
        </div>

        {/* Status text */}
        <div className="loader-status">
          <div className="loader-headline">{message || 'Processing...'}</div>
          {subMessage && <div className="loader-detail">{subMessage}</div>}
          <div className="loader-elapsed">{formatTime(elapsed)}</div>
        </div>

        {/* Progress bar */}
        <div className="loader-progress-track">
          <div className="loader-progress-fill" />
        </div>

        {/* Stage indicators */}
        <div className="loader-stages">
          {STAGES.map((stage, i) => {
            const Icon = stage.icon
            const isActive = i === activeStage
            const isComplete = i < activeStage
            return (
              <div key={stage.key} className={`loader-stage ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}`}>
                <div className="stage-icon-wrapper">
                  <Icon />
                  {isComplete && (
                    <svg className="stage-check" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </div>
                <span className="stage-label">{stage.label}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Stage Icons ─────────────────────────────────────────────────────
function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  )
}

function EnrichIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  )
}

function WriteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  )
}

function BuildIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  )
}
