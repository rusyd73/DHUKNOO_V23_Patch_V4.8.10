/**
 * Human-readable, stable order identifier for UI/voice/chat/merchant pickup.
 * The UUID remains the immutable technical primary key; this value is only
 * the public-facing identifier and is intentionally derived without a DB
 * migration so existing orders remain compatible.
 */
export function getOrderNumber(orderId: string): string {
  return `DHN-${String(orderId).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}
