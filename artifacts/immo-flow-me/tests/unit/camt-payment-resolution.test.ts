import { describe, it } from "node:test";
import { expect } from "../helpers/expect";
import { resolveCamtPayment } from "../../server/services/camtPaymentResolutionService";

const invoiceA = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "tenant-a",
  unitId: "unit-a",
  total: 125,
  paid: 0,
};
const invoiceB = {
  id: "22222222-2222-2222-2222-222222222222",
  tenantId: "tenant-b",
  unitId: "unit-b",
  total: 125,
  paid: 0,
};

describe("CAMT payment resolution", () => {
  it("assigns one exact outstanding balance", () => {
    const result = resolveCamtPayment([invoiceA], 125, "");
    expect(result.status).toBe("matched");
    if (result.status === "matched") expect(result.candidate.id).toBe(invoiceA.id);
  });

  it("leaves identical amount candidates visibly ambiguous", () => {
    const result = resolveCamtPayment([invoiceA, invoiceB], 125, "");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") expect(result.candidates.length).toBe(2);
  });

  it("uses a unique invoice reference for a partial payment", () => {
    const result = resolveCamtPayment([invoiceA, invoiceB], 25, "Miete 11111111");
    expect(result.status).toBe("matched");
    if (result.status === "matched") expect(result.candidate.id).toBe(invoiceA.id);
  });

  it("does not silently match an unknown amount", () => {
    const result = resolveCamtPayment([invoiceA], 99, "");
    expect(result.status).toBe("unmatched");
  });
});