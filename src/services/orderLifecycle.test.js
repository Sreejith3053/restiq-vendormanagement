// src/services/orderLifecycle.test.js
//
// Unit tests for the orderLifecycle state machine.
// Run with: npm test -- --watchAll=false --testPathPattern=orderLifecycle
//
import {
    canTransitionOrder,
    getValidOrderTransitions,
    getTerminalOrderStatuses,
} from './orderLifecycle';

// ── Order State Machine ──────────────────────────────────────────────────────

describe('Order State Machine — canTransitionOrder', () => {

    describe('Valid transitions', () => {
        const validCases = [
            ['new',                       'pending_confirmation'],
            ['pending_confirmation',       'confirmed'],
            ['pending_confirmation',       'rejected'],
            ['confirmed',                 'in_preparation'],
            ['confirmed',                 'cancelled'],
            ['in_preparation',            'dispatched'],
            ['dispatched',                'delivered_awaiting_confirmation'],
            ['delivered_awaiting_confirmation', 'fulfilled'],
            ['delivered_awaiting_confirmation', 'in_review'],
            ['in_review',                 'fulfilled'],
            ['in_review',                 'refund_initiated'],
        ];

        test.each(validCases)('ALLOW: %s → %s', (from, to) => {
            expect(canTransitionOrder(from, to)).toBe(true);
        });
    });

    describe('Invalid transitions', () => {
        const invalidCases = [
            ['fulfilled',   'new'],           // terminal → anything
            ['rejected',    'confirmed'],      // terminal → anything
            ['cancelled',   'dispatched'],     // terminal → anything
            ['new',         'fulfilled'],      // skip steps
            ['dispatched',  'new'],            // backward
            ['fulfilled',   'in_review'],      // past terminal
        ];

        test.each(invalidCases)('DENY: %s → %s', (from, to) => {
            expect(canTransitionOrder(from, to)).toBe(false);
        });
    });

    describe('Terminal states', () => {
        const terminals = getTerminalOrderStatuses();

        it('fulfilled is terminal', () => expect(terminals).toContain('fulfilled'));
        it('rejected is terminal',  () => expect(terminals).toContain('rejected'));
        it('cancelled is terminal', () => expect(terminals).toContain('cancelled'));

        it('no valid transitions exist from terminal states', () => {
            terminals.forEach(status => {
                const allowed = getValidOrderTransitions(status);
                expect(allowed.length).toBe(0);
            });
        });
    });

    describe('Null/undefined handling', () => {
        it('returns false for null from-state',    () => expect(canTransitionOrder(null, 'confirmed')).toBe(false));
        it('returns false for null to-state',      () => expect(canTransitionOrder('new', null)).toBe(false));
        it('returns false for undefined from-state', () => expect(canTransitionOrder(undefined, 'confirmed')).toBe(false));
        it('returns false for random string',      () => expect(canTransitionOrder('foobar', 'confirmed')).toBe(false));
    });
});

describe('getValidOrderTransitions', () => {
    it('returns non-empty array from "new"',          () => expect(getValidOrderTransitions('new').length).toBeGreaterThan(0));
    it('returns empty array from "fulfilled"',         () => expect(getValidOrderTransitions('fulfilled')).toEqual([]));
    it('returns empty array from unknown status',      () => expect(getValidOrderTransitions('xyz')).toEqual([]));
});
