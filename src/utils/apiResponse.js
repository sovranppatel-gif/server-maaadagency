/**
 * One response envelope for the whole API.
 *   success → { success: true, data, meta? }
 *   failure → { success: false, error: { message, details? } }
 */
export function sendSuccess(res, data, { status = 200, meta } = {}) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

export function sendCreated(res, data, meta) {
  return sendSuccess(res, data, { status: 201, meta });
}

export function sendNoContent(res) {
  return res.status(204).send();
}
