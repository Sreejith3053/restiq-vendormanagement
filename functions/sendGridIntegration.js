const sgMail = require('@sendgrid/mail');
const { defineSecret } = require('firebase-functions/params');

// Define secrets so they can be injected into the Cloud Function
const SENDGRID_API_KEY = defineSecret('SENDGRID_API_KEY');
const SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID = defineSecret('SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID');

/**
 * Sends an order confirmation email to the restaurant using a SendGrid Dynamic Template.
 * 
 * @param {Object} orderData - The accepted order from Firestore
 * @param {string} toEmail - The restaurant's email address
 * @param {string} restaurantName - The restaurant's business name
 */
async function sendOrderConfirmationEmail(orderData, toEmail, restaurantName) {
    try {
        sgMail.setApiKey(SENDGRID_API_KEY.value());
        const templateId = SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID.value();

        if (!toEmail) {
            console.warn(`No email provided for order ${orderData.id}, cannot send confirmation.`);
            return false;
        }

        const msg = {
            to: toEmail,
            from: {
                email: 'support@restiqsolutions.com',
                name: 'RestIQ Solutions'
            },
            templateId: templateId,
            dynamicTemplateData: {
                orderNumber: orderData.orderGroupId || orderData.id.slice(-8).toUpperCase(),
                vendorName: orderData.vendorName || 'Vendor',
                restaurantName: restaurantName || orderData.restaurantId,
                pickupDate: orderData.pickupDate || 'N/A',
                pickupTime: orderData.pickupTime || 'N/A',
                items: (orderData.items || []).map(item => ({
                    name: item.name || item.itemName,
                    unit: item.unit,
                    price: `$${Number(item.price || item.vendorPrice || 0).toFixed(2)}`,
                    qty: item.qty,
                    lineTotal: `$${Number(item.lineSubtotal || 0).toFixed(2)}`
                })),
                subtotal: `$${Number(orderData.subtotalBeforeTax || 0).toFixed(2)}`,
                taxPercent: `${(orderData.taxRate || 0) * 100}%`,
                taxTotal: `$${Number(orderData.totalTax || 0).toFixed(2)}`,
                grandTotal: `$${Number(orderData.grandTotalAfterTax || orderData.total || 0).toFixed(2)}`
            }
        };
        console.log('Dynamic template data:', JSON.stringify(msg.dynamicTemplateData, null, 2));

        await sgMail.send(msg);
        console.log(`Order confirmation email sent successfully to ${toEmail} for order ${orderData.id}`);
        return true;
    } catch (error) {
        console.error("Error sending order confirmation email via SendGrid:", error);
        if (error.response) {
            console.error(error.response.body);
        }
        return false;
    }
}

/**
 * Sends a vendor welcome email with login credentials using an inline HTML template.
 * Styled to match the order confirmation template.
 *
 * @param {Object} params
 * @param {string} params.vendorName - The vendor's business name
 * @param {string} params.contactName - The vendor contact person's name
 * @param {string} params.toEmail - The vendor's email address
 * @param {string} params.username - The assigned login username
 * @param {string} params.tempPassword - The generated temporary password
 * @param {string} params.loginUrl - The portal login URL
 */
