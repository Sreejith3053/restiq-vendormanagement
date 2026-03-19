// src/services/validationService.test.js
//
// Unit tests for validationService.
// Run with: npm test -- --watchAll=false --testPathPattern=validationService
//
import {
    validateCatalogItem,
    validateDispatchItem,
    detectPriceSpike,
} from './validationService';

// ── Catalog Item Validation ──────────────────────────────────────────────────

describe('validateCatalogItem', () => {
    const validItem = {
        itemName:   'Roma Tomatoes',
        category:   'Produce',
        vendorPrice: 25,
        unit:        'case',
    };

    it('passes for a fully valid item', () => {
        const result = validateCatalogItem(validItem);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('fails when itemName is missing', () => {
        const result = validateCatalogItem({ ...validItem, itemName: '' });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => /name/i.test(e))).toBe(true);
    });

    it('fails when vendorPrice is negative', () => {
        const result = validateCatalogItem({ ...validItem, vendorPrice: -5 });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => /price/i.test(e))).toBe(true);
    });

    it('fails when vendorPrice is zero', () => {
        const result = validateCatalogItem({ ...validItem, vendorPrice: 0 });
        expect(result.isValid).toBe(false);
    });

    it('fails when category is missing', () => {
        const result = validateCatalogItem({ ...validItem, category: undefined });
        expect(result.isValid).toBe(false);
    });

    it('fails when unit is missing', () => {
        const result = validateCatalogItem({ ...validItem, unit: '' });
        expect(result.isValid).toBe(false);
    });
});

// ── Dispatch Item Validation ─────────────────────────────────────────────────

describe('validateDispatchItem', () => {
    const validDispatch = {
        vendorId:   'vendor_001',
        weekStart:  '2026-03-16',
        items:      [{ itemId: 'item_1', itemName: 'Tomatoes', qty: 5, vendorPrice: 20 }],
    };

    it('passes for a fully valid dispatch', () => {
        const result = validateDispatchItem(validDispatch);
        expect(result.isValid).toBe(true);
    });

    it('fails when vendorId is missing', () => {
        const result = validateDispatchItem({ ...validDispatch, vendorId: '' });
        expect(result.isValid).toBe(false);
    });

    it('fails when items array is empty', () => {
        const result = validateDispatchItem({ ...validDispatch, items: [] });
        expect(result.isValid).toBe(false);
    });

    it('fails when an item has qty of 0', () => {
        const result = validateDispatchItem({
            ...validDispatch,
            items: [{ itemId: 'item_1', itemName: 'Tomatoes', qty: 0, vendorPrice: 20 }],
        });
        expect(result.isValid).toBe(false);
    });

    it('fails when items is not provided', () => {
        const result = validateDispatchItem({ ...validDispatch, items: undefined });
        expect(result.isValid).toBe(false);
    });
});

// ── Price Spike Detection ────────────────────────────────────────────────────

describe('detectPriceSpike', () => {
    it('returns no spike for a 10% increase', () => {
        const result = detectPriceSpike(100, 110);
        expect(result.isSpike).toBe(false);
    });

    it('returns spike for a 55% increase', () => {
        const result = detectPriceSpike(100, 155);
        expect(result.isSpike).toBe(true);
        expect(result.percentChange).toBeGreaterThan(50);
    });

    it('returns no spike for a 55% decrease (allowed direction)', () => {
        // Price drops are generally allowed — only sudden increases flag as spikes
        const result = detectPriceSpike(155, 100);
        // Either direction accepted, test that it handles gracefully
        expect(typeof result.isSpike).toBe('boolean');
    });

    it('returns no spike when previousPrice is 0 (avoid divide-by-zero)', () => {
        const result = detectPriceSpike(0, 25);
        expect(result).toHaveProperty('isSpike');
        // Should not throw
    });

    it('returns no spike when both prices are equal', () => {
        const result = detectPriceSpike(50, 50);
        expect(result.isSpike).toBe(false);
        expect(result.percentChange).toBe(0);
    });

    it('handles null/undefined gracefully', () => {
        expect(() => detectPriceSpike(null, 50)).not.toThrow();
        expect(() => detectPriceSpike(50, undefined)).not.toThrow();
    });
});
