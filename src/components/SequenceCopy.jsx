import { useState } from 'react'

export default function SequenceCopy({ sequences, prospects, selectedProspectIndex, onSelectProspect, senderProfile }) {
  const [copiedId, setCopiedId] = useState(null)

  if (!sequences || sequences.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header"><h3>✉️ Sequence Copy</h3></div>
        <div className="panel-body">
          <div className="empty-state">
            <div className="icon-large">📝</div>
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
        <h3>✉️ Sequence for {currentProspect?.name || 'Prospect'}</h3>
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
          {copiedId === 'all' ? '✓ Copied' : '📋 Copy All'}
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
            return (
              <div key={i} className="touchpoint-card fade-in" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="touchpoint-header">
                  <div className="touchpoint-meta">
                    <span className="touchpoint-day">Day {tp.day}</span>
                    <span className={`touchpoint-stage ${tp.stage?.replace('_', '-')}`}>
                      {tp.stage === 'value_add' ? 'Value Add' : tp.stage?.charAt(0).toUpperCase() + tp.stage?.slice(1)}
                    </span>
                    <span className="touchpoint-channel">
                      {channelEmoji(tp.channel)} {tp.channel?.charAt(0).toUpperCase() + tp.channel?.slice(1)}
                    </span>
                  </div>
                  <button
                    className={`copy-btn ${copiedId === copyId ? 'copied' : ''}`}
                    onClick={() => handleCopy(getCopyText(tp), copyId)}
                  >
                    {copiedId === copyId ? '✓ Copied' : '📋 Copy'}
                  </button>
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
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Call Script</div>
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

function channelEmoji(channel) {
  return channel === 'email' ? '📧' : channel === 'linkedin' ? '💼' : '📞'
}
