import { exportProspectsCSV } from '../utils/csvExport'

const CALENDLY_URL = 'https://mantyl.ai/book.html'

// ── Inline SVG Icons ────────────────────────────────────────────────
const IconUsers = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
)

const IconSearch = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)

const IconDownload = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
)

const IconLinkedIn = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
)

const IconLock = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
)

function getStatusLabel(status) {
  if (status === 'enriched') return 'Fully enriched'
  if (status === 'partial') return 'Partially enriched'
  return 'Minimal data'
}

/**
 * Generate a realistic-looking fake phone number from a prospect's name.
 * Deterministic — same name always produces the same "number".
 * Uses common US area codes so it looks authentic at a glance.
 */
function generateMaskedPhone(name) {
  let hash = 0
  for (let i = 0; i < (name || '').length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  const areaCodes = ['212', '415', '312', '617', '512', '720', '404', '206', '858', '949', '303', '971', '804', '916']
  const area = areaCodes[Math.abs(hash) % areaCodes.length]
  const mid = String(Math.abs((hash * 2654435761) | 0) % 900 + 100).slice(0, 3)
  const end = String(Math.abs((hash * 40503) | 0) % 9000 + 1000).slice(0, 4)
  return `(${area}) ${mid}-${end}`
}

export default function ProspectList({ prospects, sequences, selectedIndex, onSelectProspect }) {
  if (!prospects || prospects.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h3><span className="panel-icon panel-icon-blue"><IconUsers /></span> Prospects</h3>
        </div>
        <div className="panel-body">
          <div className="empty-state">
            <IconSearch />
            <h4>No prospects yet</h4>
            <p>Fill in your ICP parameters and click Generate to find matching prospects.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h3><span className="panel-icon panel-icon-blue"><IconUsers /></span> Prospects ({prospects.length})</h3>
        <div className="action-bar">
          <button className="btn-secondary" onClick={() => exportProspectsCSV(prospects, sequences)} title="Download CSV">
            <IconDownload /> CSV
          </button>
        </div>
      </div>
      <div className="panel-body">
        <table className="prospect-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th>Name</th>
              <th>Title</th>
              <th>Company</th>
              <th>Work Email</th>
              <th style={{ width: 28, textAlign: 'center' }} title="Email validation status from Apollo">✓</th>
              <th>Direct Dial</th>
              <th>LinkedIn</th>
            </tr>
          </thead>
          <tbody>
            {prospects.map((p, i) => (
              <tr
                key={i}
                onClick={() => onSelectProspect(i)}
                className={selectedIndex === i ? 'selected-row' : ''}
                style={{ cursor: 'pointer' }}
              >
                <td>
                  <span
                    className={`status-dot ${p.enrichmentStatus || 'minimal'}`}
                    title={getStatusLabel(p.enrichmentStatus)}
                  />
                </td>
                <td className="name-cell">{p.name}</td>
                <td>{p.title}</td>
                <td>{p.company}</td>
                <td>
                  {p.email ? (
                    <a href={`mailto:${p.email}`} onClick={e => e.stopPropagation()} style={{ fontSize: 12, color: 'var(--accent-blue)', textDecoration: 'none' }}>
                      {p.email}
                    </a>
                  ) : (
                    <span className="data-empty">—</span>
                  )}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {p.emailStatus ? (
                    <span
                      className={`email-status-badge ${p.emailStatus.replace('hunter_', '').replace('pattern_', '')}`}
                      title={`Email: ${p.emailStatus}${p.emailSource ? ` (${p.emailSource})` : ''}`}
                    >
                      {(p.emailStatus === 'verified' || p.emailStatus === 'hunter_verified') ? '✓'
                        : (p.emailStatus === 'guessed' || p.emailStatus === 'hunter_guessed') ? '~'
                        : p.emailStatus === 'pattern_guessed' ? '~'
                        : '?'}
                    </span>
                  ) : p.email ? (
                    <span className="email-status-badge" title="Status unknown" style={{ background: '#f1f5f9', color: '#94a3b8', border: '1px solid #e2e8f0' }}>?</span>
                  ) : null}
                </td>
                <td>
                  <a
                    href={CALENDLY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="phone-gated"
                    title="Book a consultation to unlock direct dial numbers"
                  >
                    <span className="phone-gated-number">{generateMaskedPhone(p.name)}</span>
                    <span className="phone-gated-overlay">
                      <IconLock />
                      <span>Unlock</span>
                    </span>
                  </a>
                </td>
                <td>
                  {p.linkedinUrl ? (
                    <a
                      href={p.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="linkedin-link"
                    >
                      <IconLinkedIn /> Profile
                    </a>
                  ) : (
                    <span className="data-empty">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="table-footer-hint">
          Click a prospect to view their personalized sequence
        </div>
      </div>
    </div>
  )
}
