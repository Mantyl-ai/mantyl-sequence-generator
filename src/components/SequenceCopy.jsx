import { useState } from 'react'

// ── Inline SVG Icons ────────────────────────────────────────────────
const IconMail = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
)

const IconLinkedIn = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
)

const IconPhone = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
)

const IconCopy = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
)

const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

const IconSequence = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="17" y1="10" x2="3" y2="10"/>
    <line x1="21" y1="6" x2="3" y2="6"/>
    <line x1="21" y1="14" x2="3" y2="14"/>
    <line x1="17" y1="18" x2="3" y2="18"/>
  </svg>
)

const IconPen = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
  </svg>
)

function channelIcon(channel) {
  if (channel === 'email') return <IconMail />
  if (channel === 'linkedin') return <IconLinkedIn />
  if (channel === 'calling') return <IconPhone />
  return null
}

export default function SequenceCopy({ sequences, prospects, selectedProspectIndex, onSelectProspect, senderProfile }) {
  const [copiedId, setCopiedId] = useState(null)

  if (!sequences || sequences.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header"><h3><span className="panel-icon panel-icon-lavender"><IconSequence /></span> Sequence Copy</h3></div>
        <div className="panel-body">
          <div className="empty-state">
            <IconPen />
            <h4>No sequences yet</h4>
            <p>Sequences will appear here once prospects are found and copy is generated.</p>
          </div>
        </div>
      </div>
    )
  }

  const currentSequence = sequences.find(s => s.prospectIndex === selectedProspectIndex)
  const currentProspect = prospects?.[selectedProspectIndex]

  const handleCopy = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const getCopyText = (tp) => {
    if (tp.channel === 'email') return `Subject: ${tp.subject}\n\n${tp.body}`
    if (tp.channel === 'linkedin') return tp.message || ''
    if (tp.channel === 'calling') return tp.script || ''
    return ''
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h3><span className="panel-icon panel-icon-lavender"><IconSequence /></span> Sequence for {currentProspect?.name || 'Prospect'}</h3>
        <button
          className="btn-secondary"
          onClick={() => {
            const allText = currentSequence?.touchpoints
              ?.map((tp, i) => {
                const header = `--- Step ${tp.step || i + 1} | Day ${tp.day} | ${tp.channel} | ${tp.stage} ---`
                return `${header}\n${getCopyText(tp)}`
              }).join('\n\n')
            if (allText) handleCopy(allText, 'all')
          }}
        >
          {copiedId === 'all' ? <><IconCheck /> Copied</> : <><IconCopy /> Copy All</>}
        </button>
      </div>

      <div className="prospect-selector">
        <label>Prospect:</label>
        <select value={selectedProspectIndex} onChange={e => onSelectProspect(parseInt(e.target.value))}>
          {prospects?.map((p, i) => (
            <option key={i} value={i}>{p.name} — {p.title} at {p.company}</option>
          ))}
        </select>
      </div>

      {/* Sender info banner */}
      {senderProfile?.senderName && (
        <div className="sender-banner">
          <span style={{ fontWeight: 500 }}>Sending as:</span> {senderProfile.senderName}, {senderProfile.senderTitle} at {senderProfile.senderCompany}
          {senderProfile.emailSendType === 'automated' && <span className="auto-badge">Automated</span>}
          {senderProfile.emailSendType === 'manual' && <span className="manual-badge">Manual</span>}
        </div>
      )}

      <div className="panel-body">
        <div className="sequence-timeline">
          {currentSequence?.touchpoints?.map((tp, i) => {
            const copyId = `${selectedProspectIndex}-${i}`
            const isFailed = tp.generationFailed
            return (
              <div key={i} className={`touchpoint-card fade-in ${isFailed ? 'touchpoint-failed' : ''}`} style={{ animationDelay: `${i * 50}ms` }}>
                <div className="touchpoint-header">
                  <div className="touchpoint-meta">
                    <span className="touchpoint-day">Day {tp.day}</span>
                    <span className={`touchpoint-stage ${tp.stage?.replace('_', '-')}`}>
                      {tp.stage === 'value_add' ? 'Value Add' : tp.stage?.charAt(0).toUpperCase() + tp.stage?.slice(1)}
                    </span>
                    <span className="touchpoint-channel">
                      {channelIcon(tp.channel)} {tp.channel?.charAt(0).toUpperCase() + tp.channel?.slice(1)}
                    </span>
                  </div>
                  {!isFailed && (
                    <button
                      className={`copy-btn ${copiedId === copyId ? 'copied' : ''}`}
                      onClick={() => handleCopy(getCopyText(tp), copyId)}
                    >
                      {copiedId === copyId ? <><IconCheck /> Copied</> : <><IconCopy /> Copy</>}
                    </button>
                  )}
                </div>

                <div className="touchpoint-body">
                  {tp.channel === 'email' && (
                    <>
                      <div className="touchpoint-subject">
                        <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 11 }}>Subject: </span>
                        {tp.subject}
                      </div>
                      <div className="touchpoint-content">{tp.body}</div>
                    </>
                  )}
                  {tp.channel === 'linkedin' && (
                    <div className="touchpoint-content">{tp.message}</div>
                  )}
                  {tp.channel === 'calling' && (
                    <>
                      <div className="touchpoint-label">Call Script</div>
                      <div className="touchpoint-content">{tp.script}</div>
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {!currentSequence && (
            <div className="empty-state">
              <p>Select a prospect to view their sequence.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
