import assert from "node:assert/strict";
import test from "node:test";
import { quotationSchemas } from "../src/validators/index.js";
import { calculateQuotationTotals } from "../src/services/quotationMath.js";
import { generateQuotationPdf } from "../src/services/quotationPdf.js";

test("quotation totals round each line consistently in paise", () => {
  const { lineItems, totals } = calculateQuotationTotals([
    {
      quantityMilli: 1500,
      unitRatePaise: 101,
      discountBps: 3333,
      taxRateBps: 1800,
    },
    {
      quantityMilli: 2500,
      unitRatePaise: 200,
      discountBps: 0,
      taxRateBps: 500,
    },
  ]);

  assert.deepEqual(lineItems.map(({ subtotalPaise, discountPaise, taxPaise, totalPaise }) => ({
    subtotalPaise,
    discountPaise,
    taxPaise,
    totalPaise,
  })), [
    { subtotalPaise: 152, discountPaise: 51, taxPaise: 18, totalPaise: 119 },
    { subtotalPaise: 500, discountPaise: 0, taxPaise: 25, totalPaise: 525 },
  ]);
  assert.deepEqual(totals, {
    subtotalPaise: 652,
    discountPaise: 51,
    taxPaise: 43,
    grandTotalPaise: 644,
  });
});

test("quotation totals reject invalid rates, quantities, and unsafe totals", () => {
  const base = {
    quantityMilli: 1000,
    unitRatePaise: 100,
    discountBps: 0,
    taxRateBps: 0,
  };

  assert.throws(() => calculateQuotationTotals([]), /At least one/);
  assert.throws(() => calculateQuotationTotals([{ ...base, quantityMilli: 0 }]), /Quantity/);
  assert.throws(() => calculateQuotationTotals([{ ...base, taxRateBps: 10_001 }]), /cannot exceed/);
  assert.throws(() => calculateQuotationTotals([{
    ...base,
    quantityMilli: 1_000_000_000,
    unitRatePaise: Number.MAX_SAFE_INTEGER,
  }]), /exceeds the supported quotation amount/);
});

test("quotation input validation rejects fractional money and ignores client totals", () => {
  const payload = {
    leadId: "0123456789abcdef01234567",
    lineItems: [{
      serviceName: "Printing",
      quantityMilli: 1000,
      unit: "each",
      unitRatePaise: 2500,
      discountBps: 0,
      taxRateBps: 0,
      subtotalPaise: 1,
    }],
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2026-01-31T23:59:59.999Z",
    currency: "INR",
  };

  const parsed = quotationSchemas.create.safeParse(payload);
  assert.equal(parsed.success, true);
  assert.equal("subtotalPaise" in parsed.data.lineItems[0], false);
  assert.equal(quotationSchemas.create.safeParse({
    ...payload,
    lineItems: [{ ...payload.lineItems[0], unitRatePaise: 1.5 }],
  }).success, false);
});

test("approved quotation PDF generation returns an A4 PDF buffer", async () => {
  const [lineItem] = calculateQuotationTotals([{
    serviceName: "Printing",
    description: "Brochure printing",
    quantityMilli: 1000,
    unit: "each",
    unitRatePaise: 2500,
    discountBps: 0,
    taxRateBps: 1800,
  }]).lineItems;
  const pdf = await generateQuotationPdf({
    quote: { quotationNumber: "QT-00001" },
    snapshot: {
      version: 1,
      status: "APPROVED",
      approvalStatus: "APPROVED",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2026-01-31T23:59:59.999Z"),
      clientDetails: { name: "Client", company: "Example Studio" },
      leadCode: "LD-001",
      lineItems: [lineItem],
      totals: { subtotalPaise: 2500, discountPaise: 0, taxPaise: 450, grandTotalPaise: 2950 },
      paymentTerms: "50% advance",
      termsAndConditions: "Quote valid until the stated date.",
      approvedByName: "Master Admin",
    },
    general: { agencyName: "MAAAD Agency", supportEmail: "hello@example.test", supportPhone: "0000000000" },
  });

  assert.match(pdf.subarray(0, 8).toString("ascii"), /^%PDF-/);
  assert.ok(pdf.length > 1000);
});
