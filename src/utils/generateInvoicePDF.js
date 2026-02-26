import { jsPDF } from 'jspdf';

/**
 * Generate a professional PDF invoice.
 * @param {Object} invoice - Invoice data from Firestore
 * @param {Object} restaurantInfo - Restaurant billing info from RMS
 * @param {'restaurant'|'vendor'} type - Invoice type
 * @returns {string} Base64-encoded PDF data URI
 */
export function generateInvoicePDF(invoice, restaurantInfo = {}, type = 'restaurant') {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    // Colors
    const primary = [22, 78, 99];      // Dark teal
    const accent = [14, 165, 233];     // Sky blue
    const darkText = [30, 30, 30];
    const mutedText = [120, 120, 120];
    const lineColor = [220, 220, 220];

    // ─── HEADER ───────────────────────────────────
    doc.setFillColor(...primary);
    doc.rect(0, 0, pageWidth, 40, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(type === 'restaurant' ? 'CUSTOMER INVOICE' : 'VENDOR INVOICE', margin, 18);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(invoice.invoiceNumber || 'N/A', margin, 28);

    // Status badge
    const isPaid = invoice.paymentStatus === 'PAID';
    const statusText = isPaid ? 'PAID' : 'PENDING';
    const statusWidth = doc.getTextWidth(statusText) + 12;
    const statusX = pageWidth - margin - statusWidth;
    doc.setFillColor(isPaid ? 74 : 245, isPaid ? 222 : 158, isPaid ? 128 : 11);
    doc.roundedRect(statusX, 10, statusWidth, 10, 2, 2, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(isPaid ? 0 : 30, isPaid ? 60 : 30, isPaid ? 30 : 0);
    doc.text(statusText, statusX + 6, 17);

    y = 52;

    // ─── INVOICE META ─────────────────────────────
    const formatDate = (val) => {
        if (!val) return 'N/A';
        const d = val.toDate ? val.toDate() : new Date(val);
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    };

    doc.setTextColor(...mutedText);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    const metaLeft = [
        ['Invoice Date', formatDate(invoice.invoiceDate)],
        ['Due Date', formatDate(invoice.dueDate)],
        ['Order ID', invoice.orderGroupId || invoice.orderId?.slice(-8)?.toUpperCase() || 'N/A'],
    ];

    metaLeft.forEach(([label, value], i) => {
        const metaY = y + i * 7;
        doc.setTextColor(...mutedText);
        doc.text(label + ':', margin, metaY);
        doc.setTextColor(...darkText);
        doc.setFont('helvetica', 'bold');
        doc.text(value, margin + 32, metaY);
        doc.setFont('helvetica', 'normal');
    });

    y += 30;

    // ─── BILL TO / FROM ───────────────────────────
    const colWidth = contentWidth / 2;

    // Bill To
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(margin, y, colWidth - 5, 45, 3, 3, 'F');

    doc.setFontSize(8);
    doc.setTextColor(...accent);
    doc.setFont('helvetica', 'bold');
    doc.text('BILL TO', margin + 6, y + 8);

    doc.setFontSize(10);
    doc.setTextColor(...darkText);
    doc.text(restaurantInfo.businessName || invoice.restaurantId || 'Restaurant', margin + 6, y + 16);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...mutedText);
    let billY = y + 22;
    if (restaurantInfo.legalName) {
        doc.text(`Legal: ${restaurantInfo.legalName}`, margin + 6, billY);
        billY += 5;
    }
    if (restaurantInfo.hstNumber) {
        doc.text(`HST#: ${restaurantInfo.hstNumber}`, margin + 6, billY);
        billY += 5;
    }
    if (restaurantInfo.phone) {
        doc.text(`Phone: ${restaurantInfo.phone}`, margin + 6, billY);
        billY += 5;
    }
    if (restaurantInfo.email) {
        doc.text(`Email: ${restaurantInfo.email}`, margin + 6, billY);
    }

    // From
    const fromX = margin + colWidth + 5;
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(fromX, y, colWidth - 5, 45, 3, 3, 'F');

    doc.setFontSize(8);
    doc.setTextColor(...accent);
    doc.setFont('helvetica', 'bold');
    doc.text('FROM', fromX + 6, y + 8);

    doc.setFontSize(10);
    doc.setTextColor(...darkText);
    doc.text(invoice.vendorName || 'Vendor', fromX + 6, y + 16);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...mutedText);
    doc.text('RestIQ Vendor Platform', fromX + 6, y + 22);

    y += 55;

    // ─── ITEMS TABLE ──────────────────────────────
    const cols = [
        { label: 'Item', width: 60, align: 'left' },
        { label: 'Unit', width: 22, align: 'left' },
        { label: 'Qty', width: 15, align: 'center' },
        { label: 'Price', width: 25, align: 'right' },
        { label: 'Tax', width: 22, align: 'right' },
        { label: 'Total', width: 26, align: 'right' },
    ];

    // Table header
    doc.setFillColor(...primary);
    doc.rect(margin, y, contentWidth, 8, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');

    let colX = margin + 3;
    cols.forEach(col => {
        const textX = col.align === 'right' ? colX + col.width - 3 : col.align === 'center' ? colX + col.width / 2 : colX;
        doc.text(col.label, textX, y + 5.5, { align: col.align === 'center' ? 'center' : col.align === 'right' ? 'right' : 'left' });
        colX += col.width;
    });

    y += 8;

    // Table rows
    const items = invoice.items || [];
    items.forEach((item, idx) => {
        const rowY = y + idx * 8;

        // Alternating row background
        if (idx % 2 === 0) {
            doc.setFillColor(250, 250, 252);
            doc.rect(margin, rowY, contentWidth, 8, 'F');
        }

        doc.setTextColor(...darkText);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');

        const price = type === 'restaurant'
            ? Number(item.price || item.vendorPrice || 0)
            : Number(item.vendorPrice || item.price || 0);
        const lineTotal = type === 'restaurant'
            ? Number(item.lineTotal || 0)
            : Number(item.lineTotalVendor || item.lineTotal || 0);
        const tax = Number(item.lineTax || 0);

        const rowData = [
            item.itemName || 'Unknown',
            (item.unit || 'unit'),
            String(item.qty || 1),
            `$${price.toFixed(2)}`,
            item.isTaxable ? `$${tax.toFixed(2)}` : '—',
            `$${lineTotal.toFixed(2)}`,
        ];

        colX = margin + 3;
        rowData.forEach((text, ci) => {
            const col = cols[ci];
            const textX = col.align === 'right' ? colX + col.width - 3 : col.align === 'center' ? colX + col.width / 2 : colX;
            // Truncate long names
            const displayText = ci === 0 && text.length > 28 ? text.substring(0, 26) + '...' : text;
            doc.text(displayText, textX, rowY + 5.5, { align: col.align === 'center' ? 'center' : col.align === 'right' ? 'right' : 'left' });
            colX += col.width;
        });
    });

    y += items.length * 8 + 5;

    // Bottom line
    doc.setDrawColor(...lineColor);
    doc.setLineWidth(0.3);
    doc.line(margin, y, margin + contentWidth, y);
    y += 8;

    // ─── SUMMARY ──────────────────────────────────
    const summaryX = margin + contentWidth - 80;
    const valX = margin + contentWidth;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    // Subtotal
    doc.setTextColor(...mutedText);
    doc.text('Subtotal', summaryX, y);
    doc.setTextColor(...darkText);
    const subtotal = type === 'restaurant'
        ? Number(invoice.subtotal || 0)
        : Number(invoice.subtotalVendorAmount || invoice.grossVendorAmount || 0);
    doc.text(`$${subtotal.toFixed(2)}`, valX, y, { align: 'right' });
    y += 7;

    // Commission (vendor only)
    if (type === 'vendor' && invoice.commissionModel === 'VENDOR_FLAT_PERCENT') {
        doc.setTextColor(...mutedText);
        doc.text(`Commission (${invoice.commissionPercent || 10}%)`, summaryX, y);
        doc.setTextColor(220, 50, 50);
        doc.text(`- $${Number(invoice.commissionAmount || 0).toFixed(2)}`, valX, y, { align: 'right' });
        y += 7;

        doc.setTextColor(...mutedText);
        doc.text('Net Payable', summaryX, y);
        doc.setTextColor(...darkText);
        doc.text(`$${Number(invoice.netVendorPayable || 0).toFixed(2)}`, valX, y, { align: 'right' });
        y += 7;
    }

    // Tax
    doc.setTextColor(...mutedText);
    doc.text('Tax', summaryX, y);
    doc.setTextColor(245, 158, 11);
    const taxAmount = type === 'restaurant'
        ? Number(invoice.totalTax || 0)
        : Number(invoice.totalTaxAmount || 0);
    doc.text(`+ $${taxAmount.toFixed(2)}`, valX, y, { align: 'right' });
    y += 4;

    // Divider
    doc.setDrawColor(...lineColor);
    doc.line(summaryX, y, valX, y);
    y += 7;

    // Grand Total
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...primary);
    doc.text(type === 'restaurant' ? 'Grand Total' : 'Total Payout', summaryX, y);

    const total = type === 'restaurant'
        ? Number(invoice.grandTotal || 0)
        : (invoice.commissionModel === 'VENDOR_FLAT_PERCENT'
            ? Number((invoice.netVendorPayable || 0) + taxAmount)
            : Number(invoice.totalVendorAmount || 0));
    doc.text(`$${total.toFixed(2)}`, valX, y, { align: 'right' });

    y += 15;

    // ─── FOOTER ───────────────────────────────────
    doc.setDrawColor(...lineColor);
    doc.line(margin, y, margin + contentWidth, y);
    y += 8;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...mutedText);
    doc.text('Thank you for your business!', pageWidth / 2, y, { align: 'center' });
    doc.text('Generated by RestIQ Vendor Management Platform', pageWidth / 2, y + 5, { align: 'center' });

    // Return as base64
    return doc.output('datauristring');
}
