# Architectural Decision Log

## ADR-001: Agent (DaemonSet) + Gateway topology, not agent-only

**Decision:** Every node runs a lightweight OTel Collector as a DaemonSet
(receives OTLP from local pods, scrapes `hostmetrics`), which forwards to a
central Gateway Deployment (2+ replicas) that does the expensive work:
tail-based sampling, k8s resource enrichment, and the single OTLP export to
Elastic APM Server.

**Why:** Tail-based sampling needs to see *all* spans of a trace to decide
whether to keep it, which is only possible if they're funneled through one
place. Doing sampling on individual DaemonSet agents would sample each span
independently and break trace completeness. Node agents also insulate pods
from APM Server network blips (local buffering).

**Trade-off accepted:** Extra hop = extra latency (~single digit ms) and one
more component to keep healthy. Mitigated with the collector's own
`healthcheck` + `zpages` extensions monitored by a synthetic check.

## ADR-002: Tail sampling policy

- **100%** of traces containing an error span (`status.code = ERROR`)
- **100%** of traces exceeding p99 latency for that service (adaptive
  latency policy, threshold refreshed from a 15-min window)
- **10%** of everything else (probabilistic, deterministic on trace ID so a
  trace is never partially sampled)

**Why:** Errors and outliers are where incidents live; sampling those away
would blind SRE response. Ten percent of "boring" traffic is enough to
support RED-metric trending without paying full storage cost on Elasticsearch.

## ADR-003: Exporter target is APM Server, not Elasticsearch directly

OTLP → APM Server (`:8200`) → Elasticsearch, rather than an OTel `elasticsearch`
exporter straight into ES.

**Why:** APM Server does semantic translation of OTel spans into the Elastic
APM data model (transactions/spans/errors), which is what makes the Kibana
APM UI (Service Map, waterfalls, RUM correlation) work. Writing raw OTLP
into ES indices directly would lose that UI entirely — you'd have documents
but not a working APM app.

## ADR-004: RUM agent = `@elastic/apm-rum`, not the OTel Web SDK

**Why:** The requirement is browser-to-backend trace correlation *inside
Kibana APM*, and the Elastic RUM agent is purpose-built for the APM Server's
RUM intake and for producing the transaction/span shape the APM UI expects
(page-load transactions, `apm-rum`-flavored `distributed_tracing_origins`
config). The OTel Web SDK is viable but requires more manual mapping to get
the same UI fidelity — not worth the risk for this scope.

## ADR-005: Alert delivery via webhook connector, not email

All Kibana rules (Section 3) fire to a single generic **Webhook connector**
pointed at a stub receiver (`infrastructure/alerting-rules/webhook-stub.md`
documents the expected payload). Chosen because it's protocol-agnostic and
swaps trivially for Slack/PagerDuty/Opsgenie in a real deployment, without
touching rule definitions.

## ADR-006: Postgres/Redis/NGINX via Fleet-managed integrations, not raw Beats

**Why:** Fleet policies are versioned, centrally managed, and ship with
pre-built Kibana dashboards (`[Metrics PostgreSQL] Overview`, etc.) that
satisfy the "out-of-the-box dashboard populated" requirement without
hand-rolling visualizations. Standalone Beats YAML is kept in
`infrastructure/*-integration/*.yml` as the equivalent-if-Fleet-unavailable
fallback, since the assessment explicitly allows either.

## ADR-007: Network policy logging via Cilium Hubble, not Calico

Assumed CNI is Cilium (common default for this class of assessment cluster).
Hubble's flow log export via `hubble-relay` → Filebeat custom log input is
lower-friction than Calico's Felix log parsing. If the actual cluster runs
Calico, swap the input in
`infrastructure/alerting-rules/network-flow-filebeat.yml` — the ES index
target and dashboard panel are CNI-agnostic (`logs-network_flow-*`).

## Known Gaps / What I'd Do With More Time

- Elastic ML anomaly detection jobs for error-rate trend (Dashboard 1d)
  require the platinum/enterprise license; I documented the manual
  threshold-rule fallback instead of assuming license availability.
- Geographic RUM heatmap (Dashboard 2d) depends on `client.geo` being
  populated by APM Server's GeoIP processor — needs the GeoIP database
  installed on the ES nodes, called out as an infra prerequisite rather
  than something the app config can guarantee.