async function sendVendorWelcomeEmail({ vendorName, contactName, toEmail, username, tempPassword, loginUrl }) {
    try {
        sgMail.setApiKey(SENDGRID_API_KEY.value());

        if (!toEmail) {
            console.warn(`No email provided for vendor ${vendorName}, cannot send welcome email.`);
            return false;
        }

        const logoUrl = 'https://restiq-vendormanagement-9ce02799dcee.herokuapp.com/restiq-logo-sidebar.png';

        const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0b1120;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b1120;padding:40px 0;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background:#131d2e;border-radius:16px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">

<!-- Header -->
<tr><td style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 60%,#1a1145 100%);padding:40px 40px 32px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);">
  <img src="${logoUrl}" alt="RestIQ" width="220" style="display:block;margin:0 auto 16px;" />
  <div style="font-size:28px;font-weight:800;color:#f8fafc;letter-spacing:-0.5px;">🎉 Congratulations!</div>
  <div style="font-size:14px;color:#94a3b8;margin-top:6px;">You're now part of the RestIQ Vendor Network</div>
</td></tr>

<!-- Greeting -->
<tr><td style="padding:32px 40px 20px;">
  <div style="font-size:15px;color:#e2e8f0;line-height:1.7;">
    Hi <strong>${contactName || vendorName}</strong>,<br><br>
    Welcome aboard! Your vendor account for <strong style="color:#38bdf8;">${vendorName}</strong> has been created on the RestIQ Vendor Management Platform.
    You can now log in and start managing your catalog, orders, and invoices.
  </div>
</td></tr>

<!-- Credentials Card -->
<tr><td style="padding:0 40px 24px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.15);border-radius:12px;">
    <tr><td style="padding:20px 24px;">
      <div style="font-size:11px;font-weight:700;color:#38bdf8;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;">🔑 Your Login Credentials</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:13px;color:#94a3b8;padding:6px 0;width:140px;">Username</td>
          <td style="font-size:14px;color:#f8fafc;font-weight:700;font-family:monospace;padding:6px 0;">${username}</td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#94a3b8;padding:6px 0;">Temporary Password</td>
          <td style="font-size:14px;color:#fbbf24;font-weight:700;font-family:monospace;padding:6px 0;">${tempPassword}</td>
        </tr>
      </table>
    </td></tr>
  </table>
</td></tr>

<!-- Password Change Notice -->
<tr><td style="padding:0 40px 24px;">
  <div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:10px;padding:14px 18px;font-size:13px;color:#fbbf24;line-height:1.6;">
    ⚠️ <strong>Important:</strong> You will be prompted to change your password when you log in for the first time. Please choose a strong, unique password.
  </div>
</td></tr>

<!-- Login Button -->
<tr><td style="padding:0 40px 32px;text-align:center;">
  <a href="${loginUrl}" style="display:inline-block;padding:14px 48px;background:linear-gradient(135deg,#2563eb,#4f46e5);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.3px;">
    Log In to RestIQ →
  </a>
</td></tr>

<!-- Divider -->
<tr><td style="padding:0 40px;">
  <div style="border-top:1px solid rgba(255,255,255,0.06);"></div>
</td></tr>

<!-- Help -->
<tr><td style="padding:24px 40px;">
  <div style="font-size:12px;color:#475569;line-height:1.6;">
    If you have any questions or need help getting started, reach out to our support team at
    <a href="mailto:support@restiqsolutions.com" style="color:#38bdf8;text-decoration:none;">support@restiqsolutions.com</a>.
  </div>
</td></tr>

<!-- Footer -->
<tr><td style="background:#0b1120;padding:24px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.04);">
  <div style="font-size:11px;color:#334155;">© ${new Date().getFullYear()} RestIQ Solutions • Vendor Management Platform</div>
  <div style="font-size:10px;color:#1e293b;margin-top:6px;">This is an automated message. Please do not reply directly.</div>
</td></tr>

</table>
</td></tr></table>
</body></html>`;

        const msg = {
            to: toEmail,
            from: {
                email: 'support@restiqsolutions.com',
                name: 'RestIQ Solutions'
            },
            subject: `Welcome to RestIQ — ${vendorName}`,
            html: html,
        };

        await sgMail.send(msg);
        console.log(`Welcome email sent successfully to ${toEmail} for vendor ${vendorName}`);
        return true;
    } catch (error) {
        console.error("Error sending vendor welcome email via SendGrid:", error);
        if (error.response) {
            console.error(error.response.body);
        }
        return false;
    }
}

module.exports = {
    sendOrderConfirmationEmail,
    sendVendorWelcomeEmail,
    SENDGRID_API_KEY,
    SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID
};
