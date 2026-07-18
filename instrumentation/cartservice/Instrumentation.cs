// instrumentation/cartservice/Instrumentation.cs
//
// REFERENCE IMPLEMENTATION — see the note at the top of
// instrumentation/frontend/tracing.go. This code demonstrates the
// correct .NET OTel SDK wiring pattern but was not compiled into the
// running application; verified traces came from otel-demo's own images.

using System.Diagnostics;
using System.Diagnostics.Metrics;
using OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace CartService.Observability;

public static class Instrumentation
{
    public static readonly ActivitySource ActivitySource = new("cartservice", "1.0.0");
    public static readonly Meter Meter = new("cartservice", "1.0.0");

    public static readonly Counter<long> ItemsAdded =
        Meter.CreateCounter<long>("cartservice.items.added", description: "Items added to cart");
    public static readonly Counter<long> ItemsRemoved =
        Meter.CreateCounter<long>("cartservice.items.removed", description: "Items removed from cart");

    public static TracerProvider ConfigureTracing(string agentEndpoint, string environment)
    {
        return Sdk.CreateTracerProviderBuilder()
            .ConfigureResource(r => r
                .AddService(serviceName: "cartservice", serviceVersion: "1.0.0")
                .AddAttributes(new Dictionary<string, object>
                {
                    ["deployment.environment"] = environment,
                    ["service.language"] = "csharp"
                }))
            .AddSource("cartservice")
            .AddAspNetCoreInstrumentation()
            .AddGrpcClientInstrumentation()
            .AddRedisInstrumentation()
            .AddOtlpExporter(o =>
            {
                o.Endpoint = new Uri($"http://{agentEndpoint}:4317");
                o.Protocol = OpenTelemetry.Exporter.OtlpExportProtocol.Grpc;
            })
            .Build()!;
    }

    public static MeterProvider ConfigureMetrics(string agentEndpoint)
    {
        return Sdk.CreateMeterProviderBuilder()
            .AddMeter("cartservice")
            .AddOtlpExporter(o =>
            {
                o.Endpoint = new Uri($"http://{agentEndpoint}:4317");
                o.Protocol = OpenTelemetry.Exporter.OtlpExportProtocol.Grpc;
            })
            .Build()!;
    }

    public static Activity? StartValidateCartContents(string userId, int itemCount)
    {
        var activity = ActivitySource.StartActivity("validate-cart-contents");
        activity?.SetTag("user.id", userId);
        activity?.SetTag("product.count", itemCount);
        return activity;
    }

    public static Activity? StartAddItemToCart(string userId, string productId, int quantity)
    {
        var activity = ActivitySource.StartActivity("add-item-to-cart");
        activity?.SetTag("user.id", userId);
        activity?.SetTag("product.id", productId);
        activity?.SetTag("item.quantity", quantity);
        ItemsAdded.Add(quantity);
        return activity;
    }
}