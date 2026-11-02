"""WFlow AI — Automated Load & Stress Testing Suite.

Usage:
    uv run python -m tests.load.load_test [--concurrency 20] [--requests 200] [--url http://localhost:8100]
"""

import argparse
import asyncio
import statistics
import time
from typing import Any

import httpx


async def worker(
    client: httpx.AsyncClient,
    queue: asyncio.Queue[str],
    latencies: list[float],
    status_counts: dict[int, int],
) -> None:
    while not queue.empty():
        path = await queue.get()
        start = time.perf_counter()
        try:
            res = await client.get(path)
            duration = (time.perf_counter() - start) * 1000
            latencies.append(duration)
            status_counts[res.status_code] = status_counts.get(res.status_code, 0) + 1
        except Exception:
            duration = (time.perf_counter() - start) * 1000
            latencies.append(duration)
            status_counts[599] = status_counts.get(599, 0) + 1
        finally:
            queue.task_done()


async def run_benchmark(
    base_url: str,
    path: str,
    total_requests: int = 200,
    concurrency: int = 20,
) -> dict[str, Any]:
    queue: asyncio.Queue[str] = asyncio.Queue()
    for _ in range(total_requests):
        queue.put_nowait(path)

    latencies: list[float] = []
    status_counts: dict[int, int] = {}

    start_time = time.perf_counter()
    async with httpx.AsyncClient(base_url=base_url, timeout=10.0) as client:
        tasks = [
            asyncio.create_task(worker(client, queue, latencies, status_counts)) for _ in range(concurrency)
        ]
        await queue.join()
        for t in tasks:
            t.cancel()

    elapsed = time.perf_counter() - start_time
    rps = len(latencies) / elapsed if elapsed > 0 else 0

    sorted_latencies = sorted(latencies)
    p50 = statistics.median(sorted_latencies) if sorted_latencies else 0.0
    p95 = sorted_latencies[int(len(sorted_latencies) * 0.95)] if sorted_latencies else 0.0
    p99 = sorted_latencies[int(len(sorted_latencies) * 0.99)] if sorted_latencies else 0.0

    return {
        "path": path,
        "total_requests": len(latencies),
        "elapsed_seconds": round(elapsed, 2),
        "requests_per_second": round(rps, 1),
        "latency_ms": {
            "min": round(min(sorted_latencies), 1) if sorted_latencies else 0,
            "p50": round(p50, 1),
            "p95": round(p95, 1),
            "p99": round(p99, 1),
            "max": round(max(sorted_latencies), 1) if sorted_latencies else 0,
        },
        "statuses": status_counts,
    }


async def main() -> None:
    parser = argparse.ArgumentParser(description="WFlow AI Load Tester")
    parser.add_argument("--url", default="http://localhost:8100", help="Base URL")
    parser.add_argument("--concurrency", type=int, default=20, help="Concurrency")
    parser.add_argument("--requests", type=int, default=200, help="Total requests")
    args = parser.parse_args()

    print("==================================================")
    print("WFlow AI — Performance & Stress Benchmark")
    print(f"Target: {args.url}")
    print(f"Concurrency: {args.concurrency} | Requests: {args.requests}")
    print("==================================================")

    # 1. Health check benchmark
    print("\n[Benchmarking /api/v1/health]...")
    res = await run_benchmark(
        args.url, "/api/v1/health", total_requests=args.requests, concurrency=args.concurrency
    )
    print(f"  Throughput: {res['requests_per_second']} RPS")
    print(
        f"  Latencies: p50={res['latency_ms']['p50']}ms, p95={res['latency_ms']['p95']}ms, p99={res['latency_ms']['p99']}ms"
    )
    print(f"  Statuses: {res['statuses']}")

    # 2. Prometheus metrics benchmark
    print("\n[Benchmarking /metrics]...")
    res_m = await run_benchmark(
        args.url, "/metrics", total_requests=args.requests // 2, concurrency=args.concurrency
    )
    print(f"  Throughput: {res_m['requests_per_second']} RPS")
    print(
        f"  Latencies: p50={res_m['latency_ms']['p50']}ms, p95={res_m['latency_ms']['p95']}ms, p99={res_m['latency_ms']['p99']}ms"
    )
    print(f"  Statuses: {res_m['statuses']}")

    print("\nBenchmark completed successfully.")


if __name__ == "__main__":
    asyncio.run(main())
