// src/constants/taxRates.js
// Canadian provincial and US state tax data for vendor management

export const COUNTRIES = ['Canada', 'United States'];

export const CANADA_PROVINCES = [
    { code: 'AB', name: 'Alberta', rate: 5, type: 'GST' },
    { code: 'BC', name: 'British Columbia', rate: 12, type: 'GST+PST' },
    { code: 'MB', name: 'Manitoba', rate: 12, type: 'GST+PST' },
    { code: 'NB', name: 'New Brunswick', rate: 15, type: 'HST' },
    { code: 'NL', name: 'Newfoundland & Labrador', rate: 15, type: 'HST' },
    { code: 'NT', name: 'Northwest Territories', rate: 5, type: 'GST' },
    { code: 'NS', name: 'Nova Scotia', rate: 15, type: 'HST' },
    { code: 'NU', name: 'Nunavut', rate: 5, type: 'GST' },
    { code: 'ON', name: 'Ontario', rate: 13, type: 'HST' },
    { code: 'PE', name: 'Prince Edward Island', rate: 15, type: 'HST' },
    { code: 'QC', name: 'Quebec', rate: 14.975, type: 'GST+QST' },
    { code: 'SK', name: 'Saskatchewan', rate: 11, type: 'GST+PST' },
    { code: 'YT', name: 'Yukon', rate: 5, type: 'GST' },
];

export const US_STATES = [
    { code: 'AL', name: 'Alabama', rate: 4 },
    { code: 'AK', name: 'Alaska', rate: 0 },
    { code: 'AZ', name: 'Arizona', rate: 5.6 },
    { code: 'AR', name: 'Arkansas', rate: 6.5 },
    { code: 'CA', name: 'California', rate: 7.25 },
    { code: 'CO', name: 'Colorado', rate: 2.9 },
    { code: 'CT', name: 'Connecticut', rate: 6.35 },
    { code: 'DE', name: 'Delaware', rate: 0 },
    { code: 'FL', name: 'Florida', rate: 6 },
    { code: 'GA', name: 'Georgia', rate: 4 },
    { code: 'HI', name: 'Hawaii', rate: 4 },
    { code: 'ID', name: 'Idaho', rate: 6 },
    { code: 'IL', name: 'Illinois', rate: 6.25 },
    { code: 'IN', name: 'Indiana', rate: 7 },
    { code: 'IA', name: 'Iowa', rate: 6 },
    { code: 'KS', name: 'Kansas', rate: 6.5 },
    { code: 'KY', name: 'Kentucky', rate: 6 },
    { code: 'LA', name: 'Louisiana', rate: 4.45 },
    { code: 'ME', name: 'Maine', rate: 5.5 },
    { code: 'MD', name: 'Maryland', rate: 6 },
    { code: 'MA', name: 'Massachusetts', rate: 6.25 },
    { code: 'MI', name: 'Michigan', rate: 6 },
    { code: 'MN', name: 'Minnesota', rate: 6.875 },
    { code: 'MS', name: 'Mississippi', rate: 7 },
    { code: 'MO', name: 'Missouri', rate: 4.225 },
    { code: 'MT', name: 'Montana', rate: 0 },
    { code: 'NE', name: 'Nebraska', rate: 5.5 },
    { code: 'NV', name: 'Nevada', rate: 6.85 },
    { code: 'NH', name: 'New Hampshire', rate: 0 },
    { code: 'NJ', name: 'New Jersey', rate: 6.625 },
    { code: 'NM', name: 'New Mexico', rate: 4.875 },
    { code: 'NY', name: 'New York', rate: 4 },
    { code: 'NC', name: 'North Carolina', rate: 4.75 },
    { code: 'ND', name: 'North Dakota', rate: 5 },
    { code: 'OH', name: 'Ohio', rate: 5.75 },
    { code: 'OK', name: 'Oklahoma', rate: 4.5 },
    { code: 'OR', name: 'Oregon', rate: 0 },
    { code: 'PA', name: 'Pennsylvania', rate: 6 },
    { code: 'RI', name: 'Rhode Island', rate: 7 },
    { code: 'SC', name: 'South Carolina', rate: 6 },
    { code: 'SD', name: 'South Dakota', rate: 4.5 },
    { code: 'TN', name: 'Tennessee', rate: 7 },
    { code: 'TX', name: 'Texas', rate: 6.25 },
    { code: 'UT', name: 'Utah', rate: 6.1 },
    { code: 'VT', name: 'Vermont', rate: 6 },
    { code: 'VA', name: 'Virginia', rate: 5.3 },
    { code: 'WA', name: 'Washington', rate: 6.5 },
    { code: 'WV', name: 'West Virginia', rate: 6 },
    { code: 'WI', name: 'Wisconsin', rate: 5 },
    { code: 'WY', name: 'Wyoming', rate: 4 },
    { code: 'DC', name: 'District of Columbia', rate: 6 },
];

// Helper: get regions for a given country
export const getRegionsForCountry = (country) => {
    if (country === 'Canada') return CANADA_PROVINCES;
    if (country === 'United States') return US_STATES;
    return [];
};

// Helper: get tax rate for a country + province/state code
export const getTaxRate = (country, regionCode) => {
    const regions = getRegionsForCountry(country);
    const region = regions.find(r => r.code === regionCode);
    return region?.rate ?? 0;
};

// Helper: get region label (Province vs State)
export const getRegionLabel = (country) => {
    if (country === 'Canada') return 'Province';
    if (country === 'United States') return 'State';
    return 'Region';
};
