// instrumentation/paymentservice/tracing.js
//
// REFERENCE IMPLEMENTATION — see the note at the top of
// instrumentation/frontend/tracing.go. This code demonstrates the
// correct Node.js OTel SDK wiring pattern but was not compiled into the
// running application; verified traces came from otel-demo's own images.

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-grpc');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} = require('@opentelemetry/semantic-conventions');
const { trace, SpanStatusCode, metrics } = require('@opentelemetry/api');

const agentEndpoint = `http://${process.env.NODE_IP}:4317`;

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'paymentservice',
    [ATTR_SERVICE_VERSION]: process.env.APP_VERSION || '1.0.0',
    'deployment.environment': process.env.DEPLOY_ENV || 'assessment',
    'service.language': 'nodejs',
  }),
  traceExporter: new OTLPTraceExporter({ url: agentEndpoint }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: agentEndpoint }),
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

const tracer = trace.getTracer('paymentservice');
const meter = metrics.getMeter('paymentservice');

const paymentAttempts = meter.createCounter('paymentservice.charge.attempts', {
  description: 'Number of charge attempts, labeled by outcome',
});

function validatePaymentInfo(cardInfo, orderTotal) {
  return tracer.startActiveSpan('validate-payment-info', (span) => {
    span.setAttribute('order.total', orderTotal);
    span.setAttribute('card.type', cardInfo.cardType || 'unknown');
    try {
      if (!cardInfo.number || cardInfo.number.length < 12) {
        throw new Error('invalid card number');
      }
      span.setStatus({ code: SpanStatusCode.OK });
      return true;
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      paymentAttempts.add(1, { outcome: 'validation_failed' });
      throw err;
    } finally {
      span.end();
    }
  });
}

async function chargeCard(chargeFn, cardInfo, amount, userId) {
  return tracer.startActiveSpan('charge-card', async (span) => {
    span.setAttribute('user.id', userId);
    span.setAttribute('order.total', amount);
    try {
      const result = await chargeFn(cardInfo, amount);
      span.setAttribute('transaction.id', result.transactionId);
      span.setStatus({ code: SpanStatusCode.OK });
      paymentAttempts.add(1, { outcome: 'success' });
      return result;
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      paymentAttempts.add(1, { outcome: 'charge_failed' });
      throw err;
    } finally {
      span.end();
    }
  });
}

module.exports = { sdk, validatePaymentInfo, chargeCard };