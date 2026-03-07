const admin = require('firebase-admin');

const rmsServiceAccount = {
    type: "service_account",
    project_id: "orumarmsprod",
    private_key_id: "8e8360ad7717da54dd456125378a9feb1ddf5854",
    private_key: process.env.RMS_PRIVATE_KEY || "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDfUKGmKzOHXrJr\nYAhkMVgdjGkX86Zt8WKFWnvxinJuMWLFS8aHhRfHTIoBI8jckbofQGtHCaCy6mPm\ntMZ+CisOpzso8yTBkLLDRcrXaAQYR42zBu4daKJ5wNFBJqczcPRuQ+xM0KE4YWCq\nIxyuZ1l/m7qygODKTqdkq7jrvoxwRWgAINCeMdaf7P1nStU4CzqlA4Fd1XEO7k3a\nAsKI6KdXAvhREyyYqPBfLIKoG9bAyzWpt26trOMBRtJIeLAXSqOrqvIIlfTt6IKc\nRnmgIadhxsyIMZ8k8DfyuqDY0fujog4fVzQzRVJvxmBp0Zinw+2yKat+lGvT8zUO\npkoeskCpAgMBAAECggEACQo9kPl8u4Uk2d3oWQ36UC/n7TVKznaQE2/nRo7hNP7A\nzdXUcpX7sXCywXsOXYd0rmEwNo74N2Xvp144DtAgkBZK+cxl94QBCJChtniaedUj\nslScfQpIUX9xuR50dEulSXVscmubqymd/SUwuwqp/9VxCFrZPrdSZWviL4DmNIE3\naPUYeEanzs/fhpWlN1cNfRpHZBqvRzdowIaCeHLKUBJAblaaadDot5Zwcj4YW95E\n/yfD1zrcUYz58huXk01SaLpyonu+jOhR/Uf4ynnCYAGkyQcRlOEVT4W4aj+WVepH\nEQSzaufyZCza2AhrDATvlZpW2QL0GEjNv6Eu3MlPhQKBgQDzsrbd+DRKD0ElW+y+\ngnKnoNFtu6oIs7Q/dTj9eYDBXmtx7v8eGEXKSdpRZ4YH8U1ws12ltxpzg6M0KIg8\n1nQXGdsHADyARu5NOUe/apsCZihTemSh7tuFPfuj9LESyAmeiSWQ8j58/jgWL+vp\nfYj2lcm5D8nguICsn2kNF5DpfwKBgQDqloIHvq5RqIlEK607w8E3CseYeC/n7oHy\nnA3lMmiAFhCTvSp3o9296vHjOAqazbGZmGNWnh2HF52vANDtVD5PAE/uaqQK7YcB\nB1Q27u9zsmC8iQnRgRbmLPmpno5HLlQemWaSNmCLhFk3UvXjOtQ8oaQgCnS/3eTH\ngAkuK69Z1wKBgQDWD9KfselEcJfZ2CBhy7Yo1pN/30thb3DSGQbhaDwYHvckUjoY\nVlvfb/XscZIDIgvTBkspSGhctXHDXCMnxXyd2iFRyfxa9XNXtAv48QyOE+wyP51r\nvKNpK+QBxetQwxPoBTJRWuhW5PuhSaDhLVsEtthFzb+XvJmSiEg/rsakwwKBgARy\nGcC/0lnl0cQi98N8MDs0zxeKn43LrVbFslW3oNdck6/ZE+b0ig1BWJgvxbOtVkJM\n6wUHNhQLVIeugkcdI5knrlwcVUOHwNk6JFRuLseIh+DK0A7SXXa7P3gBczzSGfIC\ngjkfIrFCLtankdVelgsYHR4mVJQWRnGpcYMYfNg9AoGAczIG8NK/Csp7T7IN14AW\nPCky1T4jEfnSJmuUQLOnnUv1lXWU7QqGI3x/nsxe0xic4GvBN0e2wQ3cqXfxXlLi\n97US3WN6CMsOsKQGaY3dnXU7t5iAHcGqegBfO5j5Mzw4mXB9JLvgBDs4kqclHPpO\n1GeiJT2IMRUa2kyKFv4/Tvk=\n-----END PRIVATE KEY-----\n",
    client_email: "firebase-adminsdk-fbsvc@orumarmsprod.iam.gserviceaccount.com",
    client_id: "100723697611119927274",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40orumarmsprod.iam.gserviceaccount.com",
    universe_domain: "googleapis.com"
};

