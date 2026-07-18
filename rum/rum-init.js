// rum/rum-init.js
// Elastic RUM agent init, injected into the frontend's base HTML template
// (via <script> before other bundles load, per Elastic's recommendation for
// accurate page-load timing capture).

import { init as initApm } from '@elastic/apm-rum';

const apm = initApm({
  serviceName: 'frontend-rum',
  serverUrl: window.__ENV__.APM_SERVER_RUM_URL, // e.g. https://apm.internal:8200
  serviceVersion: window.__ENV__.APP_VERSION,
  environment: window.__ENV__.DEPLOY_ENV,

  // requirement 2.1.3: distributed tracing headers on outbound calls so
  // browser spans stitch into backend traces in one Kibana APM waterfall.
  distributedTracingOrigins: [window.location.origin],

  // requirement 2.1.2: auto XHR/fetch + page-load instrumentation is on by
  // default; explicit here for clarity / auditability.
  disableInstrumentations: [],

  // requirement 2.1.4: Core Web Vitals are captured automatically by the
  // RUM agent's page-load transaction (largest-contentful-paint,
  // first-input-delay, cumulative-layout-shift marks) — no extra config
  // needed beyond ensuring `performance` marks are enabled (default).
});

// requirement 2.1.5: custom context — route, session, device class
apm.addLabels({
  session_id: getOrCreateSessionId(),
  device_class: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
});

apm.setInitialPageLoadName(window.location.pathname);

// Track route changes as separate RUM transactions (SPA-style navigation
// within the frontend's cart/checkout flow).
export function trackRouteChange(routeName) {
  const tx = apm.startTransaction(routeName, 'route-change', { managed: true });
  apm.addLabels({ page_route: routeName });
  return tx;
}

// requirement 2.1.2: explicit user-interaction spans on key CTAs, since
// auto-instrumentation covers XHR/page-load but not semantic click intent.
export function instrumentKeyInteractions() {
  document.querySelectorAll('[data-track="add-to-cart"]').forEach((el) => {
    el.addEventListener('click', () => {
      const span = apm.startSpan('click-add-to-cart', 'ui.interaction');
      // fetch() call for the add-to-cart XHR happens synchronously after;
      // distributedTracingOrigins ensures it inherits this trace context.
      setTimeout(() => span?.end(), 0);
    });
  });

  document.querySelectorAll('[data-track="checkout"]').forEach((el) => {
    el.addEventListener('click', () => {
      const span = apm.startSpan('click-checkout', 'ui.interaction');
      setTimeout(() => span?.end(), 0);
    });
  });
}

function getOrCreateSessionId() {
  let sid = sessionStorage.getItem('rum_session_id');
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem('rum_session_id', sid);
  }
  return sid;
}

export default apm;

/*
CORS note (requirement 2.1.6): APM Server config must include:

apm-server:
  rum:
    enabled: true
    allow_origins: ["https://<frontend-ingress-host>"]
    allow_headers: ["Content-Type", "traceparent", "tracestate"]

Without allow_headers including traceparent/tracestate, the browser will
strip those headers on preflight and browser-to-backend correlation breaks
silently (spans exist on both sides but never join into one trace).
*/
