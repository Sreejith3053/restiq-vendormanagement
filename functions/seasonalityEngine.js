/**
 * Evaluates active festival calendars against the given item and date window.
 */
async function getSeasonalityUplifts(db, itemId, category, targetDate) {
    const activeEventsSnap = await db.collection('festivalCalendar')
        .where('isActive', '==', true)
        .get();

    const applicableUplifts = [];

    activeEventsSnap.forEach(doc => {
        const event = doc.data();
        // Check date intersection
        const eventStart = new Date(event.startDate);
        const eventEnd = new Date(event.endDate);
        if (targetDate >= eventStart && targetDate <= eventEnd) {

            // Check rules
            if (event.upliftRules && Array.isArray(event.upliftRules)) {
                for (const rule of event.upliftRules) {
                    if (rule.targetType === 'category' && rule.targetValue === category) {
                        applicableUplifts.push({
                            eventName: event.eventName,
                            percent: rule.percent
                        });
                    } else if (rule.targetType === 'item' && rule.targetValue === itemId) {
                        applicableUplifts.push({
                            eventName: event.eventName,
                            percent: rule.percent
                        });
                    }
                }
            }
        }
    });

    return applicableUplifts;
}

module.exports = {
    getSeasonalityUplifts
};