try {
    admin.initializeApp({
        credential: admin.credential.cert(rmsServiceAccount),
        projectId: 'orumarmsprod'
    });
} catch (e) {
    console.error("Failed to initialize admin.", e);
    process.exit(1);
}

const db = admin.firestore();

async function seedData() {
    console.log("Seeding test data for AI Forecast Module...");

    const restaurantId = "test-rest-001";
    const restaurantName = "The Great Mock Restaurant";
    const vendorId = "test-vendor-001";
    const vendorName = "Premium Meats Co.";
    const itemId = "item-chicken-breast";
    const itemName = "Premium Chicken Breast (10kg)";
    const category = "Meat";
    const unit = "Box";

    const batch = db.batch();

    // 1. Seed Config
    const configRef = db.collection('forecastConfig').doc('global');
    batch.set(configRef, {
        safetyBufferPercent: 0.15,
        defaultMondaySplit: 0.40,
        defaultThursdaySplit: 0.60
    }, { merge: true });

    // 2. Seed a Festival Event
    const eventStart = new Date();
    eventStart.setDate(eventStart.getDate() + 2);
    const eventEnd = new Date(eventStart);
    eventEnd.setDate(eventEnd.getDate() + 5);

    const eventRef = db.collection('festivalCalendar').doc('mock-event-001');
    batch.set(eventRef, {
        eventName: "Mock Spring Festival",
        startDate: eventStart.toISOString().split('T')[0],
        endDate: eventEnd.toISOString().split('T')[0],
        isActive: true,
        notes: "Test event injected via seed script",
        upliftRules: [
            { targetType: "category", targetValue: "Meat", percent: 20 }
        ]
    });

    console.log("Config and Event seeded. Generating historical orders...");

    // 3. Seed 8 weeks of historical orders
    // We want Monday (Mon-Wed) delivery and Thursday (Thu-Sun) delivery patterns.
    // Let's create orders on actual past dates.
    const now = new Date();
    for (let i = 0; i < 8; i++) {
        // Find the Monday of 'i' weeks ago
        const pastDate = new Date(now);
        pastDate.setDate(now.getDate() - (i * 7) - now.getDay() + 1);

        // Monday-ish Order (Delivery 1)
        const monOrderRef = db.collection('marketplaceOrders').doc(`mock-ord-mon-${i}`);
        batch.set(monOrderRef, {
            restaurantId, restaurantName,
            vendorId, vendorName,
            itemId, itemName,
            category, unit,
            quantity: Math.floor(Math.random() * 5) + 10, // 10 to 14
            orderDate: pastDate.toISOString(),
            status: "Delivered",
            totalAmount: 150.00
        });

        // Thursday-ish Order (Delivery 2)
        const thuDate = new Date(pastDate);
        thuDate.setDate(pastDate.getDate() + 3); // Thursday
        const thuOrderRef = db.collection('marketplaceOrders').doc(`mock-ord-thu-${i}`);
        batch.set(thuOrderRef, {
            restaurantId, restaurantName,
            vendorId, vendorName,
            itemId, itemName,
            category, unit,
            quantity: Math.floor(Math.random() * 10) + 15, // 15 to 24 (Higher on weekends)
            orderDate: thuDate.toISOString(),
            status: "Delivered",
            totalAmount: 250.00
        });
    }

    try {
        await batch.commit();
        console.log("✅ Seed data successfully committed!");
    } catch (err) {
        console.error("❌ Error committing batch:", err);
    }
}

seedData();
