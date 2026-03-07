const { GoogleGenAI } = require("@google/genai");

// Initialize Gemini using Vertex AI (uses application default credentials from Firebase)
const ai = new GoogleGenAI({
    vertexai: {
        project: process.env.GCLOUD_PROJECT || "restiq-vendormanagement",
        location: "us-central1"
    }
});

/**
 * Generates an explanation for the predicted demand and Monday/Thursday split.
 */
async function generateForecastReasoning(itemData) {
    const prompt = `
    You are an expert procurement analyst for a restaurant supply marketplace.
    Generate a precise, concise, 1-2 sentence business explanation for this item forecast.
    
    Item: ${itemData.itemName}
    Trend: ${itemData.trend}
    Confidence: ${itemData.confidence}
    Monday Split: ${itemData.mondaySplitPercent}%
    Thursday Split: ${itemData.thursdaySplitPercent}%
    Data History: ${itemData.weeksOfHistory} weeks
    Event Impact: ${itemData.eventImpact ? 'Yes, ' + itemData.eventName : 'None'}
    
    Required tone: professional, operational. 
    Mention the trend, the delivery day split, and the confidence level. If there's an event, mention its uplift.
    Do not invent numbers. Output ONLY the reasoning.
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: prompt,
            config: {
                temperature: 0.3
            }
        });
        return response.text.trim();
    } catch (error) {
        console.error("Gemini reasoning failed:", error);
        return "Deterministic forecast generated successfully. (AI reasoning unavailable)";
    }
}

/**
 * Generates a note specifically tailored for Vendor Planning.
 */
async function generateVendorPlanningNote(vendorData) {
    const prompt = `
    You are a supply chain coordinator formatting a note for a vendor.
    
    Vendor: ${vendorData.vendorName}
    Item: ${vendorData.itemName}
    Total Monday Demand: ${vendorData.mondayQty}
    Total Thursday Demand: ${vendorData.thursdayQty}
    Trend: ${vendorData.trend}
    Event Impact: ${vendorData.eventName || 'None'}
    
    Write a 1-sentence instruction for the vendor on what to anticipate next week, 
    mentioning which delivery day is heavier or if there's an event uplift.
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: prompt,
            config: {
                temperature: 0.3
            }
        });
        return response.text.trim();
    } catch (error) {
        return "Please prepare stock according to predicted Monday and Thursday splits.";
    }
}

module.exports = {
    generateForecastReasoning,
    generateVendorPlanningNote
};
