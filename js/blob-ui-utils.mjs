export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

export function moderationLabel(status) {
  return ({
    pending: 'Awaiting safety check',
    approved: 'Safety checked',
    blocked: 'Not approved',
    review: 'Needs manual review',
    'not-required': 'Private'
  })[status] || 'Status unavailable';
}