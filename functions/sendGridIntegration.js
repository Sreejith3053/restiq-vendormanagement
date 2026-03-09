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

module.exports = {
    sendOrderConfirmationEmail,
    SENDGRID_API_KEY,
    SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID
};
