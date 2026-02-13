import { exportProspectsCSV } from '../utils/csvExport'

export default function ProspectList({ prospects, sequences, selectedIndex, onSelectProspect }) {
  if (!prospects || prospects.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h3>👥 Prospects</h3>
        </div>
        <div className="panel-body">
          <div className="empty-state">
            <div className="icon-large">🔍</div>
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
        <h3>👥 Prospects ({prospects.length})</h3>
        <div className="action-bar">
          <button className="btn-secondary" onClick={() => exportProspectsCSV(prospects, sequences)} title="Download CSV">
            📥 CSV
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
              <th>Email</th>
              <th>Phone</th>
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
                  <span className={`status-dot ${p.enrichmentStatus || 'enriched'}`} />
                </td>
                <td className="name-cell">{p.name}</td>
                <td>{p.title}</td>
                <td>{p.company}</td>
                <td>
                  {p.email ? (
                    <span style={{ fontSize: 12 }}>{p.email}</span>
                  ) : (
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>
                  )}
                </td>
                <td>
                  {p.phone ? (
                    <span style={{ fontSize: 12 }}>{p.phone}</span>
                  ) : (
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>
                  )}
                </td>
                <td>
                  {p.linkedinUrl ? (
                    <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                      View ↗
                    </a>
                  ) : (
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '10px 14px', fontSize: 11, color: '#94a3b8', borderTop: '1px solid #f1f5f9' }}>
          Click a prospect to view their personalized sequence →
        </div>
      </div>
    </div>
  )
}
