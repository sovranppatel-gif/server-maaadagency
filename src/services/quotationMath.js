const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const RATE_DENOMINATOR = 10_000n;
const QUANTITY_DENOMINATOR = 1_000n;

function assertSafeInteger(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer of at least ${minimum}`);
  }
}

function roundHalfUp(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

function safeNumber(value, name) {
  if (value > MAX_SAFE_BIGINT) throw new RangeError(`${name} exceeds the supported quotation amount`);
  return Number(value);
}

export function calculateQuotationTotals(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new RangeError("At least one quotation line item is required");
  }

  let subtotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;
  let grandTotal = 0n;

  const lineItems = items.map((item) => {
    assertSafeInteger(item.quantityMilli, "Quantity", 1);
    assertSafeInteger(item.unitRatePaise, "Unit rate");
    assertSafeInteger(item.discountBps, "Discount rate");
    assertSafeInteger(item.taxRateBps, "Tax rate");
    if (item.discountBps > 10_000 || item.taxRateBps > 10_000) {
      throw new RangeError("Discount and tax rates cannot exceed 100%");
    }

    const gross = roundHalfUp(
      BigInt(item.quantityMilli) * BigInt(item.unitRatePaise),
      QUANTITY_DENOMINATOR
    );
    const discount = roundHalfUp(gross * BigInt(item.discountBps), RATE_DENOMINATOR);
    const taxable = gross - discount;
    const tax = roundHalfUp(taxable * BigInt(item.taxRateBps), RATE_DENOMINATOR);
    const total = taxable + tax;

    subtotal += gross;
    discountTotal += discount;
    taxTotal += tax;
    grandTotal += total;

    return {
      ...item,
      subtotalPaise: safeNumber(gross, "Line subtotal"),
      discountPaise: safeNumber(discount, "Line discount"),
      taxPaise: safeNumber(tax, "Line tax"),
      totalPaise: safeNumber(total, "Line total"),
    };
  });

  return {
    lineItems,
    totals: {
      subtotalPaise: safeNumber(subtotal, "Subtotal"),
      discountPaise: safeNumber(discountTotal, "Discount total"),
      taxPaise: safeNumber(taxTotal, "Tax total"),
      grandTotalPaise: safeNumber(grandTotal, "Grand total"),
    },
  };
}
