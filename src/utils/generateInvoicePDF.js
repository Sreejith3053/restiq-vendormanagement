import { jsPDF } from 'jspdf';
import restiqLogo from '../assets/restiq-logo-white.png';

// Helper: load an image as base64 for jsPDF
function loadImageAsBase64(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

/**
 * Generate a premium PDF invoice / payout statement.
 * @param {Object} invoice - Invoice data from Firestore
 * @param {Object} restaurantInfo - Restaurant billing info from RMS
 * @param {'restaurant'|'vendor'} type - Invoice type
 * @returns {Promise<string>} Base64-encoded PDF data URI
 */
export async function generateInvoicePDF(invoice, restaurantInfo = {}, type = 'restaurant', vendorInfo = {}) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    const rightEdge = margin + contentWidth;
    let y = 0;

    // ─── COLOR PALETTE ───────────────────────────
    const navy = [15, 22, 32];           // #0F1620
    const skyBlue = [14, 165, 233];      // #0EA5E9
    const darkText = [25, 25, 30];
    const mediumText = [80, 85, 95];
    const mutedText = [140, 145, 155];
    const lineColor = [215, 218, 225];
    const lightBg = [245, 247, 250];     // #F5F7FA
    const white = [255, 255, 255];

    // No accent bar — clean white header with logo and title

    y = 14;

    // ─── HEADER: Logo + Document Title ───────────
    // Logo
    try {
        const logoBase64 = await loadImageAsBase64(restiqLogo);
        if (logoBase64) {
            // Render oversized to crop the whitespace padding in the source image
            const logoSize = 70;
            const logoOffsetX = margin - 14;
            const logoOffsetY = y - 18;
            doc.addImage(logoBase64, 'PNG', logoOffsetX, logoOffsetY, logoSize, logoSize);
            // White clip rects to hide overflow
            doc.setFillColor(255, 255, 255);
            doc.rect(0, 0, Math.max(0, logoOffsetX), 50, 'F');   // left edge
            doc.rect(0, y + 24, margin + 60, 30, 'F');           // bottom overflow
        }
    } catch (e) { /* skip logo */ }

    // Document title and invoice number (right side)
    doc.setTextColor(...navy);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    const title = type === 'restaurant' ? 'CUSTOMER INVOICE' : 'VENDOR PAYOUT STATEMENT';
    doc.text(title, rightEdge, y + 4, { align: 'right' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...mediumText);
    doc.text(invoice.invoiceNumber || 'N/A', rightEdge, y + 11, { align: 'right' });

    // Status badge
    const isPaid = invoice.paymentStatus === 'PAID';
    const statusText = isPaid ? 'PAID' : 'PENDING';
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const badgeW = doc.getTextWidth(statusText) + 10;
    const badgeX = rightEdge - badgeW;
    const badgeY = y + 15;
    if (isPaid) {
        doc.setFillColor(220, 252, 231);  // light green
        doc.roundedRect(badgeX, badgeY, badgeW, 7, 1.5, 1.5, 'F');
        doc.setTextColor(22, 101, 52);    // dark green text
    } else {
        doc.setFillColor(254, 243, 199);  // light amber
        doc.roundedRect(badgeX, badgeY, badgeW, 7, 1.5, 1.5, 'F');
        doc.setTextColor(146, 64, 14);    // dark amber text
    }
    doc.text(statusText, badgeX + 5, badgeY + 5);

    y = 46;

    // ─── METADATA BAND ───────────────────────────
    doc.setFillColor(...lightBg);
    doc.rect(0, y, pageWidth, 14, 'F');

    // Thin top/bottom border lines
    doc.setDrawColor(...lineColor);
    doc.setLineWidth(0.3);
    doc.line(0, y, pageWidth, y);
    doc.line(0, y + 14, pageWidth, y + 14);

    const metaItems = [
        [type === 'restaurant' ? 'Invoice Date' : 'Statement Date', formatDate(invoice.invoiceDate)],
        [type === 'restaurant' ? 'Due Date' : 'Payout Date', formatDate(invoice.dueDate)],
        ['Order ID', invoice.orderGroupId || invoice.orderId?.slice(-8)?.toUpperCase() || 'N/A'],
    ];

    const metaColWidth = contentWidth / 3;
    metaItems.forEach(([label, value], i) => {
        const mx = margin + i * metaColWidth;
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...mutedText);
        doc.text(label, mx, y + 5.5);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...darkText);
        doc.text(value, mx, y + 11);
    });

    y = 68;

    // ─── BILL TO / PAY TO + FROM ─────────────────
    const colWidth = contentWidth / 2;

    // Left section: TO
    // Accent left border
    doc.setDrawColor(...skyBlue);
    doc.setLineWidth(0.8);
    doc.line(margin, y, margin, y + 30);

    doc.setFontSize(7);
    doc.setTextColor(...skyBlue);
    doc.setFont('helvetica', 'bold');
    const toLabel = type === 'restaurant' ? 'BILL TO' : 'PAY TO';
    doc.text(toLabel, margin + 4, y + 4);

    doc.setFontSize(11);
    doc.setTextColor(...darkText);
    doc.setFont('helvetica', 'bold');

    if (type === 'restaurant') {
        doc.text(restaurantInfo.businessName || invoice.restaurantId || 'Restaurant', margin + 4, y + 11);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...mediumText);
        let detY = y + 16;
        if (restaurantInfo.legalName) {
            doc.text(`Legal: ${restaurantInfo.legalName}`, margin + 4, detY);
            detY += 4.5;
        }
        if (restaurantInfo.hstNumber) {
            doc.text(`HST#: ${restaurantInfo.hstNumber}`, margin + 4, detY);
            detY += 4.5;
        }
        if (restaurantInfo.phone) {
            doc.text(`Phone: ${restaurantInfo.phone}`, margin + 4, detY);
            detY += 4.5;
        }
        if (restaurantInfo.email) {
            doc.text(`Email: ${restaurantInfo.email}`, margin + 4, detY);
        }
    } else {
        const vName = vendorInfo.name || vendorInfo.businessName || invoice.vendorName || 'Vendor';
        doc.text(vName, margin + 4, y + 11);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...mediumText);
        let detY = y + 16;
        if (vendorInfo.address || vendorInfo.streetAddress) {
            doc.text(vendorInfo.address || vendorInfo.streetAddress, margin + 4, detY);
            detY += 4.5;
        }
        if (vendorInfo.city || vendorInfo.province) {
            const cityProv = [vendorInfo.city, vendorInfo.province, vendorInfo.postalCode].filter(Boolean).join(', ');
            if (cityProv) {
                doc.text(cityProv, margin + 4, detY);
                detY += 4.5;
            }
        }
        if (vendorInfo.phone) {
            doc.text(`Ph: ${vendorInfo.phone}`, margin + 4, detY);
            detY += 4.5;
        }
        if (vendorInfo.email) {
            doc.text(vendorInfo.email, margin + 4, detY);
            detY += 4.5;
        }
        if (vendorInfo.hstNumber) {
            doc.text(`HST#: ${vendorInfo.hstNumber}`, margin + 4, detY);
        }
    }

    // Right section: FROM
    const fromX = margin + colWidth + 8;

    // Accent left border
    doc.setDrawColor(...skyBlue);
    doc.setLineWidth(0.8);
    doc.line(fromX, y, fromX, y + 30);

    doc.setFontSize(7);
    doc.setTextColor(...skyBlue);
    doc.setFont('helvetica', 'bold');
    doc.text('FROM', fromX + 4, y + 4);

    doc.setFontSize(11);
    doc.setTextColor(...darkText);
    doc.setFont('helvetica', 'bold');
    doc.text('RestIQ Solutions', fromX + 4, y + 11);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...mediumText);
    doc.text('1278 Northmount Street', fromX + 4, y + 16);
    doc.text('Oshawa, ON, M1J 1E4', fromX + 4, y + 20.5);
    doc.text('Ph: 437 297 1321', fromX + 4, y + 25);

    y += 40;

    // ─── ITEMS TABLE ─────────────────────────────
    const cols = [
        { label: 'Description', width: 58, align: 'left' },
        { label: 'Unit', width: 22, align: 'left' },
        { label: 'Qty', width: 16, align: 'center' },
        { label: 'Unit Price', width: 26, align: 'right' },
        { label: 'Tax', width: 22, align: 'right' },
        { label: 'Total', width: 26, align: 'right' },
    ];

    const rowH = 9;
    const pad = 4;

    // Table header
    doc.setFillColor(...lightBg);
    doc.rect(margin, y, contentWidth, rowH, 'F');

    // Header borders
    doc.setDrawColor(...lineColor);
    doc.setLineWidth(0.3);
    doc.line(margin, y, rightEdge, y);
    doc.line(margin, y + rowH, rightEdge, y + rowH);

    doc.setTextColor(...navy);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');

    let colX = margin + pad;
    cols.forEach(col => {
        const textX = col.align === 'right' ? colX + col.width - pad
            : col.align === 'center' ? colX + col.width / 2
                : colX;
        doc.text(col.label, textX, y + 6, { align: col.align === 'center' ? 'center' : col.align === 'right' ? 'right' : 'left' });
        colX += col.width;
    });

    y += rowH;

    // Table rows
    const items = invoice.items || [];
    items.forEach((item, idx) => {
        const rowY = y + idx * rowH;

        // Alternating row tint
        if (idx % 2 === 0) {
            doc.setFillColor(250, 251, 253);
            doc.rect(margin, rowY, contentWidth, rowH, 'F');
        }

        // Bottom border for each row
        doc.setDrawColor(...lineColor);
        doc.setLineWidth(0.15);
        doc.line(margin, rowY + rowH, rightEdge, rowY + rowH);

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
            item.unit || 'unit',
            String(item.qty || 1),
            `$${price.toFixed(2)}`,
            item.isTaxable ? `$${tax.toFixed(2)}` : '\u2014',
            `$${lineTotal.toFixed(2)}`,
        ];

        colX = margin + pad;
        rowData.forEach((text, ci) => {
            const col = cols[ci];
            const textX = col.align === 'right' ? colX + col.width - pad
                : col.align === 'center' ? colX + col.width / 2
                    : colX;
            // Truncate long item names
            const displayText = ci === 0 && text.length > 28 ? text.substring(0, 26) + '...' : text;
            doc.text(displayText, textX, rowY + 6.2, { align: col.align === 'center' ? 'center' : col.align === 'right' ? 'right' : 'left' });
            colX += col.width;
        });
    });

    y += items.length * rowH + 8;

    // ─── SUMMARY ─────────────────────────────────
    const summaryW = 80;
    const summaryX = rightEdge - summaryW;
    const valX = rightEdge;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    // Subtotal
    doc.setTextColor(...mediumText);
    doc.text('Subtotal', summaryX, y);
    doc.setTextColor(...darkText);
    const subtotal = type === 'restaurant'
        ? Number(invoice.subtotal || 0)
        : Number(invoice.subtotalVendorAmount || invoice.grossVendorAmount || 0);
    doc.text(`$${subtotal.toFixed(2)}`, valX, y, { align: 'right' });
    y += 7;

    // Commission (vendor only)
    if (type === 'vendor' && invoice.commissionModel === 'VENDOR_FLAT_PERCENT') {
        doc.setTextColor(...mediumText);
        doc.text(`Commission (${invoice.commissionPercent || 10}%)`, summaryX, y);
        doc.setTextColor(220, 50, 50);
        doc.text(`- $${Number(invoice.commissionAmount || 0).toFixed(2)}`, valX, y, { align: 'right' });
        y += 7;

        doc.setTextColor(...mediumText);
        doc.text('Net Payable', summaryX, y);
        doc.setTextColor(...darkText);
        doc.text(`$${Number(invoice.netVendorPayable || 0).toFixed(2)}`, valX, y, { align: 'right' });
        y += 7;
    }

    // Tax
    doc.setTextColor(...mediumText);
    doc.text('Tax', summaryX, y);
    doc.setTextColor(...skyBlue);
    const taxAmount = type === 'restaurant'
        ? Number(invoice.totalTax || 0)
        : Number(invoice.totalTaxAmount || 0);
    doc.text(`+ $${taxAmount.toFixed(2)}`, valX, y, { align: 'right' });
    y += 5;

    // Divider line
    doc.setDrawColor(...lineColor);
    doc.setLineWidth(0.3);
    doc.line(summaryX, y, valX, y);
    y += 7;

    // Grand Total — highlighted box
    const totalLabel = type === 'restaurant' ? 'Grand Total' : 'Total Payout';
    const total = type === 'restaurant'
        ? Number(invoice.grandTotal || 0)
        : (invoice.commissionModel === 'VENDOR_FLAT_PERCENT'
            ? Number((invoice.netVendorPayable || 0) + taxAmount)
            : Number(invoice.totalVendorAmount || 0));
    const totalStr = `$${total.toFixed(2)}`;

    // Navy background box for total
    const totalBoxH = 10;
    doc.setFillColor(...navy);
    doc.roundedRect(summaryX - 2, y - 5, summaryW + 2, totalBoxH, 2, 2, 'F');

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...white);
    doc.text(totalLabel, summaryX + 3, y + 1.5);
    doc.text(totalStr, valX - 3, y + 1.5, { align: 'right' });

    y += 20;

    // ─── FOOTER ──────────────────────────────────
    // Thin accent line
    doc.setDrawColor(...skyBlue);
    doc.setLineWidth(0.5);
    doc.line(margin, y, rightEdge, y);
    y += 8;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...mediumText);
    doc.text('Thank you for your business!', pageWidth / 2, y, { align: 'center' });

    doc.setFontSize(7);
    doc.setTextColor(...mutedText);
    doc.text('Generated by RestIQ Solutions \u2014 Vendor Management Platform', pageWidth / 2, y + 5, { align: 'center' });

    // Return as base64
    return doc.output('datauristring');
}

// Helper: format Firestore timestamp or ISO string
function formatDate(val) {
    if (!val) return 'N/A';
    const d = val.toDate ? val.toDate() : new Date(val);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
