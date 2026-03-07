const now = new Date();
const nextWeekStart = new Date(now);
nextWeekStart.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7));
console.log('Now:', now.toISOString());
console.log('Next Week Start Date:', nextWeekStart.toISOString());
const weekKey = nextWeekStart.toISOString().split('T')[0];
console.log('Week Key used:', weekKey);
