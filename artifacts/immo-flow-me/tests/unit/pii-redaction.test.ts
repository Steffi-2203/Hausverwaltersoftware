import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import { redactPII } from "../../server/lib/logger";

describe("redactPII", () => {
  describe("IBAN patterns", () => {
    it("masks Austrian IBAN", () => {
      const result = redactPII("IBAN: AT483200000012345864");
      expect(result).toBe("IBAN: AT48************5864");
      expect(result).not.toContain("00000012345");
    });

    it("masks German IBAN", () => {
      const result = redactPII("DE89370400440532013000");
      expect(result).toBe("DE89**************3000");
    });

    it("masks IBAN with spaces", () => {
      const result = redactPII("AT48 3200 0000 1234 5864");
      expect(result).not.toContain("0000 1234");
    });
  });

  describe("Email addresses", () => {
    it("masks email local part", () => {
      const result = redactPII("Contact: john.doe@example.com");
      expect(result).toBe("Contact: j***@example.com");
    });

    it("masks email in sentence", () => {
      const result = redactPII("User admin@company.at logged in");
      expect(result).toBe("User a***@company.at logged in");
    });
  });

  describe("Austrian phone numbers", () => {
    it("masks +43 phone number", () => {
      const result = redactPII("Tel: +43 1 234 5678");
      expect(result).toContain("+43***");
      expect(result).toContain("78");
      expect(result).not.toContain("234 56");
    });

    it("masks +43 without spaces", () => {
      const result = redactPII("Phone: +4312345678");
      expect(result).toBe("Phone: +43***78");
    });
  });

  describe("German phone numbers", () => {
    it("masks +49 phone number", () => {
      const result = redactPII("Tel: +49 30 1234567");
      expect(result).toContain("+49***");
      expect(result).not.toContain("1234");
    });
  });

  describe("Credit card numbers", () => {
    it("masks 16-digit card number", () => {
      const result = redactPII("Card: 4111111111111111");
      expect(result).toBe("Card: ****1111");
    });

    it("masks card with spaces", () => {
      const result = redactPII("Card: 4111 1111 1111 1111");
      expect(result).toBe("Card: ****1111");
    });

    it("masks card with dashes", () => {
      const result = redactPII("Card: 4111-1111-1111-1111");
      expect(result).toBe("Card: ****1111");
    });
  });

  describe("BIC/SWIFT codes", () => {
    it("masks 8-char BIC", () => {
      const result = redactPII("BIC: RLNWATWW");
      expect(result).toBe("BIC: RLN****");
    });

    it("masks 11-char BIC", () => {
      const result = redactPII("BIC: COBADEFFXXX");
      expect(result).toBe("BIC: COB****");
    });
  });

  describe("mixed PII in single string", () => {
    it("masks multiple PII types", () => {
      const result = redactPII(
        "User john@example.com sent 500 EUR to AT483200000012345864 via +4312345678"
      );
      expect(result).toContain("j***@example.com");
      expect(result).not.toContain("john@");
      expect(result).toContain("AT48");
      expect(result).toContain("5864");
      expect(result).not.toContain("00000012345");
      expect(result).toContain("+43***");
    });
  });

  describe("no false positives", () => {
    it("does not redact normal text", () => {
      const input = "This is a normal log message with no PII";
      expect(redactPII(input)).toBe(input);
    });

    it("does not redact short numbers", () => {
      const input = "Invoice #12345 for 299.99 EUR";
      expect(redactPII(input)).toBe(input);
    });
  });
});
