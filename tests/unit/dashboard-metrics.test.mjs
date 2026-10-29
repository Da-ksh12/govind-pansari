// QA TC-07 / TC-15 / TC-16: the Active Orders card, the Live Order Pipeline
// and the Orders list must all be built from the same definitions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_ORDER_STATUSES,
  PIPELINE_STAGES,
  activeOrderCount,
  isActiveOrderStatus,
  ordersRouteForStage,
  ordersRouteForView,
  pipelineCounts,
  statusesForStage,
} from '../../services/dashboardMetrics.ts';
import { ORDER_FILTERS, awaitsOnlinePayment, filterKeyFromParams, queryForFilter } from '../../services/orderFilters.ts';

test('delivered and cancelled are the only terminal statuses', () => {
  assert.equal(isActiveOrderStatus('delivered'), false);
  assert.equal(isActiveOrderStatus('cancelled'), false);
  for (const status of ACTIVE_ORDER_STATUSES) assert.equal(isActiveOrderStatus(status), true, status);
  assert.equal(isActiveOrderStatus('not-a-status'), false);
});

test('every active status belongs to exactly one open pipeline stage', () => {
  const openStages = PIPELINE_STAGES.filter((s) => s.key !== 'delivered');
  for (const status of ACTIVE_ORDER_STATUSES) {
    const owners = openStages.filter((s) => s.statuses.includes(status));
    assert.equal(owners.length, 1, `${status} is in ${owners.length} stages`);
  }
  // ...and no stage invents a status that is not active.
  for (const stage of openStages) {
    for (const status of stage.statuses) assert.equal(isActiveOrderStatus(status), true, `${stage.key}:${status}`);
  }
});

test('pipeline stages add up to the Active Orders figure', () => {
  const byStatus = {
    placed: 3, confirmed: 2, preparing: 4, picking: 1, packing: 2, packed: 5,
    rider_assigned: 3, out_for_delivery: 6, approaching: 3,
    delivered: 40, cancelled: 7, // terminal — must not be counted
  };
  const active = Object.entries(byStatus)
    .filter(([status]) => isActiveOrderStatus(status))
    .reduce((sum, [, n]) => sum + n, 0);
  const ops = { pendingOrders: 3, ordersPreparing: 7, ordersReady: 5, activeOrders: active, byStatus, deliveredToday: 9 };

  const counts = pipelineCounts(ops);
  const staged = Object.entries(counts)
    .filter(([key]) => key !== 'delivered')
    .reduce((sum, [, n]) => sum + n, 0);

  assert.equal(activeOrderCount(ops), active);
  assert.equal(staged, active);
  assert.equal(counts.preparing, 4 + 1 + 2);
  assert.equal(counts.onway, 6 + 3);
  assert.equal(counts.delivered, 9, 'Delivered shows today only');
});

test('activeOrderCount prefers the server figure, even when it is 0', () => {
  assert.equal(activeOrderCount({ pendingOrders: 5, ordersPreparing: 5, ordersReady: 5, activeOrders: 0 }), 0);
  assert.equal(activeOrderCount({ pendingOrders: 5, ordersPreparing: 4, ordersReady: 3 }), 12, 'older server falls back to its buckets');
});

test('pipelineCounts tolerates a missing breakdown', () => {
  const counts = pipelineCounts({ pendingOrders: 0, ordersPreparing: 0, ordersReady: 0 });
  for (const stage of PIPELINE_STAGES) assert.equal(counts[stage.key], 0, stage.key);
});

test('pipelineCounts falls back to today-only counts for an older server', () => {
  const counts = pipelineCounts({ pendingOrders: 0, ordersPreparing: 0, ordersReady: 0, todayByStatus: { placed: 2, packed: 1 } });
  assert.equal(counts.new, 2);
  assert.equal(counts.ready, 1);
});

test('dashboard cards link to lists holding exactly what they counted', () => {
  assert.equal(ordersRouteForView('active'), '/admin/orders?view=active');
  assert.equal(ordersRouteForStage('preparing'), '/admin/orders?stage=preparing');
  assert.deepEqual(statusesForStage('preparing'), ['preparing', 'picking', 'packing']);
  assert.equal(statusesForStage('nope'), undefined);

  // The list a stage opens queries the same statuses the stage counted.
  for (const stage of PIPELINE_STAGES) {
    const key = filterKeyFromParams({ stage: stage.key });
    assert.equal(key, stage.key);
    const filter = ORDER_FILTERS.find((f) => f.key === key);
    assert.deepEqual(filter.statuses, stage.statuses);
  }
});

test('filterKeyFromParams resolves views, stages and legacy ?status= links', () => {
  assert.equal(filterKeyFromParams({ view: 'active' }), 'active');
  assert.equal(filterKeyFromParams({ view: 'needs_rider' }), 'needs_rider');
  assert.equal(filterKeyFromParams({ view: 'stuck_delivery' }), 'stuck');
  assert.equal(filterKeyFromParams({ status: 'placed' }), 'new');
  assert.equal(filterKeyFromParams({ status: 'picking' }), 'preparing', 'a status inside a multi-status stage');
  assert.equal(filterKeyFromParams({ status: 'cancelled' }), 'cancelled');
  assert.equal(filterKeyFromParams({ stage: 'unknown-stage' }), 'all');
  assert.equal(filterKeyFromParams({}), 'all');
});

test('queryForFilter sends only what the server needs', () => {
  const find = (key) => ORDER_FILTERS.find((f) => f.key === key);
  assert.deepEqual(queryForFilter(find('all')), {});
  assert.deepEqual(queryForFilter(find('new')), { status: 'placed' });
  assert.deepEqual(queryForFilter(find('preparing')), { statuses: ['preparing', 'picking', 'packing'] });
  assert.deepEqual(queryForFilter(find('active')), { view: 'active' });
  assert.deepEqual(queryForFilter(find('needs_rider')), { view: 'needs_rider' });
});

test('awaitsOnlinePayment mirrors order_awaits_online_payment()', () => {
  const upi = [{ method: 'upi', created_at: '2026-10-20T10:00:00Z' }];
  const cod = [{ method: 'cod', created_at: '2026-10-20T10:00:00Z' }];
  assert.equal(awaitsOnlinePayment('pending', upi), true);
  assert.equal(awaitsOnlinePayment('paid', upi), false, 'verified paid');
  assert.equal(awaitsOnlinePayment('pending', cod), false, 'COD is collected on delivery');
  assert.equal(awaitsOnlinePayment('pending', []), false, 'no payment row');
  assert.equal(awaitsOnlinePayment('pending', null), false);
  // The latest attempt decides: UPI first, then switched to COD.
  const switched = [
    { method: 'upi', created_at: '2026-10-20T10:00:00Z' },
    { method: 'cod', created_at: '2026-10-20T10:05:00Z' },
  ];
  assert.equal(awaitsOnlinePayment('pending', switched), false);
});
