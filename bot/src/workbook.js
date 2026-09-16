// Full workbook export requires a verified account and a paid subscription.
// Trial dates, query params and client-side premium flags are never authority.
export const canDownloadWorkbook = (user, now = Date.now()) =>
  Number(user?.premium_until || 0) > now;

export function createWorkbookApi({ auth, db, content, json }) {
  return (req, res, url) => {
    if (req.method !== 'GET' || url.pathname !== '/workbook/content') return false;
    const id = auth.authenticate(req);
    if (!id) { json(res, 401, { ok: false, error: 'login_required' }); return true; }
    if (!canDownloadWorkbook(db.users[id])) {
      json(res, 403, { ok: false, error: 'subscription_required' }); return true;
    }
    const c = content();
    json(res, 200, { ok: true, content: { meta: c.meta, workbook: c.workbook, blocks: c.blocks } });
    return true;
  };
}
