// instrumentation/frontend/tracing.go
//
// REFERENCE IMPLEMENTATION — demonstrates the correct OpenTelemetry SDK
// wiring pattern for a Go service. This code was NOT compiled into the
// running application; the traces actually verified in Kibana came from
// otel-demo's own pre-built, SDK-instrumented images (see
// docs/DECISIONS.md ADR-009). This file shows what full manual/custom
// instrumentation looks like for the pattern the assessment specifies.

package tracing

import (
	"context"
	"net/http"
	"os"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
)

var (
	tracer          = otel.Tracer("frontend")
	meter           = otel.Meter("frontend")
	cartViewCounter metric.Int64Counter
)

// InitTracing configures the SDK to export to the local node's collector
// via the Kubernetes downward API host IP.
func InitTracing(ctx context.Context) (func(context.Context) error, error) {
	agentEndpoint := os.Getenv("NODE_IP") + ":4317"

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName("frontend"),
			semconv.ServiceVersion(os.Getenv("APP_VERSION")),
			semconv.DeploymentEnvironment(os.Getenv("DEPLOY_ENV")),
			attribute.String("service.language", "go"),
		),
	)
	if err != nil {
		return nil, err
	}

	traceExp, err := otlptracegrpc.New(ctx,
		otlptracegrpc.WithEndpoint(agentEndpoint),
		otlptracegrpc.WithInsecure(),
	)
	if err != nil {
		return nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(traceExp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)
	otel.SetTracerProvider(tp)

	metricExp, err := otlpmetricgrpc.New(ctx,
		otlpmetricgrpc.WithEndpoint(agentEndpoint),
		otlpmetricgrpc.WithInsecure(),
	)
	if err != nil {
		return nil, err
	}
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp)),
		sdkmetric.WithResource(res),
	)
	otel.SetMeterProvider(mp)

	cartViewCounter, _ = meter.Int64Counter(
		"frontend.cart.view_count",
		metric.WithDescription("Number of times a user viewed their cart"),
	)

	return func(ctx context.Context) error {
		_ = tp.Shutdown(ctx)
		_ = mp.Shutdown(ctx)
		return nil
	}, nil
}

// HTTPMiddleware wraps every route with otelhttp for auto server spans.
func HTTPMiddleware(handler http.Handler, routeName string) http.Handler {
	return otelhttp.NewHandler(handler, routeName)
}

// GRPCDialOptions ensures downstream gRPC calls carry trace context.
func GRPCDialOptions() []grpc.DialOption {
	return []grpc.DialOption{
		grpc.WithStatsHandler(otelgrpc.NewClientHandler()),
	}
}

// RenderCartTemplate — custom business span #1.
func RenderCartTemplate(ctx context.Context, userID string, itemCount int) (context.Context, trace.Span) {
	ctx, span := tracer.Start(ctx, "render-cart-template",
		trace.WithAttributes(
			attribute.String("user.id", userID),
			attribute.Int("product.count", itemCount),
		),
	)
	cartViewCounter.Add(ctx, 1)
	return ctx, span
}

// ValidateCheckoutForm — custom business span #2.
func ValidateCheckoutForm(ctx context.Context, orderTotal float64) (context.Context, trace.Span) {
	return tracer.Start(ctx, "validate-checkout-form",
		trace.WithAttributes(attribute.Float64("order.total", orderTotal)),
	)
}
