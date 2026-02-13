export function exportProspectsCSV(prospects, sequences) {
  if (!prospects || prospects.length === 0) return;

  const headers = [
    'Name', 'Title', 'Company', 'Email', 'Email Status', 'Phone', 'Phone Type', 'LinkedIn URL',
  ];

  // If sequences exist, add sequence columns
  if (sequences && sequences.length > 0) {
    const firstProspectSeq = sequences.find(s => s.prospectIndex === 0);
    if (firstProspectSeq) {
      firstProspectSeq.touchpoints.forEach((tp, i) => {
        headers.push(`Step ${i + 1} - Day ${tp.day} (${tp.channel})`);
      });
    }
  }

  const rows = prospects.map((p, pIdx) => {
    const row = [
      p.name || '',
      p.title || '',
      p.company || '',
      p.email || '',
      p.emailStatus || '',
      p.phone || '',
      p.phoneType === 'work_direct' ? 'Direct' : p.phoneType === 'mobile' ? 'Mobile' : (p.phoneType || ''),
      p.linkedinUrl || '',
    ];

    if (sequences) {
      const prospectSeq = sequences.find(s => s.prospectIndex === pIdx);
      if (prospectSeq) {
        prospectSeq.touchpoints.forEach(tp => {
          let content = '';
          if (tp.subject) content += `Subject: ${tp.subject}\n`;
          content += tp.body || tp.message || tp.script || '';
          row.push(content);
        });
      }
    }

    return row;
  });

  const csvContent = [
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mantyl-prospects-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
