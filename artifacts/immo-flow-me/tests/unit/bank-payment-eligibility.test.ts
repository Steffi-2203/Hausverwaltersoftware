import assert from "node:assert/strict";
import test from "node:test";
import { requireIncomingBankPayment } from "../../server/services/bankPaymentEligibility";

test("rejects outgoing CAMT debits before a receivable allocation can start", () => {
  assert.throws(
    () => requireIncomingBankPayment("-85.50"),
    /Nur positive Zahlungseingänge/,
  );
  assert.throws(
    () => requireIncomingBankPayment(0),
    /Nur positive Zahlungseingänge/,
  );
});

test("accepts a positive CAMT credit unchanged for payment allocation", () => {
  assert.equal(requireIncomingBankPayment("85.50"), 85.5);
});