import fs from "node:fs";
import PDFDocument from "pdfkit";

export async function generateQuotationPdf({ quote, snapshot, general, logoPath }) {
  const pdf = new PDFDocument({
    size: "A4",
    margin: 48,
    info: {
      Title: `${quote.quotationNumber} v${snapshot.version}`,
      Author: general.agencyName,
    },
  });
  const chunks = [];
  const buffer = new Promise((resolve, reject) => {
    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });

  if (logoPath && fs.existsSync(logoPath)) pdf.image(logoPath, 48, 42, { fit: [72, 48] });
  pdf.font("Helvetica-Bold").fontSize(19).fillColor("#171717").text(general.agencyName, 135, 44);
  pdf.font("Helvetica").fontSize(9).fillColor("#5b5b5b");
  pdf.text([general.supportEmail, general.supportPhone].filter(Boolean).join("  |  "), 135, 70);
  pdf.moveTo(48, 108).lineTo(547, 108).strokeColor("#dddddd").stroke();

  pdf.font("Helvetica-Bold").fontSize(20).fillColor("#171717").text("QUOTATION", 48, 126);
  pdf.font("Helvetica-Bold").fontSize(11).fillColor("#b91c1c").text(quote.quotationNumber, 380, 130, { width: 167, align: "right" });
  pdf.font("Helvetica").fontSize(9).fillColor("#5b5b5b");
  const dateOptions = { timeZone: "UTC" };
  pdf.text(`Version ${snapshot.version}  |  Status ${snapshot.status.replaceAll("_", " ")}`, 380, 148, { width: 167, align: "right" });
  pdf.text(`Valid: ${new Date(snapshot.validFrom).toLocaleDateString("en-IN", dateOptions)} – ${new Date(snapshot.validUntil).toLocaleDateString("en-IN", dateOptions)}`, 380, 162, { width: 167, align: "right" });

  pdf.font("Helvetica-Bold").fontSize(10).fillColor("#171717").text("BILL TO", 48, 188);
  pdf.font("Helvetica-Bold").fontSize(11).text(snapshot.clientDetails.company || snapshot.clientDetails.name, 48, 205, { width: 280 });
  pdf.font("Helvetica").fontSize(9).fillColor("#5b5b5b");
  const clientLine = [
    snapshot.clientDetails.name !== snapshot.clientDetails.company ? snapshot.clientDetails.name : "",
    snapshot.clientDetails.phone,
    snapshot.clientDetails.email,
  ].filter(Boolean).join("\n");
  if (clientLine) pdf.text(clientLine, 48, 222, { width: 280 });
  if (snapshot.leadCode) pdf.text(`Lead ${snapshot.leadCode}`, 380, 205, { width: 167, align: "right" });

  let y = 266;
  const columns = [
    { title: "SERVICE / DESCRIPTION", x: 48, width: 186, align: "left" },
    { title: "QTY", x: 237, width: 42, align: "right" },
    { title: "RATE", x: 284, width: 64, align: "right" },
    { title: "DISC.", x: 353, width: 49, align: "right" },
    { title: "TAX", x: 407, width: 51, align: "right" },
    { title: "AMOUNT", x: 463, width: 84, align: "right" },
  ];
  const drawTableHeader = () => {
    pdf.rect(48, y, 499, 22).fill("#f3f4f6");
    pdf.font("Helvetica-Bold").fontSize(7).fillColor("#404040");
    for (const column of columns) {
      pdf.text(column.title, column.x + 2, y + 7, {
        width: column.width - 4,
        align: column.align,
        lineBreak: false,
      });
    }
    y += 28;
  };
  drawTableHeader();

  const money = (paise) => {
    const rupees = Math.floor(paise / 100);
    const cents = String(paise % 100).padStart(2, "0");
    return `${new Intl.NumberFormat("en-IN").format(rupees)}.${cents}`;
  };
  for (const item of snapshot.lineItems) {
    const detail = [item.serviceName, item.description].filter(Boolean).join("\n");
    const textHeight = pdf.heightOfString(detail, { width: columns[0].width - 8, font: "Helvetica", fontSize: 8 });
    const rowHeight = Math.max(28, textHeight + 12);
    if (y + rowHeight > 740) {
      pdf.addPage();
      y = 48;
      drawTableHeader();
    }
    pdf.font("Helvetica").fontSize(8).fillColor("#333333");
    pdf.text(detail, columns[0].x + 4, y + 5, { width: columns[0].width - 8 });
    pdf.text(`${(item.quantityMilli / 1000).toFixed(3).replace(/\.?0+$/, "")} ${item.unit}`, columns[1].x, y + 7, { width: columns[1].width, align: "right" });
    pdf.text(money(item.unitRatePaise), columns[2].x, y + 7, { width: columns[2].width, align: "right" });
    pdf.text(money(item.discountPaise), columns[3].x, y + 7, { width: columns[3].width, align: "right" });
    pdf.text(money(item.taxPaise), columns[4].x, y + 7, { width: columns[4].width, align: "right" });
    pdf.font("Helvetica-Bold").text(money(item.totalPaise), columns[5].x, y + 7, { width: columns[5].width, align: "right" });
    y += rowHeight;
    pdf.moveTo(48, y).lineTo(547, y).strokeColor("#e5e5e5").stroke();
  }

  y += 16;
  const totalLine = (label, amount, bold = false) => {
    if (y > 740) {
      pdf.addPage();
      y = 48;
    }
    pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).fillColor("#262626");
    pdf.text(label, 335, y, { width: 115 });
    pdf.text(`INR ${money(amount)}`, 450, y, { width: 97, align: "right" });
    y += bold ? 22 : 17;
  };
  totalLine("Subtotal", snapshot.totals.subtotalPaise);
  totalLine("Discount", snapshot.totals.discountPaise);
  totalLine("Tax", snapshot.totals.taxPaise);
  totalLine("Grand total", snapshot.totals.grandTotalPaise, true);

  const printBlock = (title, text) => {
    if (!text) return;
    if (y > 720) {
      pdf.addPage();
      y = 48;
    }
    y += 14;
    pdf.font("Helvetica-Bold").fontSize(9).fillColor("#171717").text(title, 48, y);
    y += 14;
    pdf.font("Helvetica").fontSize(8).fillColor("#4b4b4b").text(text, 48, y, { width: 499, lineGap: 2 });
    y = pdf.y + 2;
  };
  printBlock("Payment terms", snapshot.paymentTerms);
  printBlock("Terms and conditions", snapshot.termsAndConditions);

  if (y > 730) {
    pdf.addPage();
    y = 48;
  }
  y += 32;
  pdf.moveTo(360, y).lineTo(547, y).strokeColor("#777777").stroke();
  pdf.font("Helvetica-Bold").fontSize(9).fillColor("#262626").text(snapshot.approvedByName || "Authorized signatory", 360, y + 6, { width: 187, align: "center" });
  pdf.font("Helvetica").fontSize(8).fillColor("#666666").text(`For ${general.agencyName}`, 360, y + 20, { width: 187, align: "center" });
  pdf.end();

  return buffer;
}
