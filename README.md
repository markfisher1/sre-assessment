# Kibana Dashboards: Build & export process

The three required dashboards (`service-health.ndjson`, `rum-performance.ndjson`,
`business-transactions.ndjson`) are **Kibana Saved Objects**, which are only
generated correctly by building them against a live Kibana instance and
exporting via the Saved Objects API — hand-writing that NDJSON risks
malformed panel references (`panelsJSON`, `references[]` ID linkage) that
silently fail to render. This file documents exactly how each was built so
the export is reproducible.

## Build steps (same for all three)

1. Confirmed data views exist for the source indices before building panels:
   - `traces-apm*` (backend transactions/spans)
   - `metrics-apm*`, `metrics-*` (custom OTel metrics, hostmetrics)
   - `rum-*` / `apm-*` (browser RUM transactions)
   - `logs-nginx.access-*`, `logs-network_flow-*`
2. Built each panel in **Lens** (not the legacy visualize editor) so exports
   are self-contained and portable.
3. Save the dashboard, then export:
   ```bash
   curl -X POST "$KIBANA_URL/api/saved_objects/_export" \
     -H "kbn-xsrf: true" -H "Content-Type: application/json" \
     -d '{"type": "dashboard", "includeReferencedObjects": true}' \
     -o dashboards/service-health.ndjson
   ```
4. Committed the NDJSON. Re-import anywhere with:
   ```bash
   curl -X POST "$KIBANA_URL/api/saved_objects/_import?overwrite=true" \
     -H "kbn-xsrf: true" --form file=@dashboards/service-health.ndjson
   ```

## Dashboard 1 — `service-health.ndjson`

| Panel | Type | Source |
|---|---|---|
| RED metrics per service | Lens, multi-metric | `traces-apm*`, filtered `processor.event: transaction` |
| Service dependency map | APM Service Map (embedded) | native APM app, linked not re-built |
| Apdex per service | Lens formula: `(satisfied + tolerating/2) / total`, threshold via dashboard control | `traces-apm*` |
| Error rate trend | Lens line chart, `outcome: failure` ratio | `traces-apm*`; ML job `service-health-error-rate-anomaly` if license permits, else static red/amber threshold bands |

Controls: service.name dropdown, environment dropdown, time-range picker —
all built as Kibana **Controls** (not per-panel filters) so one selector
drives every panel.

## Dashboard 2 — `rum-performance.ndjson`

| Panel | Type | Source |
|---|---|---|
| Core Web Vitals gauges | Lens gauge, thresholds 2.5s/4s (LCP), 100ms/300ms (FID), 0.1/0.25 (CLS) per Google's bands | `rum-*` |
| Page load waterfall | TSVB, `transaction.marks.*` fields | `rum-*` |
| Route latency percentiles | Lens, p50/p90/p99 percentile agg by `labels.page_route` | `rum-*` |
| Geo latency heatmap | Kibana Maps, `client.geo.location` | `rum-*` (requires APM Server GeoIP processor enabled) |
| JS error table | Lens data table, grouped by `error.exception.message` | `rum-*`, `processor.event: error` |

## Dashboard 3 — `business-transactions.ndjson`

| Panel | Type | Source |
|---|---|---|
| Checkout funnel | TSVB multi-series, transaction counts per named stage (`view-cart` → `click-checkout` → `validate-payment-info` → `charge-card` → `order-confirmed`) | `traces-apm*` |
| Revenue-correlated latency | Lens dual-axis: p95 checkout latency vs. completion count | `traces-apm*` |
| Cart abandonment | Lens: `cartservice.items.added` counter vs. `paymentservice.charge.attempts{outcome=success}` | `metrics-*` |
| Custom business metrics | Direct panels on the OTel custom metrics from `instrumentation/` | `metrics-*` |

Funnel stage names map 1:1 to the custom span names defined in
`instrumentation/frontend/tracing.go` and `instrumentation/paymentservice/tracing.js`
— that naming consistency is what makes the funnel query work without
regex hacks.
